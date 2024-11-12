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

  // src/main/mainWorkerLoader.ts
  var worker = void 0;
  if (!isWorker) {
    const srcScript = document.currentScript.src;
    let workerUrl = srcScript.replace(/index\.js$/, "worker/worker.js");
    console.log("MainWorkerLoader 44:", srcScript, workerUrl);
    worker = new Worker(workerUrl, { name: "WooWorker" });
  }

  // src/messageHandle.ts
  var globalMessageHandle = worker || self;

  // src/message.ts
  var log2 = Logger(`WOO:Message:${isWorker ? "Worker" : "Main"}`);
  var TIMEOUT = 5e5;
  var Message = class {
    constructor() {
      this._msgId = isWorker ? 1e4 : 1;
      this._waitReply = /* @__PURE__ */ new Map();
      this._listeners = /* @__PURE__ */ new Map();
      this._workerReadyDefer = new Defer("WorkerReady");
      globalMessageHandle.addEventListener("message", this.onMessage.bind(this));
      if (isWorker) {
        this.send("W:Ready", {}).then((data) => {
          this._workerReadyDefer.reslove(data);
        });
      } else {
        this.on("W:Ready", async (data) => {
          this._workerReadyDefer.reslove(data);
          return {};
        });
        this._workerReadyDefer.result().then(() => {
          log2.info("WorkerReady");
        });
      }
    }
    onMessage(ev) {
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
    async send(type, data, transfer) {
      if (!isWorker) {
        await this._workerReadyDefer.result();
      }
      return new Promise((res, rej) => {
        const id = this._msgId++;
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
    }
    on(type, callback) {
      this._listeners.set(type, callback);
    }
  };
  var message = new Message();

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
    elToJson(el) {
      return {
        tag: el.tagName.toLowerCase(),
        attrs: this.elemAttrs(el),
        children: (el instanceof HTMLTemplateElement ? Array.from(el.content.childNodes) : Array.from(el.childNodes)).map(
          (node) => {
            if (node instanceof Text && node.nodeValue.trim().length > 0) {
              return node.nodeValue?.trim();
            } else if (node instanceof Element) {
              return this.elToJson(node);
            }
          }
        ).filter((v) => v != null)
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
      this._loadPromise = message.send("M:LoadElem", reqInfo).then((data) => {
        this._initData = data;
        this._tag = data.tag;
        this._attrs = data.attrs;
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
    static async loadComponent() {
      const loadPromises = [];
      const meta = [];
      document.querySelectorAll("meta").forEach((el) => {
        const name = el.getAttribute("name");
        if (name?.startsWith("WOO:")) {
          meta.push(DomUtils.elToJson(el));
        }
      });
      loadPromises.push(message.send("M:SetMeta", { meta, htmlUrl: `${location.origin}${location.pathname}` }));
      const docComponents = [];
      DomUtils.deepChildElement(document.body, (el) => {
        if (DomUtils.isUnregisterWebComponentTag(el.tagName)) {
          docComponents.push(new _MainComponent(el));
        }
      });
      loadPromises.push(...docComponents.map((comp) => comp.waitLoad(false)));
      await Promise.all(loadPromises);
      docComponents.forEach((comp) => comp._apply());
    }
  };

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
      cypress: "^13.12.0",
      typescript: "^5.4.5"
    }
  };

  // src/main/mainMessage.ts
  var log4 = Logger("WOO:MainMessage");
  message.on("W:ParseTpl", async (data) => {
    let tpl = document.createElement("template");
    tpl.innerHTML = data.text;
    let elem = tpl.content.firstElementChild;
    if (!elem) throw new Error("ParseTpl: no element");
    return { tpl: DomUtils.elToJson(elem) };
  });
  message.on("W:RegisterElem", async (data) => {
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
  var startTm = Date.now();
  var rootEl = document.head.parentElement;
  window.addEventListener("DOMContentLoaded", () => {
    console.log("DOMContentLoaded");
    MainComponent.loadComponent().then(() => {
      document.body.setAttribute("_ready", "");
      console.log("DOMContentLoaded", "loadDoument", Date.now() - startTm);
      window.dispatchEvent(new Event("WooReady"));
    });
  });
  new EventSource("/esbuild").addEventListener("change", (ev) => {
    log5.warn("esbuild ---> change", ev);
  });
  var src_default = {};
})();
//# sourceMappingURL=data:application/json;base64,ewogICJ2ZXJzaW9uIjogMywKICAic291cmNlcyI6IFsiLi4vLi4vc3JjL2xvZ2dlci50cyIsICIuLi8uLi9zcmMvY29tbW9uLnRzIiwgIi4uLy4uL3NyYy9tYWluL21haW5Xb3JrZXJMb2FkZXIudHMiLCAiLi4vLi4vc3JjL21lc3NhZ2VIYW5kbGUudHMiLCAiLi4vLi4vc3JjL21lc3NhZ2UudHMiLCAiLi4vLi4vc3JjL21haW4vbWFpbkRvbVV0aWxzLnRzIiwgIi4uLy4uL3NyYy9tYWluL21haW5Db21wb25lbnQudHMiLCAiLi4vLi4vcGFja2FnZS5qc29uIiwgIi4uLy4uL3NyYy9tYWluL21haW5NZXNzYWdlLnRzIiwgIi4uLy4uL3NyYy9pbmRleC50cyJdLAogICJzb3VyY2VzQ29udGVudCI6IFsiLyoqXHJcbiAqIExvZ2dlciBcdTU5MDRcdTc0MDZcdUZGMENcdTVGMDBcdTUzRDFcdTZBMjFcdTVGMEZcdUZGMENcdTc2RjRcdTYzQTVcdTdFRDFcdTVCOUFjb25zb2xlLmxvZ1x1RkYwQ1x1NjYzRVx1NzkzQVx1NkU5MFx1NzgwMVxyXG4gKiBcdThGRDBcdTg4NENcdTZBMjFcdTVGMEZcdUZGMUFcdTdFRDFcdTVCOUFcdTUxRkRcdTY1NzBcdUZGMENcdTY2M0VcdTc5M0FcdTY1RjZcdTk1RjRcdTYyMzNcdUZGMENcdTY0MUNcdTk2QzZcdTY1RTVcdTVGRDdcdUZGMENcdTUzRDFcdTkwMDFcdTUyMzBcdTY1RTVcdTVGRDdcdTY3MERcdTUyQTFcdTU2NjhcclxuICogXHU5MDFBXHU4RkM3IHdpbmRvdy5lcnJvciBcdTU5MDRcdTc0MDZcdTUxNjhcdTVDNDBcdTVGMDJcdTVFMzgsIFx1ODFFQVx1NTJBOFx1OEJBMVx1N0I5N1x1NjVGNlx1OTVGNFxyXG4gKiBAcGFyYW0gZXhwb3J0c09ialxyXG4gKiBAcmV0dXJuc1xyXG4gKi9cclxuXHJcblxyXG4vLyBjb25zdCBtZXRhRGVidWcgPSBzZWxmLmRvY3VtZW50Py5oZWFkPy5xdWVyeVNlbGVjdG9yKCdtZXRhW25hbWU9ZGVidWddJyk7XHJcblxyXG5sZXQgbG9nZ2VybGFzdFRtID0gLTE7XHJcblxyXG5jb25zdCBlbmFibGVEZWJ1ZyA9ICEhKGdsb2JhbFRoaXM/LmxvY2FsU3RvcmFnZT8uZ2V0SXRlbSgnX19ERVYnKSk7XHJcblxyXG4vKipcclxuICpcclxuICogQHBhcmFtIG1vZCBcdTRGN0ZcdTc1MjggdGhpcyBcdTYzMDdcdTk0ODhcdTYyMTZcdTgwMDVcdTVCNTdcdTdCMjZcdTRFMzJcclxuICogQHBhcmFtIHBrZyBcdTUzMDVcdTU0MERcclxuICogQHJldHVybnMgbG9nXHJcbiAqL1xyXG5leHBvcnQgZnVuY3Rpb24gTG9nZ2VyKHRhZzogc3RyaW5nKSB7XHJcbiAgY29uc3QgaCA9IE1hdGgucm91bmQoTWF0aC5yYW5kb20oKSAqIDM2MCk7XHJcbiAgY29uc3QgdGltZVN0eWxlID0gYGNvbG9yOmhzbCgke2h9LDEwMCUsNDAlKTtmb250LXN0eWxlOiBpdGFsaWM7YDtcclxuICBjb25zdCBmaWxlU3R5bGUgPSBgY29sb3I6aHNsKCR7aH0sMTAwJSw0MCUpO2ZvbnQtd2VpZ2h0OiA5MDA7Zm9udC1zaXplOjEycHg7YDtcclxuXHJcbiAgbGV0IHRoaXNsYXN0VG0gPSAtMTtcclxuICAvLyBcdTlFRDhcdThCQTRcdTY2M0VcdTc5M0F3YXJuXHU0RUU1XHU0RTBBXHU3RUE3XHU1MjJCXHJcbiAgLy8gY29uc3QgREVCVUcgPSAobG9jYWxTdG9yYWdlLmdldEl0ZW0oJ0RFQlVHJykgfHwgbWV0YURlYnVnIHx8ICcnKS5zcGxpdCgnOycpO1xyXG4gIGNvbnN0IGxvZ0xpc3QgPSBbJ2RlYnVnJywgJ2xvZycsICdpbmZvJywgJ3dhcm4nLCAnZXJyb3InXTtcclxuICBmdW5jdGlvbiBub25lKCkge31cclxuXHJcbiAgY29uc3QgY29uID0gZnVuY3Rpb24gKC4uLmFyZ3M6IGFueVtdKSB7XHJcbiAgICAoY29uIGFzIGFueSkubG9nLmNhbGwoY29uLCAuLi5hcmdzKTtcclxuICB9O1xyXG4gIFJlZmxlY3Quc2V0UHJvdG90eXBlT2YoXHJcbiAgICBjb24sXHJcbiAgICBuZXcgUHJveHkoY29uc29sZSwge1xyXG4gICAgICBnZXQodDogYW55LCBwOiBzdHJpbmcpIHtcclxuICAgICAgICAvLyBcdThCQTFcdTdCOTdcdTY1RjZcdTk1RjRcclxuICAgICAgICBsZXQgbGV2ZWwgPSBsb2dMaXN0LmluZGV4T2YocCk7XHJcbiAgICAgICAgaWYgKGxldmVsIDwgMCkgcmV0dXJuIHRbcF07IC8vIFx1NEUwRFx1NTcyOExPR1x1NUI5QVx1NEU0OVx1NzY4NFx1NjVCOVx1NkNENVx1RkYwQ1x1OEZENFx1NTZERVx1NTM5Rlx1NTlDQlx1NTFGRFx1NjU3MFxyXG5cclxuICAgICAgICAvLyBkZWJ1Z2dlcjtcclxuICAgICAgICBpZiAobGV2ZWwgPD0gMiAmJiAhZW5hYmxlRGVidWcpIHtcclxuICAgICAgICAgICByZXR1cm4gbm9uZTsgLy8gXHU0RjRFXHU0RThFbGV2ZWwgXHU0RTBEXHU2NjNFXHU3OTNBXHJcbiAgICAgICAgfVxyXG5cclxuICAgICAgICBsZXQgdG0gPSBuZXcgRGF0ZSgpLmdldFRpbWUoKTtcclxuICAgICAgICBsZXQgc3BhbkFsbCA9IGxvZ2dlcmxhc3RUbSA+IDAgPyB0bSAtIGxvZ2dlcmxhc3RUbSA6IDA7XHJcbiAgICAgICAgbGV0IHNwYW5UaGlzID0gdGhpc2xhc3RUbSA+IDAgPyB0bSAtIHRoaXNsYXN0VG0gOiAwO1xyXG4gICAgICAgIGxvZ2dlcmxhc3RUbSA9IHRtO1xyXG4gICAgICAgIHRoaXNsYXN0VG0gPSB0bTtcclxuICAgICAgICByZXR1cm4gKGNvbnNvbGUgYXMgYW55KVtwXS5iaW5kKFxyXG4gICAgICAgICAgY29uc29sZSxcclxuICAgICAgICAgIGAlYyR7cC5zdWJzdHJpbmcoMCwgMSkudG9VcHBlckNhc2UoKX18JHtzcGFuQWxsfXwke3NwYW5UaGlzfSAlYyR7dGFnfWAsXHJcbiAgICAgICAgICB0aW1lU3R5bGUsXHJcbiAgICAgICAgICBmaWxlU3R5bGVcclxuICAgICAgICApO1xyXG4gICAgICB9LFxyXG4gICAgfSlcclxuICApO1xyXG4gIHJldHVybiBjb24gYXMgYW55IGFzIENvbnNvbGU7XHJcbn1cclxuXHJcbi8vIFx1NUI5QVx1NEU0OVx1NTE2OFx1NUM0MGxvZ1x1NUJGOVx1OEM2MVxyXG4oZ2xvYmFsVGhpcyBhcyBhbnkpLkxvZ2dlciA9IExvZ2dlcjtcclxuIiwgImltcG9ydCB7IExvZ2dlciB9IGZyb20gXCIuL2xvZ2dlclwiO1xyXG5cclxuY29uc3QgbG9nID0gTG9nZ2VyKFwiV09POlV0aWxzXCIpXHJcblxyXG5cclxuZXhwb3J0IGNvbnN0IFByb21pc2VFeHQgPSB7XHJcbiAgLyoqXHJcbiAgICogXHU4RDg1XHU2NUY2UHJvbWlzZVxyXG4gICAqIEBwYXJhbSBwcm9taXNlXHJcbiAgICogQHBhcmFtIHRpbWVvdXRNc1xyXG4gICAqIEByZXR1cm5zXHJcbiAgICovXHJcbiAgdGltZW91dChwcm9taXNlOiBQcm9taXNlPGFueT4sIHRpbWVvdXRNczogbnVtYmVyKSB7XHJcbiAgICByZXR1cm4gUHJvbWlzZS5yYWNlKFtcclxuICAgICAgcHJvbWlzZSxcclxuICAgICAgbmV3IFByb21pc2UoKHJlcywgcmVqKSA9PiB7XHJcbiAgICAgICAgc2V0VGltZW91dCgoKSA9PiB7XHJcbiAgICAgICAgICByZWooXCJ0aW1lb3V0XCIpO1xyXG4gICAgICAgIH0sIHRpbWVvdXRNcyk7XHJcbiAgICAgIH0pLFxyXG4gICAgXSk7XHJcbiAgfSxcclxuXHJcbiAgd2FpdCh0aW1lb3V0TXM6IG51bWJlcikge1xyXG4gICAgcmV0dXJuIG5ldyBQcm9taXNlKHJlcyA9PiB7XHJcbiAgICAgIHNldFRpbWVvdXQocmVzLCB0aW1lb3V0TXMpO1xyXG4gICAgfSk7XHJcbiAgfVxyXG59O1xyXG5cclxuXHJcbi8qKlxyXG4gKiBEZWZlciBcdTVGMDJcdTZCNjUgUHJvbWlzZSBcclxuICovXHJcbmV4cG9ydCBjbGFzcyBEZWZlcjxUID0gYW55PiB7XHJcbiAgcHJpdmF0ZSBfcmVzOiAodmFsdWU6IFQpID0+IHZvaWQgPSAoKSA9PiB7IH07XHJcbiAgcHJpdmF0ZSBfcmVqOiAocmVhc29uOiBhbnkpID0+IHZvaWQgPSAoKSA9PiB7IH07XHJcbiAgcHJpdmF0ZSBfcHJvbWlzZVxyXG5cclxuICBjb25zdHJ1Y3RvcihwdWJsaWMgbmFtZT86IHN0cmluZywgcHJpdmF0ZSBfdGltZW91dE1zID0gLTEpIHtcclxuICAgIGxldCBwID0gbmV3IFByb21pc2U8VD4oKHJlcywgcmVqKSA9PiB7XHJcbiAgICAgIHRoaXMuX3JlcyA9IHJlcztcclxuICAgICAgdGhpcy5fcmVqID0gcmVqO1xyXG4gICAgfSlcclxuICAgIHRoaXMuX3Byb21pc2UgPSBfdGltZW91dE1zID4gMCA/IFByb21pc2VFeHQudGltZW91dChwLCBfdGltZW91dE1zKSA6IHBcclxuXHJcbiAgfVxyXG4gIGFzeW5jIHJlc3VsdCh0aW1lb3V0OiBudW1iZXIgPSAtMSkge1xyXG4gICAgaWYgKHRpbWVvdXQgPiAwKSB7XHJcbiAgICAgIHJldHVybiBQcm9taXNlRXh0LnRpbWVvdXQodGhpcy5fcHJvbWlzZSwgdGltZW91dClcclxuICAgIH1cclxuICAgIHJldHVybiB0aGlzLl9wcm9taXNlO1xyXG4gIH1cclxuICByZXNsb3ZlKHJlc3VsdDogYW55KSB7XHJcbiAgICAvLyBsb2cuaW5mbygnRGVmZXIucmVzbG92ZScsIHRoaXMuX25hbWUsIHJlc3VsdClcclxuICAgIHRoaXMuX3JlcyhyZXN1bHQpO1xyXG4gIH1cclxuICByZWplY3QocmVhc29uOiBhbnkpIHtcclxuICAgIC8vIGxvZy5lcnJvcignRGVmZXIucmVqZWN0JywgdGhpcy5fbmFtZSwgcmVhc29uKVxyXG4gICAgdGhpcy5fcmVqKHJlYXNvbik7XHJcbiAgfVxyXG59XHJcblxyXG5leHBvcnQgY29uc3QgTmV0VXRpbHMgPSB7XHJcbiAgYXN5bmMgaHR0cEdldFRleHQodXJsOiBzdHJpbmcpIHtcclxuICAgIHJldHVybiBmZXRjaCh1cmwpLnRoZW4ocmVzID0+IHtcclxuICAgICAgaWYgKHJlcy5vaykge1xyXG4gICAgICAgIHJldHVybiByZXMudGV4dCgpXHJcbiAgICAgIH0gZWxzZSB7XHJcbiAgICAgICAgdGhyb3cgbmV3IEVycm9yKGAke3Jlcy5zdGF0dXN9ICR7cmVzLnN0YXR1c1RleHR9OiAke3VybH1gKVxyXG4gICAgICB9XHJcbiAgICB9KVxyXG4gIH0sXHJcbiAgYXN5bmMgaHR0cEdldEpzb24odXJsOiBzdHJpbmcpIHtcclxuICAgIHJldHVybiBKU09OLnBhcnNlKGF3YWl0IHRoaXMuaHR0cEdldFRleHQodXJsKSlcclxuICB9XHJcbn1cclxuXHJcblxyXG5cclxuZXhwb3J0IGNvbnN0IGlzV29ya2VyID0gIXNlbGYud2luZG93XHJcblxyXG5leHBvcnQgaW50ZXJmYWNlIElFbGVtSnNvbiB7XHJcbiAgdGFnOiBzdHJpbmdcclxuICBhdHRyczogeyBbazogc3RyaW5nXTogc3RyaW5nIH1cclxuICBjaGlsZHJlbjogKElFbGVtSnNvbiB8IHN0cmluZylbXVxyXG59XHJcblxyXG5leHBvcnQgY29uc3QgSnNVdGlscyA9IHtcclxuXHJcbiAgLyoqXHJcbiAgICogXHU1QkY5XHU4QzYxXHU2NjIwXHU1QzA0LFx1OEZDN1x1NkVFNHVuZGVmaW5lZFxyXG4gICAqIEBwYXJhbSBvYmogXHJcbiAgICogQHBhcmFtIGZuIFxyXG4gICAqIEByZXR1cm5zIFxyXG4gICAqL1xyXG4gIG9iamVjdE1hcDxUIGV4dGVuZHMgeyBbazogc3RyaW5nXTogYW55IH0sIFI+IChvYmo6IFQsIGZuOiAodjogVFtzdHJpbmddLCBrOiBzdHJpbmcpID0+IFIpOiB7IFtrIGluIGtleW9mIFRdOk5vbk51bGxhYmxlPFI+IH0ge1xyXG4gICAgbGV0IG5ld09iaiA9IHt9IGFzIGFueVxyXG4gICAgZm9yIChsZXQgayBvZiBPYmplY3Qua2V5cyhvYmopKSB7XHJcbiAgICAgIGxldCB2ID0gZm4ob2JqW2tdLCBrKVxyXG4gICAgICBpZiAodiAhPT0gdW5kZWZpbmVkKSBuZXdPYmpba10gPSB2XHJcbiAgICB9XHJcbiAgICByZXR1cm4gbmV3T2JqXHJcbiAgfSxcclxuXHJcbiAgb2JqZWN0TWFwVG9BcnJheTxUIGV4dGVuZHMgeyBbazogc3RyaW5nXTogYW55IH0sIFI+KG9iajogVCwgZm46ICh2OiBUW3N0cmluZ10sIGs6IHN0cmluZykgPT4gUik6IE5vbk51bGxhYmxlPFI+W10ge1xyXG4gICAgbGV0IGFyciA9IFtdIGFzIGFueVtdXHJcbiAgICBmb3IgKGxldCBrIG9mIE9iamVjdC5rZXlzKG9iaikpIHtcclxuICAgICAgbGV0IHYgPSBmbihvYmpba10sIGspXHJcbiAgICAgIGlmICh2ICE9PSB1bmRlZmluZWQpIGFyci5wdXNoKHYpXHJcbiAgICB9XHJcbiAgICByZXR1cm4gYXJyIFxyXG4gIH0sXHJcbiAgb2JqZWN0Rm9yRWFjaDxUIGV4dGVuZHMgeyBbazogc3RyaW5nXTogYW55IH0+KG9iajogVCwgZm46ICh2OiBUW3N0cmluZ10sIGs6IHN0cmluZykgPT4gdm9pZCkge1xyXG4gICAgZm9yIChsZXQgayBvZiBPYmplY3Qua2V5cyhvYmopKSB7XHJcbiAgICAgIGZuKG9ialtrXSwgaylcclxuICAgIH1cclxuICB9LFxyXG4gIGlzQ2xhc3Mob2JqOiBhbnkpOmJvb2xlYW4ge1xyXG4gICAgaWYoISh0eXBlb2Ygb2JqID09PSAnZnVuY3Rpb24nKSkgcmV0dXJuIGZhbHNlXHJcbiAgICB0cnl7XHJcbiAgICAgIGxldCB0bXAgPSBjbGFzcyBleHRlbmRzIG9iant9XHJcbiAgICAgIHJldHVybiB0cnVlXHJcbiAgICB9Y2F0Y2goZSl7XHJcbiAgICAgIHJldHVybiBmYWxzZVxyXG4gICAgfVxyXG4gIH0sXHJcblxyXG5cclxuXHJcblxyXG59XHJcblxyXG4iLCAiaW1wb3J0IHsgaXNXb3JrZXIgfSBmcm9tIFwiLi4vY29tbW9uXCI7XHJcblxyXG5leHBvcnQgbGV0IHdvcmtlciA9IHVuZGVmaW5lZCBhcyBXb3JrZXIgfCB1bmRlZmluZWQ7XHJcblxyXG5pZighaXNXb3JrZXIpe1xyXG4gICAgY29uc3Qgc3JjU2NyaXB0ID0gKGRvY3VtZW50LmN1cnJlbnRTY3JpcHQgYXMgSFRNTFNjcmlwdEVsZW1lbnQpLnNyYztcclxuICAgIGxldCB3b3JrZXJVcmwgPSBzcmNTY3JpcHQucmVwbGFjZSgvaW5kZXhcXC5qcyQvLCAnd29ya2VyL3dvcmtlci5qcycpXHJcbiAgICBjb25zb2xlLmxvZygnTWFpbldvcmtlckxvYWRlciA0NDonLHNyY1NjcmlwdCx3b3JrZXJVcmwpXHJcbiAgICB3b3JrZXIgPSAgbmV3IFdvcmtlcih3b3JrZXJVcmwse25hbWU6XCJXb29Xb3JrZXJcIn0pXHJcbn1cclxuIiwgIi8qKlxyXG4gKiBAZmlsZSBtZXNzYWdlSGFuZGxlLnRzXHJcbiAqIFdvcmtlclx1NTQ4Q01haW5cdTkwRkRcdThGREJcdTg4NENcdTVGMTVcdTc1MjhcdTc2ODRcdTUxNkNcdTUxNzFcdTUzMDVcdUZGMENcdTVCRkNcdTUxRkFcdTkwMUFcdThCQUZcdTZEODhcdTYwNkZcdTUzRTVcdTY3QzRcclxuICogXHU1NDBDXHU2NUY2XHU1OTgyXHU2NzlDXHU2NjJGXHU0RTNCXHU3RUJGXHU3QTBCXHU1MjE5XHU1MjFCXHU1RUZBV29ya2VyXHU3RUJGXHU3QTBCXHJcbiAqL1xyXG5cclxuaW1wb3J0IHsgd29ya2VyIH0gZnJvbSBcIi4vbWFpbi9tYWluV29ya2VyTG9hZGVyXCI7XHJcblxyXG5cclxuLy8gXHU1MTY4XHU1QzQwXHU2RDg4XHU2MDZGXHU1M0U1XHU2N0M0LFx1ODFFQVx1NTJBOFx1NjgzOVx1NjM2RVx1NUY1M1x1NTI0RFx1NzNBRlx1NTg4M1x1OTAwOVx1NjJFOVdvcmtlclx1N0VCRlx1N0EwQlx1NjIxNlx1ODAwNVx1NEUzQlx1N0VCRlx1N0EwQlxyXG5leHBvcnQgbGV0IGdsb2JhbE1lc3NhZ2VIYW5kbGUgPSAod29ya2VyIHx8IHNlbGYpIGFzIGFueSAgYXMge1xyXG4gICAgcG9zdE1lc3NhZ2U6IChtZXNzYWdlOiBhbnksIHRyYW5zZmVyPzogVHJhbnNmZXJhYmxlW10gfCB1bmRlZmluZWQpID0+IHZvaWQ7XHJcbiAgICBhZGRFdmVudExpc3RlbmVyOiAodHlwZTogc3RyaW5nLCBsaXN0ZW5lcjogKHRoaXM6IFdvcmtlciwgZXY6IE1lc3NhZ2VFdmVudCkgPT4gYW55LCBvcHRpb25zPzogYm9vbGVhbiB8IEFkZEV2ZW50TGlzdGVuZXJPcHRpb25zIHwgdW5kZWZpbmVkKSA9PiB2b2lkO1xyXG59O1xyXG5cclxuIiwgImltcG9ydCB7IExvZ2dlciB9IGZyb20gJy4vbG9nZ2VyJztcclxuaW1wb3J0IHsgRGVmZXIsIElFbGVtSnNvbiwgaXNXb3JrZXIgfSBmcm9tICcuL2NvbW1vbic7XHJcbmltcG9ydCB7IGdsb2JhbE1lc3NhZ2VIYW5kbGUgfSBmcm9tICcuL21lc3NhZ2VIYW5kbGUnO1xyXG5cclxuY29uc3QgbG9nID0gTG9nZ2VyKGBXT086TWVzc2FnZToke2lzV29ya2VyID8gJ1dvcmtlcicgOiAnTWFpbid9YCk7XHJcblxyXG4vLyBcdTUxNDNcdTdEMjBcdTVCOUFcdTRGNEQ6XHJcbi8vIFx1OTAxQVx1OEZDN2NpZCtlaWRcdTUzRUZcdTU1MkZcdTRFMDBcdTVCOUFcdTRGNERcdTRFMDBcdTRFMkFcdTUxNDNcdTdEMjBcclxuLy8gXHU1MTc2XHU0RTJEY2lkXHU0RTNBXHU3RUM0XHU0RUY2SURcdUZGMENcdTU1MkZcdTRFMDBcdTY4MDdcdThCQzZcdTRFMDBcdTRFMkFcdTdFQzRcdTRFRjZcdTVCOUVcdTRGOEJcclxuLy8gZWlkXHU0RTNBXHU1MTQzXHU3RDIwSURcdUZGMENcdTU1MkZcdTRFMDBcdTY4MDdcdThCQzZcdTRFMDBcdTRFMkFcdTdFQzRcdTRFRjZcdTUxODVcdTkwRThcdTc2ODRcdTRFMDBcdTRFMkFcdTUxNDNcdTdEMjBcclxuLy8gY2lkXHU3Njg0XHU1MjA2XHU5MTREXHU3NTMxXHJcblxyXG4vLyBcdTkwMUFcdTc1MjhcdTZEODhcdTYwNkZcdTY1NzBcdTYzNkVcdTdFRDNcdTY3ODRcclxuaW50ZXJmYWNlIElNZXNzYWdlU3RydWN0IHtcclxuICAvLyBcdThCRjdcdTZDNDJcdTZEODhcdTYwNkZcdTdDN0JcdTU3OEIsXHU2ODNDXHU1RjBGXHU0RTNBIFwiVzp4eHhcIiBcdTYyMTZcdTgwMDUgXCJNOnh4eFwiXHJcbiAgdHlwZTogc3RyaW5nO1xyXG4gIC8vIFx1NkQ4OFx1NjA2RklELFx1NkQ4OFx1NjA2Rlx1OEJGN1x1NkM0Mlx1NjVGNixcdTc1MjhcdTRFOEVcdTU1MkZcdTRFMDBcdTY4MDdcdThCQzZcdTRFMDBcdTRFMkFcdTZEODhcdTYwNkYsXHJcbiAgaWQ/OiBudW1iZXI7XHJcbiAgLy8gXHU1MjI0XHU2NUFEXHU2NjJGXHU1NDI2XHU0RTNBXHU1RTk0XHU3QjU0XHU2RDg4XHU2MDZGLFx1NTk4Mlx1Njc5Q1x1NEUzQVx1NUU5NFx1N0I1NFx1NkQ4OFx1NjA2RixcdTUyMTlcdTZCNjRcdTVCNTdcdTZCQjVcdTRFM0FcdThCRjdcdTZDNDJcdTZEODhcdTYwNkZcdTc2ODRJRFxyXG4gIHJlcGx5PzogbnVtYmVyO1xyXG4gIC8vIFx1NkQ4OFx1NjA2Rlx1NjU3MFx1NjM2RVxyXG4gIGRhdGE/OiBhbnk7XHJcbiAgLy8gXHU1OTgyXHU2NzlDXHU2MjY3XHU4ODRDXHU5NTE5XHU4QkVGLFx1NTIxOVx1NTkwNFx1NzQwNlx1OTUxOVx1OEJFRlx1NEZFMVx1NjA2RlxyXG4gIGVycj86IGFueTtcclxufVxyXG5cclxuY29uc3QgVElNRU9VVCA9IDUwMDAwMDtcclxudHlwZSBJTWVzc2FnZVR5cGUgPSBrZXlvZiBJTWVzc2FnZXM7XHJcblxyXG4vKipcclxuICogXHU2RDg4XHU2MDZGXHU3QzdCXHU1NzhCXHU1QjlBXHU0RTQ5LFwiVzpcIlx1NEUzQVdvcmtlclx1N0VCRlx1N0EwQlx1NkQ4OFx1NjA2RixcIk06XCJcdTRFM0FcdTRFM0JcdTdFQkZcdTdBMEJcdTZEODhcdTYwNkZcclxuICovXHJcbmludGVyZmFjZSBJTWVzc2FnZXMge1xyXG4gIC8vPT09PT09PT09IFx1NURFNVx1NEY1Q1x1N0VCRlx1N0EwQlx1NTNEMVx1OEQ3N1x1NEU4Qlx1NEVGNlx1RkYwQ1x1NEUzQlx1N0VCRlx1N0EwQlx1NTRDRFx1NUU5NCA9PT09PT09PT1cclxuXHJcbiAgLy8gXHU1RjUzV29ya2VyXHU3RUJGXHU3QTBCXHU1MUM2XHU1OTA3XHU1OTdEXHU2NUY2LFx1NTNEMVx1OTAwMVx1NkI2NFx1NkQ4OFx1NjA2RixcdTkwMUFcdTc3RTVcdTRFM0JcdTdFQkZcdTdBMEJXb3JrZXJcdTU0MkZcdTUyQThcdTVCOENcdTYyMTBcclxuICAnVzpSZWFkeSc6IHtcclxuICAgIHNlbmQ6IHt9O1xyXG4gICAgcmVwbHk6IHt9O1xyXG4gIH07XHJcbiAgLy8gXHU3NTMxXHU0RThFRG9tUGFyc2VcdTRFQzVcdTgwRkRcdTU3MjhcdTRFM0JcdTdFQkZcdTdBMEJcdThDMDNcdTc1MjhcdUZGMENcdTU2RTBcdTZCNjRcdUZGMENcdTVGNTNXb3JrZXJcdTdFQkZcdTdBMEJcdTk3MDBcdTg5ODFcdTg5RTNcdTY3OTBEb21cdTY1RjZcdUZGMENcdTUzRDFcdTkwMDFcdTZCNjRcdTZEODhcdTYwNkZcdTUyMzBcdTRFM0JcdTdFQkZcdTdBMEJcdUZGMENcdTc1MzFcdTRFM0JcdTdFQkZcdTdBMEJcdTg5RTNcdTY3OTBcdTVCOENcdTZCRDVcdTU0MEVcdThGRDRcdTU2REVcdTg5RTNcdTY3OTBcdTdFRDNcdTY3OUNcclxuICAnVzpQYXJzZVRwbCc6IHtcclxuICAgIHNlbmQ6IHsgdGV4dDogc3RyaW5nIH07XHJcbiAgICByZXBseTogeyB0cGw6IElFbGVtSnNvbiB9O1xyXG4gIH07XHJcblxyXG4gIC8vIFx1NUY1M1dvcmtlclx1N0VCRlx1N0EwQlx1OTcwMFx1ODk4MVx1OTg4NFx1NTJBMFx1OEY3RFx1NTE0M1x1N0QyMFx1NjVGNlx1RkYwQ1x1NTNEMVx1OTAwMVx1NkI2NFx1NkQ4OFx1NjA2Rlx1NTIzMFx1NEUzQlx1N0VCRlx1N0EwQlxyXG4gICdXOlJlZ2lzdGVyRWxlbSc6IHtcclxuICAgIHNlbmQ6IHsgcmVsVXJsOiBzdHJpbmc7IHRhZzogc3RyaW5nOyBhdHRyczogeyBba2V5OiBzdHJpbmddOiBzdHJpbmcgfSB9O1xyXG4gICAgcmVwbHk6IHsgZWxlbT86IHsgdGFnOiBzdHJpbmc7IGF0dHJzOiB7IFtrZXk6IHN0cmluZ106IHN0cmluZyB9IH0gfTtcclxuICB9O1xyXG5cclxuICAnVzpVcGRhdGVFbGVtJzoge1xyXG4gICAgc2VuZDogeyBjaWQ6IHN0cmluZzsgZWlkOiBzdHJpbmc7IGF0dHJzOiB7IFtrZXk6IHN0cmluZ106IHN0cmluZyB9IH07XHJcbiAgICByZXBseToge307XHJcbiAgfTtcclxuXHJcbiAgLy8gPT09PT09PSBcdTRFM0JcdTdFQkZcdTdBMEJcdTUzRDFcdThENzdcdTRFOEJcdTRFRjZcdUZGMENcdTVERTVcdTRGNUNcdTdFQkZcdTdBMEJcdTU0Q0RcdTVFOTQgPT09PT09PT09XHJcbiAgLy8gXHU2NkY0XHU2NUIwXHU1MTY4XHU1QzQwbWV0YVx1NUM1RVx1NjAyN1xyXG4gICdNOlNldE1ldGEnOiB7XHJcbiAgICBzZW5kOiB7XHJcbiAgICAgIG1ldGE6IElFbGVtSnNvbltdOyAvLyBcdTk3MDBcdTg5ODFcdTY2RjRcdTY1QjBcdTc2ODRtZXRhXHU1QzVFXHU2MDI3XHU1MjE3XHU4ODY4XHJcbiAgICAgIGh0bWxVcmw/OiBzdHJpbmc7IC8vIFx1NUY1M1x1NTI0RFx1OTg3NVx1OTc2Mlx1NzY4NFVybFxyXG4gICAgfTtcclxuICAgIHJlcGx5OiB7fTtcclxuICB9O1xyXG4gIC8vIFx1OEJGN1x1NkM0Mlx1NTJBMFx1OEY3RFx1NTE0M1x1N0QyMCxcdTRGMjBcdTUxNjVcdThCRjdcdTZDNDJcdTUyQTBcdThGN0RcdTc2ODRcdTUxNDNcdTdEMjBcdTY4MDdcdTdCN0VcdTU0OENcdTVDNUVcdTYwMjcsXHU0RTAwXHU4MjJDXHU3NTI4XHU0RThFXHU1NzI4XHU5OTk2XHU5ODc1XHU1MkEwXHU4RjdEXHU1NkZBXHU1QjlBXHU1MTQzXHU3RDIwXHU2MjE2XHU4MDA1XHU3MkVDXHU3QUNCXHU1MTQzXHU3RDIwKFx1NjVFMFx1NzIzNlx1NTE0M1x1N0QyMClcclxuICAnTTpMb2FkRWxlbSc6IHtcclxuICAgIHNlbmQ6IHsgdGFnOiBzdHJpbmc7IGF0dHJzOiB7IFtrOiBzdHJpbmddOiBzdHJpbmcgfTsgcmVsVXJsOiBzdHJpbmcgfTtcclxuICAgIHJlcGx5OiB7IHRhZzogc3RyaW5nOyBhdHRyczogeyBba2V5OiBzdHJpbmddOiBzdHJpbmcgfTsgY29udGVudDogc3RyaW5nIH07XHJcbiAgfTtcclxufVxyXG5cclxuLyoqXHJcbiAqIFx1NUI5RVx1NzNCMFdvcmtlclx1NTQ4Q1x1NEUzQlx1N0VCRlx1N0EwQlx1NzY4NFx1NkQ4OFx1NjA2Rlx1OTAxQVx1NEZFMSxcdTU5MDRcdTc0MDZcdTVFOTRcdTdCNTRcclxuICpcclxuICovXHJcbmV4cG9ydCBjbGFzcyBNZXNzYWdlIHtcclxuICBwcml2YXRlIF9tc2dJZCA9IGlzV29ya2VyID8gMTAwMDAgOiAxO1xyXG4gIHByaXZhdGUgX3dhaXRSZXBseSA9IG5ldyBNYXA8bnVtYmVyLCB7IHJlczogKGRhdGE6IGFueSkgPT4gdm9pZDsgcmVqOiAoZXJyOiBzdHJpbmcpID0+IHZvaWQgfT4oKTtcclxuICBwcml2YXRlIF9saXN0ZW5lcnMgPSBuZXcgTWFwPElNZXNzYWdlVHlwZSwgKGRhdGE6IGFueSkgPT4gUHJvbWlzZTxhbnk+PigpO1xyXG4gIHByaXZhdGUgX3dvcmtlclJlYWR5RGVmZXIgPSBuZXcgRGVmZXI8SU1lc3NhZ2VTdHJ1Y3Q+KCdXb3JrZXJSZWFkeScpO1xyXG5cclxuICBjb25zdHJ1Y3RvcigpIHtcclxuICAgIC8vIGxvZy5pbmZvKCdNZXNzYWdlLmNvbnN0cnVjdG9yJyk7XHJcbiAgICBnbG9iYWxNZXNzYWdlSGFuZGxlLmFkZEV2ZW50TGlzdGVuZXIoJ21lc3NhZ2UnLCB0aGlzLm9uTWVzc2FnZS5iaW5kKHRoaXMpKTtcclxuXHJcbiAgICBpZiAoaXNXb3JrZXIpIHtcclxuICAgICAgLy8gV29ya2VyXHU3RUJGXHU3QTBCXHVGRjBDXHU1M0QxXHU5MDAxV29ya2VyUmVhZHlcdTZEODhcdTYwNkZcclxuICAgICAgdGhpcy5zZW5kKCdXOlJlYWR5Jywge30pLnRoZW4oKGRhdGEpID0+IHtcclxuICAgICAgICB0aGlzLl93b3JrZXJSZWFkeURlZmVyLnJlc2xvdmUoZGF0YSk7XHJcbiAgICAgIH0pO1xyXG4gICAgfSBlbHNlIHtcclxuICAgICAgLy8gXHU0RTNCXHU3RUJGXHU3QTBCXHVGRjBDXHU3QjQ5XHU1Rjg1V29ya2VyUmVhZHlcdTZEODhcdTYwNkZcclxuICAgICAgdGhpcy5vbignVzpSZWFkeScsIGFzeW5jIChkYXRhKSA9PiB7XHJcbiAgICAgICAgdGhpcy5fd29ya2VyUmVhZHlEZWZlci5yZXNsb3ZlKGRhdGEpO1xyXG4gICAgICAgIHJldHVybiB7fTtcclxuICAgICAgfSk7XHJcbiAgICAgIHRoaXMuX3dvcmtlclJlYWR5RGVmZXIucmVzdWx0KCkudGhlbigoKSA9PiB7XHJcbiAgICAgICAgbG9nLmluZm8oJ1dvcmtlclJlYWR5Jyk7XHJcbiAgICAgIH0pO1xyXG4gICAgfVxyXG4gIH1cclxuXHJcbiAgb25NZXNzYWdlKGV2OiBNZXNzYWdlRXZlbnQpIHtcclxuICAgIGNvbnN0IGRhdGEgPSBldi5kYXRhIGFzIElNZXNzYWdlU3RydWN0O1xyXG4gICAgaWYgKGRhdGEucmVwbHkpIHtcclxuICAgICAgLy8gXHU1OTA0XHU3NDA2XHU1RTk0XHU3QjU0XHU2RDg4XHU2MDZGXHJcbiAgICAgIGNvbnN0IHJlcGx5ID0gdGhpcy5fd2FpdFJlcGx5LmdldChkYXRhLnJlcGx5KTtcclxuICAgICAgLy8gbG9nLmluZm8oJzw8PSBSZXBseSBNZXNzYWdlICcsIGRhdGEpO1xyXG4gICAgICBpZiAocmVwbHkpIHtcclxuICAgICAgICBpZiAoZGF0YS5lcnIpIHJlcGx5LnJlaihkYXRhLmVycik7XHJcbiAgICAgICAgZWxzZSByZXBseS5yZXMoZGF0YS5kYXRhKTtcclxuICAgICAgICB0aGlzLl93YWl0UmVwbHkuZGVsZXRlKGRhdGEucmVwbHkpO1xyXG4gICAgICB9IGVsc2Uge1xyXG4gICAgICAgIGxvZy53YXJuKCdNZXNzYWdlLm9uTWVzc2FnZScsICdyZXBseSBub3QgZm91bmQnLCBkYXRhKTtcclxuICAgICAgfVxyXG4gICAgfSBlbHNlIHtcclxuICAgICAgLy8gXHU1OTA0XHU3NDA2XHU4QkY3XHU2QzQyXHU2RDg4XHU2MDZGXHJcbiAgICAgIC8vIGxvZy5pbmZvKCc9Pj4gUmVjZWl2ZWQgTWVzc2FnZScsIGRhdGEpO1xyXG4gICAgICBjb25zdCBsaXN0ZW5lciA9IHRoaXMuX2xpc3RlbmVycy5nZXQoZGF0YS50eXBlIGFzIElNZXNzYWdlVHlwZSk7XHJcbiAgICAgIGlmIChsaXN0ZW5lcikge1xyXG4gICAgICAgIGxpc3RlbmVyKGRhdGEuZGF0YSlcclxuICAgICAgICAgIC50aGVuKChyZXN1bHQ6IGFueSkgPT4ge1xyXG4gICAgICAgICAgICBnbG9iYWxNZXNzYWdlSGFuZGxlLnBvc3RNZXNzYWdlKHtcclxuICAgICAgICAgICAgICB0eXBlOiBkYXRhLnR5cGUsXHJcbiAgICAgICAgICAgICAgcmVwbHk6IGRhdGEuaWQsXHJcbiAgICAgICAgICAgICAgZGF0YTogcmVzdWx0LFxyXG4gICAgICAgICAgICB9KTtcclxuICAgICAgICAgIH0pXHJcbiAgICAgICAgICAuY2F0Y2goKGVycjogYW55KSA9PiB7XHJcbiAgICAgICAgICAgIGxvZy5lcnJvcihgb25NZXNzYWdlICR7ZGF0YS50eXBlfWAsIGVycik7XHJcbiAgICAgICAgICAgIGdsb2JhbE1lc3NhZ2VIYW5kbGUucG9zdE1lc3NhZ2Uoe1xyXG4gICAgICAgICAgICAgIHJlcGx5OiBkYXRhLmlkLFxyXG4gICAgICAgICAgICAgIGVycjogZXJyLFxyXG4gICAgICAgICAgICB9KTtcclxuICAgICAgICAgIH0pO1xyXG4gICAgICB9IGVsc2Uge1xyXG4gICAgICAgIGxvZy53YXJuKCdNZXNzYWdlLm9uTWVzc2FnZScsICdsaXN0ZW5lciBub3QgZm91bmQnLCBkYXRhKTtcclxuICAgICAgfVxyXG4gICAgfVxyXG4gIH1cclxuXHJcbiAgLy8gXHU1M0QxXHU5MDAxXHU2RDg4XHU2MDZGLFx1NUU3Nlx1ODNCN1x1NTNENlx1OEZENFx1NTZERVx1N0VEM1x1Njc5Q1xyXG4gIGFzeW5jIHNlbmQ8VCBleHRlbmRzIElNZXNzYWdlVHlwZT4oXHJcbiAgICB0eXBlOiBULFxyXG4gICAgZGF0YTogSU1lc3NhZ2VzW1RdWydzZW5kJ10sXHJcbiAgICB0cmFuc2Zlcj86IGFueVtdXHJcbiAgKTogUHJvbWlzZTxJTWVzc2FnZXNbVF1bJ3JlcGx5J10+IHtcclxuICAgIGlmICghaXNXb3JrZXIpIHtcclxuICAgICAgLy8gXHU0RTNCXHU3RUJGXHU3QTBCXHVGRjBDXHU3QjQ5XHU1Rjg1V29ya2VyXHU1MUM2XHU1OTA3XHU1OTdEXHJcbiAgICAgIGF3YWl0IHRoaXMuX3dvcmtlclJlYWR5RGVmZXIucmVzdWx0KCk7XHJcbiAgICB9XHJcblxyXG4gICAgcmV0dXJuIG5ldyBQcm9taXNlKChyZXMsIHJlaikgPT4ge1xyXG4gICAgICBjb25zdCBpZCA9IHRoaXMuX21zZ0lkKys7XHJcbiAgICAgIHRoaXMuX3dhaXRSZXBseS5zZXQoaWQsIHsgcmVzLCByZWogfSk7XHJcbiAgICAgIC8vIFx1OEQ4NVx1NjVGNlx1NTkwNFx1NzQwNlxyXG4gICAgICBzZXRUaW1lb3V0KCgpID0+IHtcclxuICAgICAgICBpZiAodGhpcy5fd2FpdFJlcGx5LmhhcyhpZCkpIHtcclxuICAgICAgICAgIHRoaXMuX3dhaXRSZXBseS5kZWxldGUoaWQpO1xyXG4gICAgICAgICAgcmVqKCd0aW1lb3V0Jyk7XHJcbiAgICAgICAgICAvLyBsb2cuZXJyb3IoJ01lc3NhZ2Uuc2VuZCcsICd0aW1lb3V0JywgdHlwZSwgZGF0YSlcclxuICAgICAgICB9XHJcbiAgICAgIH0sIFRJTUVPVVQpO1xyXG4gICAgICAvLyBcdTUzRDFcdTkwMDFcdTZEODhcdTYwNkZcclxuICAgICAgZ2xvYmFsTWVzc2FnZUhhbmRsZS5wb3N0TWVzc2FnZShcclxuICAgICAgICB7XHJcbiAgICAgICAgICB0eXBlLFxyXG4gICAgICAgICAgaWQsXHJcbiAgICAgICAgICBkYXRhLFxyXG4gICAgICAgIH0sXHJcbiAgICAgICAgdHJhbnNmZXJcclxuICAgICAgKTtcclxuICAgIH0pO1xyXG4gIH1cclxuXHJcbiAgb248VCBleHRlbmRzIElNZXNzYWdlVHlwZT4odHlwZTogVCwgY2FsbGJhY2s6IChkYXRhOiBJTWVzc2FnZXNbVF1bJ3NlbmQnXSkgPT4gUHJvbWlzZTxJTWVzc2FnZXNbVF1bJ3JlcGx5J10+KSB7XHJcbiAgICB0aGlzLl9saXN0ZW5lcnMuc2V0KHR5cGUsIGNhbGxiYWNrKTtcclxuICB9XHJcbn1cclxuXHJcbmV4cG9ydCBjb25zdCBtZXNzYWdlID0gbmV3IE1lc3NhZ2UoKTtcclxuIiwgImltcG9ydCB7IElFbGVtSnNvbiB9IGZyb20gXCIuLi9jb21tb25cIlxyXG5cclxuXHJcbmV4cG9ydCBjb25zdCBEb21VdGlscyA9IHtcclxuICBpc1VucmVnaXN0ZXJXZWJDb21wb25lbnRUYWcodGFnOiBzdHJpbmcpIHtcclxuICAgIHJldHVybiB0YWcuaW5jbHVkZXMoJy0nKSAmJiAhY3VzdG9tRWxlbWVudHMuZ2V0KHRhZylcclxuICB9LFxyXG5cclxuICBkZWVwQ2hpbGRFbGVtZW50KHBhcmVudDogSFRNTEVsZW1lbnQsIGNhbGxiYWNrOiAoZWw6IEhUTUxFbGVtZW50KSA9PiB2b2lkIHwgUHJvbWlzZTx2b2lkPikge1xyXG4gICAgY29uc3QgcHJvbWlzZXMgPSBbXSBhcyBQcm9taXNlPHZvaWQ+W11cclxuICAgIGZvciAobGV0IGkgPSAwOyBpIDwgcGFyZW50LmNoaWxkcmVuLmxlbmd0aDsgaSsrKSB7XHJcbiAgICAgIGNvbnN0IGVsID0gcGFyZW50LmNoaWxkcmVuW2ldIGFzIEhUTUxFbGVtZW50XHJcbiAgICAgIGNvbnN0IHJ0ID0gY2FsbGJhY2soZWwpXHJcbiAgICAgIGlmIChydCkgcHJvbWlzZXMucHVzaChydClcclxuICAgICAgdGhpcy5kZWVwQ2hpbGRFbGVtZW50KGVsLCBjYWxsYmFjaylcclxuICAgIH1cclxuICAgIHJldHVybiBQcm9taXNlLmFsbChwcm9taXNlcylcclxuICB9LFxyXG4gIGVsZW1BdHRycyhlbDogRWxlbWVudCkge1xyXG4gICAgbGV0IGF0dHJzID0ge30gYXMgYW55XHJcbiAgICBmb3IgKGxldCBpID0gMDsgaSA8IGVsLmF0dHJpYnV0ZXMubGVuZ3RoOyBpKyspIHtcclxuICAgICAgY29uc3QgYXR0ciA9IGVsLmF0dHJpYnV0ZXNbaV1cclxuICAgICAgYXR0cnNbYXR0ci5uYW1lXSA9IGF0dHIudmFsdWVcclxuICAgIH1cclxuICAgIHJldHVybiBhdHRyc1xyXG4gIH0sXHJcbiAgZWxUb0pzb24oZWw6IEVsZW1lbnQpOiBJRWxlbUpzb24ge1xyXG4gICAgcmV0dXJuIHtcclxuICAgICAgdGFnOiBlbC50YWdOYW1lLnRvTG93ZXJDYXNlKCksXHJcbiAgICAgIGF0dHJzOiB0aGlzLmVsZW1BdHRycyhlbCksXHJcbiAgICAgIGNoaWxkcmVuOiAoKGVsIGluc3RhbmNlb2YgSFRNTFRlbXBsYXRlRWxlbWVudCkgPyBBcnJheS5mcm9tKGVsLmNvbnRlbnQuY2hpbGROb2RlcykgOiBBcnJheS5mcm9tKGVsLmNoaWxkTm9kZXMpKS5tYXAobm9kZSA9PiB7XHJcbiAgICAgICAgaWYgKG5vZGUgaW5zdGFuY2VvZiBUZXh0ICYmIG5vZGUubm9kZVZhbHVlIS50cmltKCkubGVuZ3RoID4gMCkge1xyXG4gICAgICAgICAgcmV0dXJuIG5vZGUubm9kZVZhbHVlPy50cmltKCk7XHJcbiAgICAgICAgfSBlbHNlIGlmIChub2RlIGluc3RhbmNlb2YgRWxlbWVudCkge1xyXG4gICAgICAgICAgcmV0dXJuIHRoaXMuZWxUb0pzb24obm9kZSlcclxuICAgICAgICB9XHJcbiAgICAgIH1cclxuICAgICAgKS5maWx0ZXIodiA9PiB2ICE9IG51bGwpIGFzIElFbGVtSnNvbltdXHJcbiAgICB9XHJcbiAgfSxcclxuICByZW5hbWVFbGVtVGFnKGVsOiBFbGVtZW50LCBuZXdUYWc6IHN0cmluZykge1xyXG4gICAgY29uc3QgbmV3RWwgPSBkb2N1bWVudC5jcmVhdGVFbGVtZW50KG5ld1RhZylcclxuICAgIGZvciAobGV0IGkgPSAwOyBpIDwgZWwuYXR0cmlidXRlcy5sZW5ndGg7IGkrKykge1xyXG4gICAgICBjb25zdCBhdHRyID0gZWwuYXR0cmlidXRlc1tpXVxyXG4gICAgICBuZXdFbC5zZXRBdHRyaWJ1dGUoYXR0ci5uYW1lLCBhdHRyLnZhbHVlKVxyXG4gICAgfVxyXG4gICAgQXJyYXkuZnJvbShlbC5jaGlsZE5vZGVzKS5mb3JFYWNoKG5vZGUgPT4gbmV3RWwuYXBwZW5kQ2hpbGQobm9kZSkpXHJcbiAgICBlbC5yZXBsYWNlV2l0aChuZXdFbClcclxuICAgIHJldHVybiBuZXdFbFxyXG4gIH1cclxuXHJcbn1cclxuXHJcbiIsICJpbXBvcnQgeyBJRWxlbUpzb24gfSBmcm9tICcuLi9jb21tb24nO1xyXG5pbXBvcnQgeyBEb21VdGlscyB9IGZyb20gJy4vbWFpbkRvbVV0aWxzJztcclxuaW1wb3J0IHsgTG9nZ2VyIH0gZnJvbSAnLi4vbG9nZ2VyJztcclxuaW1wb3J0IHsgbWVzc2FnZSB9IGZyb20gJy4uL21lc3NhZ2UnO1xyXG5cclxuLy8gXHU1QjlFXHU3M0IwV2ViQ29tcG9uZW50c1x1NzZGOFx1NTE3M1x1NzY4NFx1NTI5Rlx1ODBGRCxcdThGRDBcdTg4NENcdTRFOEVcdTRFM0JcdTdFQkZcdTdBMEJcclxuLy8gXHU2N0U1XHU2MjdFXHU1M0Q4XHU2NkY0XHU3Njg0XHU3RUM0XHU0RUY2XHU2MjE2XHU4MDA1XHU1MTQzXHU3RDIwLFx1NEUwMFx1NkIyMVx1NjAyN1x1NTJBMFx1OEY3RFx1NTQ4Q1x1NjZGNFx1NjVCMFx1NjI0MFx1NjcwOVx1NTNEOFx1NTMxNlx1NTE4NVx1NUJCOVx1RkYwQ1x1NjNEMFx1OUFEOFx1NjAyN1x1ODBGRFxyXG4vLyBcdTdFQzRcdTRFRjZcdTY4MDdcdTdCN0U6IFx1NEVDNVx1NjUyRlx1NjMwMVx1NTE2OFx1NzlGMFxyXG5jb25zdCBsb2cgPSBMb2dnZXIoJ1dPTzpNYWluQ29tcG9uZW50Jyk7XHJcblxyXG5leHBvcnQgY29uc3QgY29tcG9uZW50UmVnaXN0cnkgPSBuZXcgTWFwPHN0cmluZywgTWFpbkNvbXBvbmVudD4oKTtcclxuXHJcbmV4cG9ydCBjbGFzcyBCYXNlQ29tcG9uZW50IGV4dGVuZHMgSFRNTEVsZW1lbnQge1xyXG4gIGNvbnN0cnVjdG9yKCkge1xyXG4gICAgc3VwZXIoKTtcclxuICAgIC8vIFx1OEJGQlx1NTNENl9jaWRcdTVDNUVcdTYwMjcsXHU4M0I3XHU1M0Q2XHU3RUM0XHU0RUY2XHU1MTg1XHU1QkI5LFx1NkRGQlx1NTJBMFx1NTIzMHNoYWRvd1Jvb3RcclxuICAgIC8vIFx1ODNCN1x1NTNENlx1N0VDNFx1NEVGNlx1NTE4NVx1NUJCOVxyXG4gICAgY29uc3QgY2lkID0gdGhpcy5nZXRBdHRyaWJ1dGUoJ19jaWQnKTtcclxuICAgIGxvZy5pbmZvKCdCYXNlQ29tcG9uZW50IGNvbnN0cnVjdG9yJywgdGhpcy50YWdOYW1lLCBjaWQpO1xyXG4gICAgaWYgKGNpZCkge1xyXG4gICAgICBjb25zdCBjb21wID0gY29tcG9uZW50UmVnaXN0cnkuZ2V0KGNpZCk7XHJcbiAgICAgIGlmIChjb21wKSB7XHJcbiAgICAgICAgY29tcC5hdHRhY2hFbGVtZW50KHRoaXMpO1xyXG4gICAgICAgIGNvbnN0IGluaXREYXRhID0gY29tcC5nZXRJbml0RGF0YSgpISE7XHJcbiAgICAgICAgZm9yIChjb25zdCBrIGluIGluaXREYXRhLmF0dHJzKSB7XHJcbiAgICAgICAgICB0aGlzLnNldEF0dHJpYnV0ZShrLCBpbml0RGF0YS5hdHRyc1trXSk7XHJcbiAgICAgICAgfVxyXG4gICAgICAgIHRoaXMuYXR0YWNoU2hhZG93KHsgbW9kZTogJ29wZW4nIH0pLmlubmVySFRNTCA9IGluaXREYXRhLmNvbnRlbnQ7XHJcbiAgICAgIH0gZWxzZSB7XHJcbiAgICAgICAgbG9nLmVycm9yKCdCYXNlQ29tcG9uZW50JywgJ0NvbXBvbmVudCBub3QgZm91bmQnLCBjaWQpO1xyXG4gICAgICB9XHJcbiAgICB9XHJcbiAgfVxyXG4gIGNvbm5lY3RlZENhbGxiYWNrKCkge1xyXG4gICAgbG9nLmluZm8oJ2Nvbm5lY3RlZENhbGxiYWNrJywgdGhpcy50YWdOYW1lLnRvTG93ZXJDYXNlKCkpO1xyXG4gICAgdGhpcy5zZXRBdHRyaWJ1dGUoJ19yZWFkeScsICcnKTtcclxuICB9XHJcbiAgYWRvcHRlZENhbGxiYWNrKCkge1xyXG4gIH1cclxuICBhdHRyaWJ1dGVDaGFuZ2VkQ2FsbGJhY2sobmFtZTogc3RyaW5nLCBvbGRWYWx1ZTogc3RyaW5nLCBuZXdWYWx1ZTogc3RyaW5nKSB7XHJcbiAgICAvLyBcdTVDNUVcdTYwMjdcdTUzRDhcdTUzMTZcdThEREZcdThFMkFcclxuICB9XHJcblxyXG4gIGRpc2Nvbm5lY3RlZENhbGxiYWNrKCkge1xyXG4gICAgbG9nLmluZm8oJ2Rpc2Nvbm5lY3RlZENhbGxiYWNrJywgdGhpcy50YWdOYW1lLnRvTG93ZXJDYXNlKCkpO1xyXG4gICAgY29uc3QgY2lkID0gdGhpcy5nZXRBdHRyaWJ1dGUoJ19jaWQnKTtcclxuICAgIGlmIChjaWQpIHtcclxuICAgICAgLy8gXHU5MDFBXHU3N0U1d29ya2VyXHU3RUJGXHU3QTBCXHU1MjIwXHU5NjY0XHU3RUM0XHU0RUY2XHJcbiAgICAgIGNvbXBvbmVudFJlZ2lzdHJ5LmRlbGV0ZShjaWQpO1xyXG4gICAgfVxyXG4gIH1cclxufVxyXG5cclxuLyoqXHJcbiAqIFx1NEUzQlx1N0VCRlx1N0EwQlx1N0VDNFx1NEVGNiwgXHU0RTNCXHU3RUJGXHU3QTBCXHU3RUM0XHU0RUY2XHU1M0VGXHU0RUU1XHU5MDFBXHU4RkM3XHU0RjIwXHU1MTY1XHU1MTQzXHU3RDIwXHU2MjE2XHU4MDA1XHU1MTQzXHU3RDIwXHU2M0NGXHU4RkYwXHU1QkY5XHU4QzYxLFx1Njc2NVx1NTIxQlx1NUVGQVx1N0VDNFx1NEVGNlx1NUI5RVx1NEY4QlxyXG4gKi9cclxuZXhwb3J0IGNsYXNzIE1haW5Db21wb25lbnQge1xyXG4gIHN0YXRpYyBfY2lkQ291bnRlciA9IDE7XHJcbiAgLy8gXHU3RUM0XHU0RUY2XHU1QjlFXHU0RjhCSUQsXHU3NTMxXHU0RTNCXHU3RUJGXHU3QTBCXHU3NTFGXHU2MjEwXHU1RTc2XHU0RTNBXHU2QkNGXHU0RTAwXHU0RTJBXHU2NzA5XHU2NTQ4XHU3Njg0V09PXHU3RUM0XHU0RUY2XHU1MjA2XHU5MTREXHU0RTAwXHU0RTJBXHU1NTJGXHU0RTAwXHU3Njg0SURcclxuICBwdWJsaWMgX2NpZDpzdHJpbmdcclxuXHJcbiAgcHJpdmF0ZSBfdGFnID0gJyc7XHJcbiAgcHJpdmF0ZSBfbG9hZFByb21pc2U6IFByb21pc2U8dm9pZD47XHJcbiAgcHJpdmF0ZSBfYXR0cnM6IHsgW2tleTogc3RyaW5nXTogc3RyaW5nIH0gPSB7fTtcclxuICBwcml2YXRlIF9yb290RWxlbT86IEhUTUxFbGVtZW50O1xyXG4gIHByaXZhdGUgX2luaXREYXRhPzogeyB0YWc6IHN0cmluZzsgYXR0cnM6IHsgW2tleTogc3RyaW5nXTogc3RyaW5nIH07IGNvbnRlbnQ6IHN0cmluZyB9O1xyXG5cclxuICAvKipcclxuICAgKlxyXG4gICAqIEBwYXJhbSBfcmVsIFx1NUYxNVx1NzUyOFx1Njc2NVx1NkU5MCxcdTUzRUZcdTRFRTVcdTY2MkZVcmxcdTYyMTZcdTgwMDVOcG1cdTUzMDVcdTU0MERcclxuICAgKiBAcGFyYW0gZWwgXHU1MTQzXHU3RDIwXHJcbiAgICovXHJcbiAgY29uc3RydWN0b3IoZWw6IEhUTUxFbGVtZW50IHwgeyB0YWc6IHN0cmluZzsgYXR0cnM6IHsgW2s6IHN0cmluZ106IHN0cmluZyB9OyByZWxVcmw6IHN0cmluZyB9KSBcclxuICB7XHJcbiAgICBpZiAoZWwgaW5zdGFuY2VvZiBIVE1MRWxlbWVudCkge1xyXG4gICAgICB0aGlzLl9jaWQgPSBgJHtlbC50YWdOYW1lLnRvTG93ZXJDYXNlKCl9LSR7TWFpbkNvbXBvbmVudC5fY2lkQ291bnRlcisrfWBcclxuICAgICAgZWwuc2V0QXR0cmlidXRlKCdfY2lkJywgdGhpcy5fY2lkKTtcclxuICAgIH0gZWxzZSB7XHJcbiAgICAgIHRoaXMuX2NpZCA9IGAke2VsLnRhZ30tJHtNYWluQ29tcG9uZW50Ll9jaWRDb3VudGVyKyt9YFxyXG4gICAgICBlbC5hdHRyc1snX2NpZCddID0gdGhpcy5fY2lkO1xyXG4gICAgfVxyXG5cclxuICAgIGNvbnN0IHJlcUluZm8gPVxyXG4gICAgICBlbCBpbnN0YW5jZW9mIEhUTUxFbGVtZW50XHJcbiAgICAgICAgPyB7XHJcbiAgICAgICAgICAgIHRhZzogZWwudGFnTmFtZS50b0xvd2VyQ2FzZSgpLFxyXG4gICAgICAgICAgICBhdHRyczogRG9tVXRpbHMuZWxlbUF0dHJzKGVsKSxcclxuICAgICAgICAgICAgcmVsVXJsOiBgJHtsb2NhdGlvbi5vcmlnaW59JHtsb2NhdGlvbi5wYXRobmFtZX1gLFxyXG4gICAgICAgICAgfVxyXG4gICAgICAgIDogZWw7XHJcbiAgICB0aGlzLl9sb2FkUHJvbWlzZSA9IG1lc3NhZ2Uuc2VuZCgnTTpMb2FkRWxlbScsIHJlcUluZm8pLnRoZW4oKGRhdGEpID0+IHtcclxuICAgICAgdGhpcy5faW5pdERhdGEgPSBkYXRhO1xyXG4gICAgICB0aGlzLl90YWcgPSBkYXRhLnRhZztcclxuICAgICAgdGhpcy5fYXR0cnMgPSBkYXRhLmF0dHJzO1xyXG4gICAgICBpZiAoZWwgaW5zdGFuY2VvZiBIVE1MRWxlbWVudCkge1xyXG4gICAgICAgIC8vIFx1NjhDMFx1NkQ0Qlx1NjgwN1x1N0I3RVx1NEUwMFx1ODFGNFx1NjAyN1xyXG4gICAgICAgIGlmIChlbC50YWdOYW1lICE9IGRhdGEudGFnKSB7XHJcbiAgICAgICAgICBEb21VdGlscy5yZW5hbWVFbGVtVGFnKGVsLCBkYXRhLnRhZyk7XHJcbiAgICAgICAgfVxyXG4gICAgICB9XHJcbiAgICAgIGNvbXBvbmVudFJlZ2lzdHJ5LnNldCh0aGlzLl9jaWQsIHRoaXMpO1xyXG4gICAgfSk7XHJcbiAgfVxyXG4gIGdldCB0YWcoKSB7XHJcbiAgICByZXR1cm4gdGhpcy5fdGFnO1xyXG4gIH1cclxuICBnZXQgYXR0cnMoKSB7XHJcbiAgICByZXR1cm4gdGhpcy5fYXR0cnM7XHJcbiAgfVxyXG4gIGdldCByb290RWxlbSgpIHtcclxuICAgIHJldHVybiB0aGlzLl9yb290RWxlbTtcclxuICB9XHJcblxyXG4gIGFzeW5jIHdhaXRMb2FkKGF1dG9BcHBseSA9IHRydWUpIHtcclxuICAgIGF3YWl0IHRoaXMuX2xvYWRQcm9taXNlO1xyXG4gICAgaWYgKGF1dG9BcHBseSkgdGhpcy5fYXBwbHkoKTtcclxuICB9XHJcbiAgZ2V0SW5pdERhdGEoKSB7XHJcbiAgICByZXR1cm4gdGhpcy5faW5pdERhdGE7XHJcbiAgfVxyXG4gIGF0dGFjaEVsZW1lbnQoZWw6IEhUTUxFbGVtZW50KSB7XHJcbiAgICB0aGlzLl9yb290RWxlbSA9IGVsO1xyXG4gIH1cclxuICBwcml2YXRlIF9hcHBseSgpIHtcclxuICAgIC8vIFx1NkNFOFx1NTE4Q1x1NjgwN1x1N0I3RVxyXG4gICAgaWYgKCFjdXN0b21FbGVtZW50cy5nZXQodGhpcy5fdGFnKSkge1xyXG4gICAgICAvLyBcdTZDRThcdTUxOENcdTY4MDdcdTdCN0VcclxuICAgICAgY29uc3QgY2xzID0gY2xhc3MgZXh0ZW5kcyBCYXNlQ29tcG9uZW50IHt9O1xyXG4gICAgICBjdXN0b21FbGVtZW50cy5kZWZpbmUodGhpcy5fdGFnLCBjbHMpO1xyXG4gICAgICBsb2cuZGVidWcoJ3JlZ2lzdGVyV2ViQ29tcG9uZW50cycsIHRoaXMuX3RhZyk7XHJcbiAgICB9XHJcbiAgfVxyXG4gIHN0YXRpYyBhc3luYyBsb2FkQ29tcG9uZW50KCkge1xyXG4gICAgY29uc3QgbG9hZFByb21pc2VzID0gW10gYXMgUHJvbWlzZTxhbnk+W107XHJcblxyXG4gICAgLy8gMS4gXHU4M0I3XHU1M0Q2XHU2MjQwXHU2NzA5XHU3Njg0bWV0YVx1NjgwN1x1N0I3RSxcdTVFNzZcdTY2RjRcdTY1QjBcdTUyMzBXb3JrZXJcdTdFQkZcdTdBMEJcclxuICAgIGNvbnN0IG1ldGEgPSBbXSBhcyBJRWxlbUpzb25bXTtcclxuICAgIGRvY3VtZW50LnF1ZXJ5U2VsZWN0b3JBbGwoJ21ldGEnKS5mb3JFYWNoKChlbCkgPT4ge1xyXG4gICAgICBjb25zdCBuYW1lID0gZWwuZ2V0QXR0cmlidXRlKCduYW1lJyk7XHJcbiAgICAgIGlmIChuYW1lPy5zdGFydHNXaXRoKCdXT086JykpIHtcclxuICAgICAgICBtZXRhLnB1c2goRG9tVXRpbHMuZWxUb0pzb24oZWwpKTtcclxuICAgICAgfVxyXG4gICAgfSk7XHJcbiAgICBsb2FkUHJvbWlzZXMucHVzaChtZXNzYWdlLnNlbmQoJ006U2V0TWV0YScsIHsgbWV0YSwgaHRtbFVybDogYCR7bG9jYXRpb24ub3JpZ2lufSR7bG9jYXRpb24ucGF0aG5hbWV9YCB9KSk7XHJcbiAgICBjb25zdCBkb2NDb21wb25lbnRzID0gW10gYXMgTWFpbkNvbXBvbmVudFtdO1xyXG4gICAgLy8gMi4gXHU4M0I3XHU1M0Q2XHU2MjQwXHU2NzA5XHU2NzJBXHU2Q0U4XHU1MThDXHU3Njg0TWFpbkNvbXBvbmVudHNcdTY4MDdcdTdCN0UsXHU1MjFCXHU1RUZBXHU3RUM0XHU0RUY2XHU1QjlFXHU0RjhCXHJcbiAgICBEb21VdGlscy5kZWVwQ2hpbGRFbGVtZW50KGRvY3VtZW50LmJvZHksIChlbCkgPT4ge1xyXG4gICAgICBpZiAoRG9tVXRpbHMuaXNVbnJlZ2lzdGVyV2ViQ29tcG9uZW50VGFnKGVsLnRhZ05hbWUpKSB7XHJcbiAgICAgICAgZG9jQ29tcG9uZW50cy5wdXNoKG5ldyBNYWluQ29tcG9uZW50KGVsKSk7XHJcbiAgICAgIH1cclxuICAgIH0pO1xyXG4gIFxyXG4gICAgLy8gMy4gXHU3QjQ5XHU1Rjg1XHU3RUM0XHU0RUY2XHU1QjlFXHU0RjhCXHU2QTIxXHU2NzdGXHU1MkEwXHU4RjdEXHU1QjhDXHU2QkQ1XHJcbiAgICBsb2FkUHJvbWlzZXMucHVzaCguLi5kb2NDb21wb25lbnRzLm1hcCgoY29tcCkgPT4gY29tcC53YWl0TG9hZChmYWxzZSkpKTtcclxuICBcclxuICAgIGF3YWl0IFByb21pc2UuYWxsKGxvYWRQcm9taXNlcyk7XHJcbiAgICAvLyA0LiBcdTRFMDBcdTZCMjFcdTYwMjdcdTZDRThcdTUxOENcdTYyNDBcdTY3MDlXZWJDb21wb25lbnRzXHU3RUM0XHU0RUY2XHJcbiAgICBkb2NDb21wb25lbnRzLmZvckVhY2goKGNvbXApID0+IGNvbXAuX2FwcGx5KCkpOyAgICBcclxuICB9XHJcbn1cclxuXHJcbiIsICJ7XG4gIFwibmFtZVwiOiBcIkB3b29qcy93b29cIixcbiAgXCJ2ZXJzaW9uXCI6IFwiMi4wLjRcIixcbiAgXCJkZXNjcmlwdGlvblwiOiBcIndvbyB3ZWIgY29tcG9uZW50cyBmcmFtZXdvcmtcIixcbiAgXCJtYWluXCI6IFwiaW5kZXguanNcIixcbiAgXCJzY3JpcHRzXCI6IHtcbiAgICBcIndcIjogXCJlc2J1aWxkIHNyYy9pbmRleC50cyBzcmMvd29ya2VyL3dvcmtlci50cyAtLWJ1bmRsZSAtLW91dGRpcj1idWlsZCAgLS1zb3VyY2VtYXA9aW5saW5lICAtLXdhdGNoIC0tc2VydmVkaXI9LiAtLWZvcm1hdD1paWZlXCIsXG4gICAgXCJkXCI6IFwiZXNidWlsZCBzcmMvaW5kZXgudHMgIHNyYy93b3JrZXIvd29ya2VyLnRzIC0tYnVuZGxlIC0tb3V0ZGlyPS4vZGV2L3dvby8gLS1zb3VyY2VtYXA9aW5saW5lIC0tZm9ybWF0PWlpZmVcIixcbiAgICBcImJcIjogXCJlc2J1aWxkIHNyYy9pbmRleC50cyAgc3JjL3dvcmtlci50cyAtLWJ1bmRsZSAtLW1pbmlmeSAtLW91dGRpcj0uL2Rpc3QvIC0tYW5hbHl6ZSBcIixcbiAgICBcInB1YlwiOiBcImNkIGRpc3QgJiYgbnBtIC0tcmVnaXN0cnkgXFxcImh0dHBzOi8vcmVnaXN0cnkubnBtanMub3JnL1xcXCIgcHVibGlzaCAtLWFjY2VzcyBwdWJsaWNcIixcbiAgICBcInRlc3RcIjogXCJjeXByZXNzIG9wZW5cIixcbiAgICBcImluaXQtZ2xvYmFsXCI6XCJwbnBtIGkgLWcgY3lwcmVzcyBlc2J1aWxkIHR5cGVzY3JpcHRcIlxuICB9LFxuICBcImtleXdvcmRzXCI6IFtcbiAgICBcIndlYmNvbXBvbmVudHNcIixcbiAgICBcIndvb1wiLFxuICAgIFwid29vanNcIixcbiAgICBcIndlYlwiLFxuICAgIFwiY29tcG9uZW50c1wiXG4gIF0sXG4gIFwiYXV0aG9yXCI6IFwiemhmanlxQGdtYWlsLmNvbVwiLFxuICBcImxpY2Vuc2VcIjogXCJNSVRcIixcbiAgXCJkZXZEZXBlbmRlbmNpZXNcIjoge1xuICAgIFwiY3lwcmVzc1wiOiBcIl4xMy4xMi4wXCIsXG4gICAgXCJ0eXBlc2NyaXB0XCI6IFwiXjUuNC41XCJcbiAgfVxufVxuIiwgIi8vIFx1NEUzQlx1N0VCRlx1N0EwQlx1NTkwNFx1NzQwNlx1NkQ4OFx1NjA2RlxyXG5cclxuaW1wb3J0IHsgRG9tVXRpbHMgfSBmcm9tIFwiLi9tYWluRG9tVXRpbHNcIjtcclxuaW1wb3J0IHsgTG9nZ2VyIH0gZnJvbSBcIi4uL2xvZ2dlclwiO1xyXG5pbXBvcnQgeyBCYXNlQ29tcG9uZW50LCBNYWluQ29tcG9uZW50IH0gZnJvbSBcIi4vbWFpbkNvbXBvbmVudFwiO1xyXG5pbXBvcnQgeyBtZXNzYWdlIH0gZnJvbSBcIi4uL21lc3NhZ2VcIjtcclxuY29uc3QgbG9nID0gTG9nZ2VyKCdXT086TWFpbk1lc3NhZ2UnKVxyXG5cclxubWVzc2FnZS5vbignVzpQYXJzZVRwbCcsIGFzeW5jIChkYXRhKSA9PiB7XHJcbiAgICBsZXQgdHBsID0gZG9jdW1lbnQuY3JlYXRlRWxlbWVudCgndGVtcGxhdGUnKVxyXG4gICAgdHBsLmlubmVySFRNTCA9IGRhdGEudGV4dFxyXG4gICAgbGV0IGVsZW0gPSB0cGwuY29udGVudC5maXJzdEVsZW1lbnRDaGlsZCBhcyBIVE1MRWxlbWVudFxyXG4gICAgaWYgKCFlbGVtKSB0aHJvdyBuZXcgRXJyb3IoJ1BhcnNlVHBsOiBubyBlbGVtZW50JylcclxuXHJcbiAgICByZXR1cm4geyB0cGw6IERvbVV0aWxzLmVsVG9Kc29uKGVsZW0pIH1cclxufSlcclxuXHJcbi8qKlxyXG4gKiBcdTVERTVcdTRGNUNcdTdFQkZcdTdBMEJcdTU3MjhcdTg5RTNcdTY3OTBcdTZBMjFcdTY3N0ZcdTY1RjZcdUZGMENcdTU5ODJcdTY3OUNcdTUzRDFcdTczQjBcdTY1QjBcdTc2ODR0YWcsXHU1MjE5XHU1M0QxXHU5MDAxXHU2QjY0XHU2RDg4XHU2MDZGXHU4QkY3XHU2QzQyXHU0RTNCXHU3RUJGXHU3QTBCXHU5ODg0XHU1MkEwXHU4RjdEXHU1MTQzXHU3RDIwXHJcbiAqIFx1NEUzQlx1N0VCRlx1N0EwQlx1NjhDMFx1NkQ0Qlx1NkI2NFx1NjgwN1x1N0I3RVx1NjYyRlx1NTQyNlx1NURGMlx1N0VDRlx1NkNFOFx1NTE4QyxcdTU5ODJcdTY3OUNcdTY3MkFcdTZDRThcdTUxOEMsXHU1MjE5XHU1MkEwXHU4RjdEXHU1MTQzXHU3RDIwXHJcbiAqL1xyXG5tZXNzYWdlLm9uKCdXOlJlZ2lzdGVyRWxlbScsIGFzeW5jIChkYXRhKSA9PiB7XHJcbiAgICAvLyBcdTZCNjRcdTUxNDNcdTdEMjBcdTVERjJcdTdFQ0ZcdTZDRThcdTUxOEMsXHU0RTBEXHU1MDVBXHU1OTA0XHU3NDA2XHVGRjBDXHU0RTVGXHU1M0VGXHU4MEZEXHU2NjJGXHU3QjJDXHU0RTA5XHU2NUI5XHU3RUM0XHU0RUY2XHJcbiAgICBsZXQgY2xzID0gY3VzdG9tRWxlbWVudHMuZ2V0KGRhdGEudGFnKVxyXG4gICAgaWYoY2xzICYmICEoY2xzIGluc3RhbmNlb2YgQmFzZUNvbXBvbmVudCkpe1xyXG4gICAgICAgIGxvZy5kZWJ1Zygnc2tpcCB0aGlyZCBwYXJ0eSBjb21wb25lbnQ6JyxkYXRhLnRhZylcclxuICAgICAgICByZXR1cm4ge31cclxuICAgIH1cclxuXHJcbiAgICBsZXQgY29tcCA9IG5ldyBNYWluQ29tcG9uZW50KGRhdGEpXHJcbiAgICBhd2FpdCBjb21wLndhaXRMb2FkKClcclxuICAgIGxvZy53YXJuKFwiPT09PT09PT09PT09PT4+Pj5cIixjb21wLnRhZyxjb21wLmF0dHJzKVxyXG5cclxuICAgIHJldHVybiB7XHJcbiAgICAgICAgZWxlbTp7XHJcbiAgICAgICAgICAgIHRhZzpjb21wLnRhZyxcclxuICAgICAgICAgICAgYXR0cnM6Y29tcC5hdHRyc1xyXG4gICAgICAgIH1cclxuICAgIH1cclxufSkiLCAiaW1wb3J0ICcuL21lc3NhZ2UnXG5pbXBvcnQgeyBNYWluQ29tcG9uZW50IH0gZnJvbSBcIi4vbWFpbi9tYWluQ29tcG9uZW50XCI7XG5pbXBvcnQgcGtnIGZyb20gJy4uL3BhY2thZ2UuanNvbidcbmltcG9ydCBcIi4vbWVzc2FnZUhhbmRsZVwiXG5pbXBvcnQgXCIuL21haW4vbWFpbk1lc3NhZ2VcIlxuaW1wb3J0IHsgTG9nZ2VyIH0gZnJvbSAnbG9nZ2VyJztcblxuY29uc29sZS5sb2coJ1Bvd2VyIEJ5ICcsIHBrZy5uYW1lLCBwa2cudmVyc2lvbik7XG5jb25zdCBsb2cgPSBMb2dnZXIoXCJ3b286aW5kZXhcIilcblxuY29uc3Qgc3RhcnRUbSA9IERhdGUubm93KClcbmNvbnN0IHJvb3RFbCA9IGRvY3VtZW50LmhlYWQucGFyZW50RWxlbWVudCEhXG4vLyBcdTRFM0FcdTkwN0ZcdTUxNERcdTU0MkZcdTUyQThcdTY1RjZcdTc2ODRcdTk1RUFcdTcwQzEsaHRtbFx1NTNFRlx1OTAxQVx1OEZDNyA8c3R5bGU+IFx1NjgwN1x1N0I3RVx1NTIxRFx1NTlDQlx1NTMxNlx1OTY5MFx1ODVDRmJvZHlcdTVCRjlcdThDNjFcblxud2luZG93LmFkZEV2ZW50TGlzdGVuZXIoJ0RPTUNvbnRlbnRMb2FkZWQnLCAoKSA9PiB7XG4gICAgY29uc29sZS5sb2coJ0RPTUNvbnRlbnRMb2FkZWQnKVxuICAgIE1haW5Db21wb25lbnQubG9hZENvbXBvbmVudCgpLnRoZW4oKCkgPT4ge1xuICAgICAgICBkb2N1bWVudC5ib2R5LnNldEF0dHJpYnV0ZSgnX3JlYWR5JywgJycpXG4gICAgICAgIGNvbnNvbGUubG9nKCdET01Db250ZW50TG9hZGVkJywgJ2xvYWREb3VtZW50JywgRGF0ZS5ub3coKSAtIHN0YXJ0VG0pXG4gICAgICAgIC8vIFx1NTNEMVx1OTAwMVx1NEU4Qlx1NEVGNlx1OTAxQVx1NzdFNVx1NjU3NFx1NEUyQVx1OTg3NVx1OTc2Mlx1NTJBMFx1OEY3RFx1NUI4Q1x1NkJENVxuICAgICAgICB3aW5kb3cuZGlzcGF0Y2hFdmVudChuZXcgRXZlbnQoJ1dvb1JlYWR5JykpXG4gICAgfSlcbn0pIFxuXG5uZXcgRXZlbnRTb3VyY2UoJy9lc2J1aWxkJykuYWRkRXZlbnRMaXN0ZW5lcignY2hhbmdlJywgKGV2KSA9PiB7XG4gICAgbG9nLndhcm4oJ2VzYnVpbGQgLS0tPiBjaGFuZ2UnLCBldilcbn0pXG5cbi8vIFx1ODNCN1x1NTNENlx1NUY1M1x1NTI0RFx1ODExQVx1NjcyQ1x1NzY4NFx1OERFRlx1NUY4NFxuZXhwb3J0IGRlZmF1bHQge31cblxuIl0sCiAgIm1hcHBpbmdzIjogIjs7O0FBV0EsTUFBSSxlQUFlO0FBRW5CLE1BQU0sY0FBYyxDQUFDLENBQUUsWUFBWSxjQUFjLFFBQVEsT0FBTztBQVF6RCxXQUFTLE9BQU8sS0FBYTtBQUNsQyxVQUFNLElBQUksS0FBSyxNQUFNLEtBQUssT0FBTyxJQUFJLEdBQUc7QUFDeEMsVUFBTSxZQUFZLGFBQWEsQ0FBQztBQUNoQyxVQUFNLFlBQVksYUFBYSxDQUFDO0FBRWhDLFFBQUksYUFBYTtBQUdqQixVQUFNLFVBQVUsQ0FBQyxTQUFTLE9BQU8sUUFBUSxRQUFRLE9BQU87QUFDeEQsYUFBUyxPQUFPO0FBQUEsSUFBQztBQUVqQixVQUFNLE1BQU0sWUFBYSxNQUFhO0FBQ3BDLE1BQUMsSUFBWSxJQUFJLEtBQUssS0FBSyxHQUFHLElBQUk7QUFBQSxJQUNwQztBQUNBLFlBQVE7QUFBQSxNQUNOO0FBQUEsTUFDQSxJQUFJLE1BQU0sU0FBUztBQUFBLFFBQ2pCLElBQUksR0FBUSxHQUFXO0FBRXJCLGNBQUksUUFBUSxRQUFRLFFBQVEsQ0FBQztBQUM3QixjQUFJLFFBQVEsRUFBRyxRQUFPLEVBQUUsQ0FBQztBQUd6QixjQUFJLFNBQVMsS0FBSyxDQUFDLGFBQWE7QUFDN0IsbUJBQU87QUFBQSxVQUNWO0FBRUEsY0FBSSxNQUFLLG9CQUFJLEtBQUssR0FBRSxRQUFRO0FBQzVC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
