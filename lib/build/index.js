 (() => new EventSource("http://localhost:8880").onmessage = () => location.reload())();
"use strict";
(() => {
  // src/logger.ts
  var loggerlastTm = -1;
  var enableDebug = !!globalThis?.localStorage?.getItem("__DEV");
  function Logger(tag) {
    const h = Math.round(Math.random() * 360);
    const timeStyle = `color:hsl(${h},100%,40%);font-style: italic;`;
    const fileStyle = `color:hsl(${h},100%,40%);font-weight: 900;font-size:12px;`;
    let thislastTm = -1;
    const logList = ["debug", "log", "info", "warn", "error"];
    function none() {
    }
    const con = function(...args) {
      con.log.call(con, ...args);
    };
    Reflect.setPrototypeOf(
      con,
      new Proxy(console, {
        get(t, p) {
          let level = logList.indexOf(p);
          if (level < 0) return t[p];
          if (level <= 2 && !enableDebug) {
            return none;
          }
          let tm = (/* @__PURE__ */ new Date()).getTime();
          let spanAll = loggerlastTm > 0 ? tm - loggerlastTm : 0;
          let spanThis = thislastTm > 0 ? tm - thislastTm : 0;
          loggerlastTm = tm;
          thislastTm = tm;
          return console[p].bind(
            console,
            `%c${p.substring(0, 1).toUpperCase()}|${spanAll}|${spanThis} %c${tag}`,
            timeStyle,
            fileStyle
          );
        }
      })
    );
    return con;
  }
  globalThis.Logger = Logger;

  // src/common.ts
  var log = Logger("WOO:Utils");
  var PromiseExt = {
    /**
     * 超时Promise
     * @param promise
     * @param timeoutMs
     * @returns
     */
    timeout(promise, timeoutMs) {
      return Promise.race([
        promise,
        new Promise((res, rej) => {
          setTimeout(() => {
            rej("timeout");
          }, timeoutMs);
        })
      ]);
    },
    wait(timeoutMs) {
      return new Promise((res) => {
        setTimeout(res, timeoutMs);
      });
    }
  };
  var Defer = class {
    constructor(name, _timeoutMs = -1) {
      this.name = name;
      this._timeoutMs = _timeoutMs;
      this._res = () => {
      };
      this._rej = () => {
      };
      let p = new Promise((res, rej) => {
        this._res = res;
        this._rej = rej;
      });
      this._promise = _timeoutMs > 0 ? PromiseExt.timeout(p, _timeoutMs) : p;
    }
    async result(timeout = -1) {
      if (timeout > 0) {
        return PromiseExt.timeout(this._promise, timeout);
      }
      return this._promise;
    }
    reslove(result) {
      this._res(result);
    }
    reject(reason) {
      this._rej(reason);
    }
  };
  var isWorker = !self.window;

  // src/workerLoader.ts
  var worker = void 0;
  if (!isWorker) {
    const srcScript = document.currentScript.src;
    let workerUrl = srcScript.replace(/index\.js$/, "worker/worker.js");
    console.log("MainWorkerLoader 44:", srcScript, workerUrl);
    worker = new Worker(workerUrl, { name: "WooWorker" });
  }

  // src/message.ts
  var log2 = Logger(`WOO:Message:${isWorker ? "Worker" : "Main"}`);
  var globalMessageHandle = worker || self;
  var TIMEOUT = 5e5;
  var _globalMessageId = isWorker ? 1e6 : 1;
  var _workerReadyDefer = new Defer();
  var MessageBase = class {
    constructor(_msgName) {
      this._msgName = _msgName;
      this._waitReply = /* @__PURE__ */ new Map();
      this._listeners = /* @__PURE__ */ new Map();
      globalMessageHandle.addEventListener("message", this._onMessage.bind(this));
    }
    _onMessage(ev) {
      const data = ev.data;
      if (data.reply) {
        const reply = this._waitReply.get(data.reply);
        if (reply) {
          if (data.err) reply.rej(data.err);
          else reply.res(data.data);
          this._waitReply.delete(data.reply);
        } else {
          log2.warn("Message.onMessage", "reply not found", data);
        }
      } else {
        const listener = this._listeners.get(data.type);
        if (listener) {
          listener(data.data).then((result) => {
            globalMessageHandle.postMessage({
              type: data.type,
              reply: data.id,
              data: result
            });
          }).catch((err) => {
            log2.error(`onMessage ${data.type}`, err);
            globalMessageHandle.postMessage({
              reply: data.id,
              err
            });
          });
        } else {
          log2.warn("Message.onMessage", "listener not found", data);
        }
      }
    }
    // 发送消息,并获取返回结果
    async send(data, transfer) {
      if (!isWorker) {
        await _workerReadyDefer.result();
      }
      const id = _globalMessageId++;
      const type = this._msgName;
      log2.time(`MSG:${type}-${id}`);
      let ret = await new Promise((res, rej) => {
        this._waitReply.set(id, { res, rej });
        setTimeout(() => {
          if (this._waitReply.has(id)) {
            this._waitReply.delete(id);
            rej("timeout");
          }
        }, TIMEOUT);
        globalMessageHandle.postMessage(
          {
            type,
            id,
            data
          },
          transfer
        );
      });
      log2.timeEnd(`MSG:${type}-${id}`);
      return ret;
    }
    on(callback) {
      this._listeners.set(this._msgName, callback);
    }
  };
  var WorkerMessage = {
    // Worker线程准备好,发送此消息
    ready: new MessageBase("W:Ready"),
    // Worker线程请求解析模板
    templateParse: new MessageBase("W:TemplateParse"),
    // Worker线程请求注册WebComponent
    registerComponent: new MessageBase("W:RegisterComponent"),
    // Worker线程请求更新元素属性
    updateElem: new MessageBase("W:UpdateElem")
  };
  var MainMessage = {
    // 设置全局meta属性
    setGlobalMeta: new MessageBase("M:SetGlobalMeta"),
    // 请求加载元素
    loadComponent: new MessageBase("M:LoadComponent")
  };
  if (isWorker) {
    WorkerMessage.ready.send({}).then((data) => {
      _workerReadyDefer.reslove(data);
    });
  } else {
    WorkerMessage.ready.on(async (data) => {
      _workerReadyDefer.reslove(data);
      return {};
    });
    _workerReadyDefer.result().then(() => {
      log2.info("WorkerReady");
    });
  }

  // src/main/mainDomUtils.ts
  var DomUtils = {
    isUnregisterWebComponentTag(tag) {
      return tag.includes("-") && !customElements.get(tag);
    },
    deepChildElement(parent, callback) {
      const promises = [];
      for (let i = 0; i < parent.children.length; i++) {
        const el = parent.children[i];
        const rt = callback(el);
        if (rt) promises.push(rt);
        this.deepChildElement(el, callback);
      }
      return Promise.all(promises);
    },
    elemAttrs(el) {
      let attrs = {};
      for (let i = 0; i < el.attributes.length; i++) {
        const attr = el.attributes[i];
        attrs[attr.name] = attr.value;
      }
      return attrs;
    },
    elToJson(el, filter) {
      return {
        tag: el.tagName.toLowerCase(),
        attrs: this.elemAttrs(el),
        children: (el instanceof HTMLTemplateElement ? Array.from(el.content.childNodes) : Array.from(el.childNodes)).map((node) => {
          if (node instanceof Text && node.nodeValue.trim().length > 0) {
            return node.nodeValue?.trim();
          } else if (node instanceof Element) {
            if (filter && !filter(node)) return null;
            return this.elToJson(node, filter);
          }
        }).filter((v) => v != null)
      };
    },
    renameElemTag(el, newTag) {
      const newEl = document.createElement(newTag);
      for (let i = 0; i < el.attributes.length; i++) {
        const attr = el.attributes[i];
        newEl.setAttribute(attr.name, attr.value);
      }
      Array.from(el.childNodes).forEach((node) => newEl.appendChild(node));
      el.replaceWith(newEl);
      return newEl;
    }
  };

  // src/wooMeta.ts
  var WooMeta = {
    // 定义woo加载事件的名称,默认为DOMContentLoaded
    loadEvent: {
      name: "woo-load-event",
      content: "DOMContentLoaded"
    },
    // 加载Dom元素时自动隐藏,对首页和所有元素生效
    loadCloak: {
      name: "woo-load-cloak",
      content: "1"
    },
    // 加载进度条,是否显示元素加载的进度条，对所有
    loadProgress: {
      name: "woo-load-progress",
      content: "woojs-woo.progress",
      // 默认进度条标签名称
      delay: "1000"
      // 设置显示进度条的超时时间
    }
  };

  // src/main/mainComponent.ts
  var log3 = Logger("WOO:MainComponent");
  var componentRegistry = /* @__PURE__ */ new Map();
  var BaseComponent = class extends HTMLElement {
    constructor() {
      super();
      const cid = this.getAttribute("_cid");
      log3.info("BaseComponent constructor", this.tagName, cid);
      if (cid) {
        const comp = componentRegistry.get(cid);
        if (comp) {
          comp.attachElement(this);
          const initData = comp.getInitData();
          for (const k in initData.attrs) {
            this.setAttribute(k, initData.attrs[k]);
          }
          this.attachShadow({ mode: "open" }).innerHTML = initData.content;
        } else {
          log3.error("BaseComponent", "Component not found", cid);
        }
      }
    }
    connectedCallback() {
      log3.info("connectedCallback", this.tagName.toLowerCase());
      this.setAttribute("_ready", "");
    }
    adoptedCallback() {
    }
    attributeChangedCallback(name, oldValue, newValue) {
    }
    disconnectedCallback() {
      log3.info("disconnectedCallback", this.tagName.toLowerCase());
      const cid = this.getAttribute("_cid");
      if (cid) {
        componentRegistry.delete(cid);
      }
    }
  };
  var MainComponent = class _MainComponent {
    /**
     *
     * @param _rel 引用来源,可以是Url或者Npm包名
     * @param el 元素
     */
    constructor(el) {
      this._tag = "";
      this._attrs = {};
      if (el instanceof HTMLElement) {
        this._cid = `${el.tagName.toLowerCase()}-${_MainComponent._cidCounter++}`;
        el.setAttribute("_cid", this._cid);
      } else {
        this._cid = `${el.tag}-${_MainComponent._cidCounter++}`;
        el.attrs["_cid"] = this._cid;
      }
      const reqInfo = el instanceof HTMLElement ? {
        tag: el.tagName.toLowerCase(),
        attrs: DomUtils.elemAttrs(el),
        relUrl: `${location.origin}${location.pathname}`
      } : el;
      this._loadPromise = MainMessage.loadComponent.send(reqInfo).then((data) => {
        this._initData = data;
        this._tag = data.tag;
        this._attrs = data.attrs;
        log3.info("MainComponent", this._tag, this._attrs);
        if (el instanceof HTMLElement) {
          if (el.tagName != data.tag) {
            DomUtils.renameElemTag(el, data.tag);
          }
        }
        componentRegistry.set(this._cid, this);
      });
    }
    static {
      this._cidCounter = 1;
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
    attachElement(el) {
      this._rootElem = el;
    }
    _apply() {
      if (!customElements.get(this._tag)) {
        const cls = class extends BaseComponent {
        };
        customElements.define(this._tag, cls);
        log3.debug("registerWebComponents", this._tag);
      }
    }
  };
  async function mainLoadDocument() {
    let startTm = Date.now();
    let wooMetas = [];
    let wooLoadEventName = "DOMContentLoaded";
    log3.info("woo-load-event:", wooLoadEventName);
    document.querySelectorAll(`meta[name^="woo-"]`).forEach((el) => {
      wooMetas.push(DomUtils.elToJson(el));
      if (el.getAttribute("name") == WooMeta.loadEvent.name) {
        let name = el.getAttribute("content")?.trim();
        if (name) {
          wooLoadEventName = name;
          log3.info("woo-load-event:", wooLoadEventName);
        }
      }
    });
    await new Promise((res, rej) => {
      window.addEventListener(wooLoadEventName, () => {
        res(null);
      });
    });
    const docLoadTm = Date.now() - startTm;
    startTm = Date.now();
    console.log("Document loaded:", docLoadTm, "ms");
    await MainMessage.setGlobalMeta.send({ meta: wooMetas, htmlUrl: `${location.origin}${location.pathname}` });
    const docComponents = [];
    DomUtils.deepChildElement(document.body, (el) => {
      if (DomUtils.isUnregisterWebComponentTag(el.tagName)) {
        docComponents.push(new MainComponent(el));
      }
    });
    await Promise.all(docComponents.map((comp) => comp.waitLoad(true)));
    document.body.setAttribute("woo-ready", "");
    window.dispatchEvent(new Event("WooReady"));
    console.log("WOO loaded:", Date.now() - startTm, "ms");
  }

  // package.json
  var package_default = {
    name: "@woojs/woo",
    version: "2.0.4",
    description: "woo web components framework",
    main: "index.js",
    scripts: {
      w: "esbuild src/index.ts src/worker/worker.ts --bundle --outdir=build  --sourcemap=inline  --watch --servedir=. --format=iife",
      d: "esbuild src/index.ts  src/worker/worker.ts --bundle --outdir=./dev/woo/ --sourcemap=inline --format=iife",
      b: "esbuild src/index.ts  src/worker.ts --bundle --minify --outdir=./dist/ --analyze ",
      pub: 'cd dist && npm --registry "https://registry.npmjs.org/" publish --access public',
      test: "cypress open",
      "init-global": "pnpm i -g cypress esbuild typescript"
    },
    keywords: [
      "webcomponents",
      "woo",
      "woojs",
      "web",
      "components"
    ],
    author: "zhfjyq@gmail.com",
    license: "MIT",
    devDependencies: {
      esbuild: "^0.24.0",
      cypress: "^13.12.0",
      typescript: "^5.4.5"
    },
    dependencies: {}
  };

  // src/main/mainMessage.ts
  var log4 = Logger("WOO:MainMessage");
  WorkerMessage.templateParse.on(async (data) => {
    let tpl = document.createElement("template");
    tpl.innerHTML = data.text;
    let elem = tpl.content.firstElementChild;
    if (!elem) throw new Error("TemplateParse: no element");
    return { tpl: DomUtils.elToJson(elem) };
  });
  WorkerMessage.registerComponent.on(async (data) => {
    let cls = customElements.get(data.tag);
    if (cls && !(cls instanceof BaseComponent)) {
      log4.debug("skip third party component:", data.tag);
      return {};
    }
    let comp = new MainComponent(data);
    await comp.waitLoad();
    log4.warn("=============>>>>", comp.tag, comp.attrs);
    return {
      elem: {
        tag: comp.tag,
        attrs: comp.attrs
      }
    };
  });

  // src/index.ts
  console.log("Power By ", package_default.name, package_default.version);
  var log5 = Logger("woo:index");
  mainLoadDocument();
  new EventSource("/esbuild").addEventListener("change", (ev) => {
    log5.warn("esbuild ---> change", ev);
  });
  var src_default = {};
})();
