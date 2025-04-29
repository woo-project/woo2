import { Logger } from './logger';
import { Defer, IElemJson, isWorker } from './common';
import { worker } from 'workerLoader';

const log = Logger(`WOO:Message:${isWorker ? 'Worker' : 'Main'}`);

// 全局消息句柄,自动根据当前环境选择Worker线程或者主线程
let globalMessageHandle = (worker || self) as any as {
  postMessage: (message: any, transfer?: Transferable[] | undefined) => void;
  addEventListener: (
    type: string,
    listener: (this: Worker, ev: MessageEvent) => any,
    options?: boolean | AddEventListenerOptions | undefined
  ) => void;
};

// 元素定位:
// 通过cid+eid可唯一定位一个元素
// 其中cid为组件ID，唯一标识一个组件实例
// eid为元素ID，唯一标识一个组件内部的一个元素
// cid的分配由

// 通用消息数据结构
interface IMessageStruct {
  // 请求消息类型,格式为 "W:xxx" 或者 "M:xxx"
  type: string;
  // 消息ID,消息请求时,用于唯一标识一个消息,
  id?: number;
  // 判断是否为应答消息,如果为应答消息,则此字段为请求消息的ID
  reply?: number;
  // 消息数据
  data?: any;
  // 如果执行错误,则处理错误信息
  err?: any;
}

const TIMEOUT = 500000;

let _globalMessageId = isWorker ? 1000000 : 1;
const _workerReadyDefer = new Defer<{}>();

const _globalListeners = new Map<string, MessageBase<any, any>>();
const _globalWaitReplies = new Map<number, Defer<any>>();


globalMessageHandle.addEventListener('message', (ev) => {
  const data = ev.data as IMessageStruct;
  if (data.reply) {
    // 处理应答消息
    const reply = _globalWaitReplies.get(data.reply);
    if (reply) {
      _globalWaitReplies.delete(data.reply);
      if (data.err) reply.reject(data.err);
      else reply.reslove(data.data);
    } else {
      log.warn('message reply not found', data);
    }
  } else {
    // 处理请求消息

    const messager = _globalListeners.get(data.type);
    if (messager) {
      messager._listener?.call(messager, data.data).then((result: any) => {
        globalMessageHandle.postMessage({
          type: data.type,
          reply: data.id,
          data: result,
        });
      }).catch((err: any) => {
        log.error(`onMessage ${data.type}`, err);
        globalMessageHandle.postMessage({
          reply: data.id,
          err: err,
        });
      });
    } else {
      log.warn('Message.onMessage', 'listener not found', data);
    }
  }
});



/**
 * 实现Worker和主线程的消息通信,处理应答
 */
export class MessageBase<TSend extends {}, TRecv extends {}> {

  _listener?: ((data: TSend) => Promise<TRecv>);
  constructor(private _msgName: string) {
    _globalListeners.set(this._msgName, this);

  }

  // 发送消息,并获取返回结果
  async send(data: TSend, transfer?: any[]): Promise<TRecv> {

    const id = _globalMessageId++;
    const type = this._msgName;
    if (!isWorker) {
      // 主线程，等待Worker准备好
      await _workerReadyDefer.result();
    }


    const timeStart = Date.now();
    log.info(`Message Send Type="${type}" Id=${id}`, data);

    const defer = new Defer<TRecv>();
    _globalWaitReplies.set(id, defer);
    globalMessageHandle.postMessage(
      {
        type,
        id,
        data,
      },
      transfer
    );
    let ret = await defer.result(TIMEOUT);

    log.info(`Message Reply Type="${type}" Id=${id}`,ret,`,tm=${Date.now() - timeStart}ms`);

    return ret;
  }

  on(callback: (data: TSend) => Promise<TRecv>) {
    if (this._listener) {
      throw new Error(`Message listener: ${this._msgName} already exists`);
    }
    log.info('Message listener', this._msgName);


    this._listener = callback;
  }
}



// Worker 主动发送消息，主线程响应
export const WorkerMessage = {
  // Worker线程准备好,发送此消息
  ready: new MessageBase<{}, {}>('W:Ready'),
  
  // Worker线程请求解析模板
  templateParse: new MessageBase<{ text: string }, { tpl: IElemJson }>('W:TemplateParse'),
  // Worker线程请求注册WebComponent
  registerComponent: new MessageBase<
    { relUrl: string; tag: string; attrs: { [key: string]: string } },
    { elem?: { tag: string; attrs: { [key: string]: string } } }
  >('W:RegisterComponent'),
  // Worker线程请求更新元素属性
  updateElem: new MessageBase<{ cid: string; eid: string; attrs: { [key: string]: string } }, {}>('W:UpdateElem'),
};


/**
 * 定义主线程主动发送的消息
 */
export const MainMessage = {
  // 设置全局meta属性        
  setGlobalMeta: new MessageBase<
    {
      meta: IElemJson[]; // 需要更新的meta属性列表
      htmlUrl?: string; // 当前页面的Url
    },
    {}
  >('M:SetGlobalMeta'),
  // 请求加载元素
  loadComponent: new MessageBase<
    { tag: string; attrs: { [k: string]: string }; relUrl: string },
    { tag: string; attrs: { [key: string]: string }; content: string }
  >('M:LoadComponent'),
};



// 同步worker，等待WorkerReady消息
if (isWorker) {
  // Worker线程，发送Ready消息
  WorkerMessage.ready.send({}).then((data) => {
    _workerReadyDefer.reslove(data);
  });

} else {
  // 主线程，等待WorkerReady消息
  WorkerMessage.ready.on(async (data) => {
    _workerReadyDefer.reslove(data);
    return {};
  });
  _workerReadyDefer.result().then(() => {
    log.info('WorkerReady');
  });
}
