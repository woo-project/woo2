import { IElemJson } from '../common';
import { DomUtils } from './mainDomUtils';
import { Logger } from '../logger';
import { MainMessage } from '../message';
import { WooMeta } from 'wooMeta';

// 实现WebComponents相关的功能,运行于主线程
// 查找变更的组件或者元素,一次性加载和更新所有变化内容，提高性能
// 组件标签: 仅支持全称
const log = Logger('WOO:MainComponent');

export const componentRegistry = new Map<string, MainComponent>();

export class BaseComponent extends HTMLElement {
  constructor() {
    super();
    // 读取_cid属性,获取组件内容,添加到shadowRoot
    // 获取组件内容
    const cid = this.getAttribute('_cid');
    log.info('BaseComponent constructor', this.tagName, cid);
    if (cid) {
      const comp = componentRegistry.get(cid);
      if (comp) {
        comp.attachElement(this);
        const initData = comp.getInitData()!!;
        for (const k in initData.attrs) {
          this.setAttribute(k, initData.attrs[k]);
        }
        this.attachShadow({ mode: 'open' }).innerHTML = initData.content;
      } else {
        log.error('BaseComponent', 'Component not found', cid);
      }
    }
  }
  connectedCallback() {
    log.info('connectedCallback', this.tagName.toLowerCase());
    this.setAttribute('_ready', '');
  }
  adoptedCallback() {}
  attributeChangedCallback(name: string, oldValue: string, newValue: string) {
    // 属性变化跟踪
  }

  disconnectedCallback() {
    log.info('disconnectedCallback', this.tagName.toLowerCase());
    const cid = this.getAttribute('_cid');
    if (cid) {
      // 通知worker线程删除组件
      componentRegistry.delete(cid);
    }
  }
}

/**
 * 主线程组件, 主线程组件可以通过传入元素或者元素描述对象,来创建组件实例
 */
export class MainComponent {
  static _cidCounter = 1;
  // 组件实例ID,由主线程生成并为每一个有效的WOO组件分配一个唯一的ID
  public _cid: string;

  private _tag = '';
  private _loadPromise: Promise<void>;
  private _attrs: { [key: string]: string } = {};
  private _rootElem?: HTMLElement;
  private _initData?: { tag: string; attrs: { [key: string]: string }; content: string };

  /**
   *
   * @param _rel 引用来源,可以是Url或者Npm包名
   * @param el 元素
   */
  constructor(el: HTMLElement | { tag: string; attrs: { [k: string]: string }; relUrl: string }) {
    if (el instanceof HTMLElement) {
      this._cid = `${el.tagName.toLowerCase()}-${MainComponent._cidCounter++}`;
      el.setAttribute('_cid', this._cid);
    } else {
      this._cid = `${el.tag}-${MainComponent._cidCounter++}`;
      el.attrs['_cid'] = this._cid;
    }

    const reqInfo =
      el instanceof HTMLElement
        ? {
            tag: el.tagName.toLowerCase(),
            attrs: DomUtils.elemAttrs(el),
            relUrl: `${location.origin}${location.pathname}`,
          }
        : el;
    this._loadPromise = MainMessage.loadComponent.send(reqInfo).then((data) => {
      this._initData = data;
      this._tag = data.tag;
      this._attrs = data.attrs;
      
      log.info('MainComponent', this._tag, this._attrs);

      if (el instanceof HTMLElement) {
        // 检测标签一致性
        if (el.tagName != data.tag) {
          DomUtils.renameElemTag(el, data.tag);
        }
      }
      componentRegistry.set(this._cid, this);
    });
  }
  get tag() {
    return this._tag;
  }
  get attrs() {
    return this._attrs;
  }
  get rootElem() {
    return this._rootElem;
  }

  async waitLoad(autoApply = true) {
    await this._loadPromise;
    if (autoApply) this._apply();
  }
  getInitData() {
    return this._initData;
  }
  attachElement(el: HTMLElement) {
    this._rootElem = el;
  }
  private _apply() {
    // 注册标签
    if (!customElements.get(this._tag)) {
      // 注册标签
      const cls = class extends BaseComponent {};
      customElements.define(this._tag, cls);
      log.debug('registerWebComponents', this._tag);
    }
  }
  
}

// 加载主文档
export async function mainLoadDocument() {
  let startTm = Date.now();

  // 获取所有woo-开头的meta标签

  let wooMetas: IElemJson[] = [];
  let wooLoadEventName = 'DOMContentLoaded';
  log.info('woo-load-event:', wooLoadEventName);

  document.querySelectorAll(`meta[name^="woo-"]`).forEach((el) => {
    wooMetas.push(DomUtils.elToJson(el));
    if (el.getAttribute('name') == WooMeta.loadEvent.name) {
      let name = el.getAttribute('content')?.trim();
      if (name) {
        wooLoadEventName = name;
        log.info('woo-load-event:', wooLoadEventName);
      }
    }
  });

  // 等待页面加载完毕
  await new Promise((res, rej) => {
    window.addEventListener(wooLoadEventName, () => {
      res(null);
    });
  });
  const docLoadTm = Date.now() - startTm;
  startTm = Date.now();

  console.log('Document loaded:', docLoadTm, 'ms');
  // 设置meta到worker
  await MainMessage.setGlobalMeta.send({ meta: wooMetas, htmlUrl: `${location.origin}${location.pathname}` });
  // await message.send('M:SetGlobalMeta', { meta: wooMetas, htmlUrl: `${location.origin}${location.pathname}` });
  // 加载所有组件

  const docComponents = [] as MainComponent[];
  // 2. 获取所有未注册的MainComponents标签,创建组件实例
  DomUtils.deepChildElement(document.body, (el) => {
    if (DomUtils.isUnregisterWebComponentTag(el.tagName)) {
      docComponents.push(new MainComponent(el));
    }
  });
  
  // 自动应用所有组件
  await Promise.all(docComponents.map((comp) => comp.waitLoad(true)));

  document.body.setAttribute('woo-ready', '');
  // 发送事件通知整个页面加载完毕
  window.dispatchEvent(new Event('WooReady'));
  console.log('WOO loaded:', Date.now() - startTm, 'ms');
}
