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
// type IMessageType = keyof IMessages;

// /**
//  * 消息类型定义,"W:"为Worker线程消息,"M:"为主线程消息
//  */
// interface IMessages {
//   //========= 工作线程发起事件，主线程响应 =========

//   // 当Worker线程准备好时,发送此消息,通知主线程Worker启动完成
//   'W:Ready': {
//     send: {};
//     reply: {};
//   };
//   // 由于DomParse仅能在主线程调用，因此，当Worker线程需要解析Dom时，发送此消息到主线程，由主线程解析完毕后返回解析结果
//   'W:TemplateParse': {
//     send: { text: string };
//     reply: { tpl: IElemJson };
//   };
//   // 注册一个WebComponent,主线程接收到此消息后,注册WebComponent,如果已经注册,返回失败
//   // 'W:RegisterWebComponent': {
//   //   send: { tag: string };
//   //   reply: {
//   //     success: boolean; // 如果注册成功,返回true,否则返回false(组件已经注册)
//   //   };
//   // };

//   // 当Worker线程需要加载WebComponent元素时，发送此消息到主线程
//   'W:RegisterComponent': {
//     send: { relUrl: string; tag: string; attrs: { [key: string]: string } };
//     reply: { elem?: { tag: string; attrs: { [key: string]: string } } };
//   };

//   //
//   'W:UpdateElem': {
//     send: { cid: string; eid: string; attrs: { [key: string]: string } };
//     reply: {};
//   };

//   // ======= 主线程发起事件，工作线程响应 =========
//   // 更新全局meta属性
//   'M:SetGlobalMeta': {
//     send: {
//       meta: IElemJson[]; // 需要更新的meta属性列表
//       htmlUrl?: string; // 当前页面的Url
//     };
//     reply: {};
//   };
//   // 请求加载元素,传入请求加载的元素标签和属性,一般用于在首页加载固定元素或者独立元素(无父元素)
//   'M:LoadComponent': {
//     send: { tag: string; attrs: { [k: string]: string }; relUrl: string };
//     reply: { tag: string; attrs: { [key: string]: string }; content: string };
//   };
// }

let _globalMessageId = isWorker ? 1000000 : 1;
const _workerReadyDefer = new Defer<{}>();

/**
 * 实现Worker和主线程的消息通信,处理应答
 */
export class MessageBase<TSend extends {}, TRecv extends {}> {
  private _waitReply = new Map<number, { res: (data: any) => void; rej: (err: string) => void }>();
  private _listeners = new Map<string, (data: any) => Promise<any>>();

  constructor(private _msgName: string) {
    globalMessageHandle.addEventListener('message', this._onMessage.bind(this));
  }

  private _onMessage(ev: MessageEvent) {
    const data = ev.data as IMessageStruct;
    if (data.reply) {
      // 处理应答消息
      const reply = this._waitReply.get(data.reply);
      // log.info('<<= Reply Message ', data);
      if (reply) {
        if (data.err) reply.rej(data.err);
        else reply.res(data.data);
        this._waitReply.delete(data.reply);
      } else {
        log.warn('Message.onMessage', 'reply not found', data);
      }
    } else {
      // 处理请求消息
      // log.info('=>> Received Message', data);
      const listener = this._listeners.get(data.type );
      if (listener) {
        listener(data.data)
          .then((result: any) => {
            globalMessageHandle.postMessage({
              type: data.type,
              reply: data.id,
              data: result,
            });
          })
          .catch((err: any) => {
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
  }

  // 发送消息,并获取返回结果
  async send(data: TSend, transfer?: any[]): Promise<TRecv> {
    if (!isWorker) {
      // 主线程，等待Worker准备好
      await _workerReadyDefer.result();
    }
    const id = _globalMessageId++;
    const type = this._msgName;

    log.time(`MSG:${type}-${id}`);

    let ret: any = await new Promise((res, rej) => {
      this._waitReply.set(id, { res, rej });
      // 超时处理
      setTimeout(() => {
        if (this._waitReply.has(id)) {
          this._waitReply.delete(id);
          rej('timeout');
          // log.error('Message.send', 'timeout', type, data)
        }
      }, TIMEOUT);
      // 发送消息
      globalMessageHandle.postMessage(
        {
          type,
          id,
          data,
        },
        transfer
      );
    });
    log.timeEnd(`MSG:${type}-${id}`);

    return ret;
  }

  on( callback: (data:TSend) => Promise<TRecv>) {
    this._listeners.set(this._msgName, callback);
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

// /**
//  * 实现Worker和主线程的消息通信,处理应答
//  */
// export class Message {
//   private _msgId = isWorker ? _globalMessageId : 1;
//   private _waitReply = new Map<number, { res: (data: any) => void; rej: (err: string) => void }>();
//   private _listeners = new Map<IMessageType, (data: any) => Promise<any>>();
//   private _workerReadyDefer = new Defer<IMessageStruct>('WorkerReady');

//   constructor() {
//     globalMessageHandle.addEventListener('message', this.onMessage.bind(this));

//     if (isWorker) {
//       // Worker线程，发送WorkerReady消息
//       this.send('W:Ready', {}).then((data) => {
//         this._workerReadyDefer.reslove(data);
//       });
//     } else {
//       // 主线程，等待WorkerReady消息
//       this.on('W:Ready', async (data) => {
//         this._workerReadyDefer.reslove(data);
//         return {};
//       });
//       this._workerReadyDefer.result().then(() => {
//         log.info('WorkerReady');
//       });
//     }
//   }

//   onMessage(ev: MessageEvent) {
//     const data = ev.data as IMessageStruct;
//     if (data.reply) {
//       // 处理应答消息
//       const reply = this._waitReply.get(data.reply);
//       // log.info('<<= Reply Message ', data);
//       if (reply) {
//         if (data.err) reply.rej(data.err);
//         else reply.res(data.data);
//         this._waitReply.delete(data.reply);
//       } else {
//         log.warn('Message.onMessage', 'reply not found', data);
//       }
//     } else {
//       // 处理请求消息
//       // log.info('=>> Received Message', data);
//       const listener = this._listeners.get(data.type as IMessageType);
//       if (listener) {
//         listener(data.data)
//           .then((result: any) => {
//             globalMessageHandle.postMessage({
//               type: data.type,
//               reply: data.id,
//               data: result,
//             });
//           })
//           .catch((err: any) => {
//             log.error(`onMessage ${data.type}`, err);
//             globalMessageHandle.postMessage({
//               reply: data.id,
//               err: err,
//             });
//           });
//       } else {
//         log.warn('Message.onMessage', 'listener not found', data);
//       }
//     }
//   }

//   // 发送消息,并获取返回结果
//   async send<T extends IMessageType>(
//     type: T,
//     data: IMessages[T]['send'],
//     transfer?: any[]
//   ): Promise<IMessages[T]['reply']> {
//     if (!isWorker) {
//       // 主线程，等待Worker准备好
//       await this._workerReadyDefer.result();
//     }
//     const id = this._msgId++;

//     log.time(`MSG:${type}-${id}`);

//     let ret: any = await new Promise((res, rej) => {
//       this._waitReply.set(id, { res, rej });
//       // 超时处理
//       setTimeout(() => {
//         if (this._waitReply.has(id)) {
//           this._waitReply.delete(id);
//           rej('timeout');
//           // log.error('Message.send', 'timeout', type, data)
//         }
//       }, TIMEOUT);
//       // 发送消息
//       globalMessageHandle.postMessage(
//         {
//           type,
//           id,
//           data,
//         },
//         transfer
//       );
//     });
//     log.timeEnd(`MSG:${type}-${id}`);

//     return ret;
//   }

//   on<T extends IMessageType>(type: T, callback: (data: IMessages[T]['send']) => Promise<IMessages[T]['reply']>) {
//     this._listeners.set(type, callback);
//   }
// }

// export const message = new Message();
