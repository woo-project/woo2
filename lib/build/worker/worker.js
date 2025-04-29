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
  var NetUtils = {
    async httpGetText(url) {
      return fetch(url).then((res) => {
        if (res.ok) {
          return res.text();
        } else {
          throw new Error(`${res.status} ${res.statusText}: ${url}`);
        }
      });
    },
    async httpGetJson(url) {
      return JSON.parse(await this.httpGetText(url));
    }
  };
  var isWorker = !self.window;
  var JsUtils = {
    /**
     * 对象映射,过滤undefined
     * @param obj 
     * @param fn 
     * @returns 
     */
    objectMap(obj, fn) {
      let newObj = {};
      for (let k of Object.keys(obj)) {
        let v = fn(obj[k], k);
        if (v !== void 0) newObj[k] = v;
      }
      return newObj;
    },
    objectMapToArray(obj, fn) {
      let arr = [];
      for (let k of Object.keys(obj)) {
        let v = fn(obj[k], k);
        if (v !== void 0) arr.push(v);
      }
      return arr;
    },
    objectForEach(obj, fn) {
      for (let k of Object.keys(obj)) {
        fn(obj[k], k);
      }
    },
    isClass(obj) {
      if (!(typeof obj === "function")) return false;
      try {
        let tmp = class extends obj {
        };
        return true;
      } catch (e) {
        return false;
      }
    }
  };

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

  // src/worker/workerMeta.ts
  var _LOCAL_TAG_PREFIX = "self";
  var workerMeta = new class WorkerMeta {
    constructor() {
      this.npmUrl = "/node_modules/";
      this.homeUrl = "/";
    }
    normalizeTag(tag, relUrl) {
      if (tag.includes(".")) return tag;
      if (relUrl.match(/^https?:\/\//) != null) {
        return _LOCAL_TAG_PREFIX + "." + tag;
      } else {
        return relUrl.replace(/-/, "_").replace(/@/, "").replace(/\//g, "-") + "." + tag;
      }
    }
    // 从标签名转换为组件路径前缀
    tagPathPrefix(tag) {
      let [s1, s2] = tag.split(".");
      if (s2.endsWith("-")) s2 = s2.slice(0, -1);
      const path = s2.replace(/-/g, "/").replace(/_(\w)/g, (_, s) => s.toUpperCase());
      if (s1 == _LOCAL_TAG_PREFIX) {
        return this.homeUrl + path;
      } else {
        let pkg = s1.replace(/-/g, "/").replace(/_/g, "-");
        if (pkg.includes("/")) pkg = "@" + pkg;
        return this.npmUrl + pkg + "/" + path;
      }
    }
    setHomeUrl(url) {
      this.homeUrl = url.replace(/[^/]*$/, "");
    }
    setMeta(meta) {
    }
  }();

  // src/worker/workerScope.ts
  var log3 = Logger("workerScope");
  var TRIGGER_NOTICE_INTERVAL = 5;
  var SymObjectObserver = Symbol("SymObjectObserver");
  var SymObjectVisitTicks = Symbol("SymObjectVisited");
  var SymObjectInitPropDesc = Symbol("SymObjectInitPropDesc");
  var SymScopeProto = Symbol("ScopeProto");
  var SymWorkerNativeObject = Symbol("WorkerNativeObject");
  [
    MessagePort,
    ImageBitmap,
    OffscreenCanvas,
    ImageData,
    Blob,
    File,
    FileList,
    FormData,
    ReadableStream,
    Response,
    URL,
    URLSearchParams,
    Worker,
    globalThis["WorkLocation"],
    TextDecoder,
    TextEncoder,
    FileReader,
    WebSocket,
    Performance,
    XMLHttpRequest,
    XMLHttpRequestEventTarget,
    XMLHttpRequestUpload,
    OffscreenCanvas,
    OffscreenCanvasRenderingContext2D
  ].forEach((v) => {
    if (v)
      Object.defineProperty(v, SymWorkerNativeObject, {
        value: true,
        writable: false,
        enumerable: false
      });
  });
  var _globalScopeNotifier = new class ScopeNotifier {
    constructor() {
      this._noticeSets = /* @__PURE__ */ new Map();
      setInterval(() => {
        this._triggerNotice();
      }, TRIGGER_NOTICE_INTERVAL);
    }
    // 添加一个通知对象,添加和记录原始跟踪对象
    // 这样可以增加性能，当频繁变更时，只记录最后一次变更
    // 最终在执行时进行一次合并计算
    addNoticeSet(scopeName, set) {
      log3.info(`==>addNoticeSet: ${scopeName}-> ${[...set].join(",")}`);
      let noticeSet = this._noticeSets.get(scopeName);
      if (!noticeSet) {
        noticeSet = /* @__PURE__ */ new Set();
        this._noticeSets.set(scopeName, noticeSet);
      }
      noticeSet.add(set);
    }
    _triggerNotice() {
      this._noticeSets.forEach((noticeSet, scopeName) => {
        let mergedSet = /* @__PURE__ */ new Set();
        noticeSet.forEach((set) => {
          set.forEach((k) => mergedSet.add(k));
        });
        let scope = _globalScopesMap.get(scopeName);
        if (scope) {
          log3.info("triggerNotice", scopeName, mergedSet);
          mergedSet.forEach((k) => {
            try {
              scope.execTraceOnChangedCallback(k);
            } catch (e) {
              log3.error(`triggerNotice error: ${scopeName}->${k}`, e);
            }
          });
        }
      });
      this._noticeSets.clear();
    }
  }();
  var ScopeDependents = class {
    constructor(scopeName) {
      // 对象自身的依赖变更对象，当对象变化时，通知所有依赖的对象
      // 此依赖项在其其他对象的属性中变化时，记录依赖，以在自身变化时，如delete时，通知依赖对象
      this._selfDependents = /* @__PURE__ */ new Set();
      // 记录属性依赖对象
      this._propDependents = /* @__PURE__ */ new Map();
    }
    addSelfDependent(key) {
      this._selfDependents.add(key);
    }
    addPropDependent(key, prop) {
      let set = this._propDependents.get(prop);
      if (!set) {
        set = /* @__PURE__ */ new Set();
        this._propDependents.set(prop, set);
      }
      set.add(key);
    }
    getPropDependents(key) {
      return this._propDependents.get(key);
    }
    getSelfDependents() {
      return this._selfDependents;
    }
  };
  var _globalTraceKey = void 0;
  var _globalScopesMap = /* @__PURE__ */ new Map();
  var WorkerScope = class {
    constructor(_scopeName, _initObject) {
      this._scopeName = _scopeName;
      this._rootScope = {};
      this._traceCallbacks = /* @__PURE__ */ new Map();
      log3.info("new WorkerScope", _scopeName, _initObject);
      this._rootScope = this._initRootScope(_initObject || {});
      _globalScopesMap.set(_scopeName, this);
    }
    // 初始化传入的预定义对象
    _initRootScope(obj) {
      let root = {};
      if (obj instanceof Function) {
        try {
          root = new obj();
        } catch (e) {
          log3.warn("root object not class", this._scopeName);
        }
      } else if (typeof obj === "object") {
        root = obj;
      } else {
        log3.error("root object not object", this._scopeName, typeof obj, obj);
      }
      root = this._makeObserver(root);
      Reflect.setPrototypeOf(this._findObjectProtoRoot(root), this._createRootProto());
      return root;
    }
    _createRootProto() {
      let _this = this;
      return {
        // 获取根作用域对象
        get $rootScope() {
          return _this._rootScope;
        }
      };
    }
    get rootScope() {
      return this._rootScope;
    }
    release() {
      _globalScopesMap.delete(this._scopeName);
    }
    /**
     * 作用域跟踪调用
     * @TODO: 未来支持多个跟踪对象,也就是当在callFunc中再次调用traceCall时,可进行同步跟踪
     * @param key
     * @param func
     * @returns
     */
    traceCall(key, calcFunc, changedCallback) {
      this._traceCallbacks.set(key, {
        calcFunc,
        changedCallback
      });
      _globalTraceKey = key;
      let ret = calcFunc();
      _globalTraceKey = void 0;
      return ret;
    }
    untraceCall(key) {
      this._traceCallbacks.delete(key);
    }
    // 重新计算待执行的函数，并返回结果，调用回调函数
    execTraceOnChangedCallback(key) {
      let cb = this._traceCallbacks.get(key);
      log3.info("execExistdTraceCall", key, cb);
      if (cb) {
        _globalTraceKey = key;
        let ret = cb.calcFunc();
        _globalTraceKey = void 0;
        cb.changedCallback(ret);
      }
    }
    _findObjectProtoRoot(obj) {
      let proto = Object.getPrototypeOf(obj);
      if (proto === null || proto === Object.prototype) return obj;
      return this._findObjectProtoRoot(proto);
    }
    _saveObjectInitPropDesc(obj, prop) {
      let desc = Reflect.getOwnPropertyDescriptor(obj, prop);
      if (desc) {
        obj[SymObjectInitPropDesc][prop] = desc;
      }
    }
    _getObjectInitPropDesc(obj, prop) {
      return obj[SymObjectInitPropDesc][prop];
    }
    /**
     * 将当前元素的属性转换为get/set属性,实现属性变更跟踪
     */
    _makeObjectPropGetSet(obj, prop) {
      const _this = this;
      let dependents = obj[SymObjectObserver];
      if (!dependents) {
        log3.warn("not observer object", obj);
        return;
      }
      let desc = Reflect.getOwnPropertyDescriptor(obj, prop);
      if (!desc || !desc.configurable || !desc.enumerable || !desc.writable || typeof desc.value === "function") {
        return;
      }
      _this._saveObjectInitPropDesc(obj, prop);
      Reflect.defineProperty(obj, prop, {
        get() {
          _this._traceObjectProp(obj, prop);
          let initGet = _this._getObjectInitPropDesc(obj, prop)?.get;
          let v = initGet ? initGet() : desc.value;
          _this._traceObjectSelf(v);
          return v;
        },
        set(value) {
          log3.info("ObjectSet", obj, prop, value);
          _this._noticePropChanged(obj, prop);
          let obValue = _this._makeObserver(value);
          let initSet = _this._getObjectInitPropDesc(obj, prop)?.set;
          if (initSet) {
            initSet(obValue);
          } else {
            desc.value = obValue;
          }
          return true;
        }
      });
    }
    _traceObjectProp(obj, prop) {
      if (_globalTraceKey) {
        obj[SymObjectObserver]?.addPropDependent(_globalTraceKey, prop);
      }
    }
    _traceObjectSelf(obj) {
      if (_globalTraceKey) {
        if (typeof obj === "object" && obj !== null) {
          obj[SymObjectObserver]?.addSelfDependent(_globalTraceKey);
        }
      }
    }
    _noticePropChanged(obj, prop) {
      let dependents = obj[SymObjectObserver];
      if (!dependents) return;
      let propDeps = dependents.getPropDependents(prop);
      if (propDeps && propDeps.size > 0) {
        _globalScopeNotifier.addNoticeSet(this._scopeName, propDeps);
      }
    }
    _noticeSelfChanged(obj) {
      let dependents = obj[SymObjectObserver];
      if (!dependents) return;
      let selfDeps = dependents.getSelfDependents();
      if (selfDeps.size > 0) {
        _globalScopeNotifier.addNoticeSet(this._scopeName, selfDeps);
      }
    }
    _makeObserverObject(obj) {
      let _this = this;
      Reflect.ownKeys(obj).forEach((k) => {
        if (typeof k !== "string") return;
        _this._makeObjectPropGetSet(obj, k);
      });
      let oldProto = Reflect.getPrototypeOf(obj) || {};
      if (typeof oldProto == "object" && !Object.getOwnPropertyDescriptor(obj, SymScopeProto)) {
        let newProto = Object.create(oldProto);
        Object.defineProperty(newProto, SymScopeProto, {
          value: true
        });
        Reflect.setPrototypeOf(
          obj,
          new Proxy(newProto, {
            get(target, prop) {
              if (Reflect.has(target, prop)) return Reflect.get(target, prop);
              if (typeof prop !== "string") return void 0;
              _this._traceObjectProp(obj, prop);
              return void 0;
            },
            set(target, prop, value, receiver) {
              if (Reflect.has(target, prop)) return Reflect.set(target, prop, value, receiver);
              if (typeof prop !== "string") {
                Reflect.defineProperty(obj, prop, { value, writable: true, enumerable: true, configurable: true });
                return true;
              }
              log3.info("ObjectNewProp", obj, prop, value);
              let oldValue = Reflect.get(obj, prop);
              Reflect.defineProperty(obj, prop, {
                value: _this._makeObserver(value),
                writable: true,
                enumerable: true,
                configurable: true
              });
              _this._makeObjectPropGetSet(obj, prop);
              _this._noticePropChanged(obj, prop);
              let visitedTicks = (/* @__PURE__ */ new Date()).getTime();
              function _deepNoticeObj(obj2) {
                if (typeof obj2 !== "object") return;
                let objDependents = obj2[SymObjectObserver];
                if (!objDependents) return;
                if (Reflect.get(obj2, SymObjectVisitTicks) === visitedTicks) return;
                Reflect.defineProperty(obj2, SymObjectVisitTicks, { value: visitedTicks });
                _this._noticeSelfChanged(obj2);
                Reflect.ownKeys(obj2).forEach((k) => {
                  if (typeof k !== "string") return;
                  _this._noticePropChanged(obj2, k);
                  let value2 = Reflect.get(obj2, k);
                  _deepNoticeObj(value2);
                });
              }
              _deepNoticeObj(oldValue);
              return true;
            },
            // 删除属性，需通知当前对象自身的依赖
            deleteProperty(target, p) {
              log3.info("deleteProperty", obj, p);
              delete obj[p];
              if (typeof p !== "string") return true;
              _this._noticePropChanged(obj, p);
              _this._noticeSelfChanged(obj);
              return true;
            }
          })
        );
      }
      return new Proxy(obj, {
        deleteProperty(target, p) {
          log3.info("deleteProperty", target, p);
          Reflect.deleteProperty(target, p);
          if (typeof p !== "string") return true;
          _this._noticePropChanged(target, p);
          _this._noticeSelfChanged(target);
          return true;
        }
      });
    }
    _makeObserverArray(arr) {
      let _this = this;
      return new Proxy(arr, {
        get(target, prop) {
          let v = Reflect.get(target, prop);
          if (typeof prop != "string") return v;
          if (typeof v === "function") {
            if (prop === "push") {
              return (...args) => {
                let ret = Reflect.apply(v, target, args);
                _this._noticeSelfChanged(target);
                for (let i = 0; i < args.length; i++) {
                  _this._traceObjectProp(target, (target.length - args.length + i).toString());
                }
                return ret;
              };
            } else if (prop === "pop") {
              return () => {
                let ret = Reflect.apply(v, target, []);
                _this._noticePropChanged(target, (target.length - 1).toString());
                _this._noticeSelfChanged(target);
                return ret;
              };
            } else if (prop === "shift") {
              return () => {
                for (let i = 0; i < target.length; i++) {
                  _this._noticePropChanged(target, i.toString());
                }
                let ret = Reflect.apply(v, target, []);
                _this._noticeSelfChanged(target);
                return ret;
              };
            } else if (prop === "unshift") {
              return (...args) => {
                let ret = Reflect.apply(v, target, args);
                _this._noticeSelfChanged(target);
                for (let i = 0; i < target.length; i++) {
                  _this._noticePropChanged(target, i.toString());
                }
                return ret;
              };
            } else if (prop === "splice") {
              return (...args) => {
                let ret = Reflect.apply(v, target, args);
                let start = args[0];
                if (start < 0) start = target.length + start;
                let deleteCount = args[1];
                if (deleteCount < 0) deleteCount = 0;
                let addCount = args.length - 2;
                if (addCount < 0) addCount = 0;
                let changedCount = Math.max(deleteCount, addCount);
                for (let i = 0; i < changedCount; i++) {
                  _this._noticePropChanged(target, (start + i).toString());
                }
                _this._noticeSelfChanged(target);
                return ret;
              };
            } else if (prop === "reverse" || prop === "sort") {
              return (...args) => {
                let oldLength = target.length;
                let ret = Reflect.apply(v, target, args);
                let changedCount = Math.max(oldLength, target.length);
                for (let i = 0; i < changedCount; i++) {
                  _this._noticePropChanged(target, i.toString());
                }
                _this._noticeSelfChanged(target);
                return ret;
              };
            } else if (prop === "copyWithin") {
              return (...args) => {
                let targetIndex = args[0];
                let start = args[1];
                if (start < 0) start = target.length + start;
                let end = args[2];
                if (end === void 0) end = target.length - start;
                if (end < 0) end = target.length + end;
                let changedCount = Math.min(end - start, target.length - targetIndex);
                let ret = Reflect.apply(v, target, args);
                for (let i = 0; i < changedCount; i++) {
                  _this._noticePropChanged(target, (targetIndex + i).toString());
                }
                _this._noticeSelfChanged(target);
                return ret;
              };
            } else if (prop === "fill") {
              return (...args) => {
                let targetIndex = args[1];
                let end = args[2];
                if (end === void 0) end = target.length;
                if (end < 0) end = target.length + end;
                let changedCount = Math.min(end - targetIndex, target.length - targetIndex);
                let ret = Reflect.apply(v, target, args);
                for (let i = 0; i < changedCount; i++) {
                  _this._noticePropChanged(target, (targetIndex + i).toString());
                }
                _this._noticeSelfChanged(target);
                return ret;
              };
            } else {
              _this._traceObjectProp(target, prop.toString());
              return (...args) => {
                let ret = Reflect.apply(v, target, args);
                _this._noticePropChanged(target, prop.toString());
                return ret;
              };
            }
          }
          _this._traceObjectProp(arr, prop.toString());
          if (prop === "length") {
            _this._traceObjectSelf(arr);
          }
          return v;
        },
        set(target, prop, value) {
          _this._noticePropChanged(target, prop.toString());
          return Reflect.set(arr, prop, _this._makeObserver(value));
        }
      });
      return arr;
    }
    _makeObserverMap(map) {
      let _this = this;
      return new Proxy(map, {
        get(target, prop) {
          let v = Reflect.get(target, prop);
          if (typeof prop !== "string") return v;
          if (typeof v === "function") {
            if (prop === "set") {
              return (key, value) => {
                log3.info("call map.set()", map, key, value);
                if (!map.has(key)) {
                  _this._noticeSelfChanged(target);
                }
                let ret = Reflect.apply(v, target, [key, _this._makeObserver(value)]);
                _this._noticePropChanged(target, key.toString());
                return ret;
              };
            } else if (prop === "delete") {
              log3.info("call map.delete()", map, prop);
              return (key) => {
                let ret = Reflect.apply(v, target, [key]);
                _this._noticePropChanged(target, key.toString());
                _this._noticeSelfChanged(target);
                return ret;
              };
            } else if (prop === "clear") {
              log3.info("call map.clear()", map, prop);
              return () => {
                map.forEach((v2, k) => {
                  _this._noticePropChanged(target, k.toString());
                });
                let ret = Reflect.apply(v, target, []);
                _this._noticeSelfChanged(target);
                return ret;
              };
            } else if (prop === "get") {
              return (key) => {
                _this._traceObjectProp(target, key.toString());
                let ret = Reflect.apply(v, target, [key]);
                return ret;
              };
            } else {
              log3.info("call map function", map, prop);
              return (...args) => {
                let ret = Reflect.apply(v, target, args);
                _this._noticePropChanged(target, prop.toString());
                return ret;
              };
            }
          }
          _this._traceObjectProp(map, prop.toString());
          if (prop === "size") {
            _this._traceObjectSelf(map);
          }
          return v;
        },
        set(target, prop, value) {
          log3.info("set map prop", target, prop, value);
          if (!target.has(prop)) {
            _this._noticeSelfChanged(target);
          }
          _this._noticePropChanged(target, prop.toString());
          return Reflect.set(map, prop, _this._makeObserver(value));
        }
      });
    }
    _makeObserverSet(set) {
      let _this = this;
      return new Proxy(set, {
        get(target, prop) {
          let v = Reflect.get(target, prop);
          if (typeof prop !== "string") return v;
          if (typeof v === "function") {
            if (prop === "add") {
              return (value) => {
                log3.info("call set.add()", set, value);
                if (!set.has(value)) {
                  _this._noticeSelfChanged(target);
                }
                let ret = Reflect.apply(v, target, [_this._makeObserver(value)]);
                _this._noticePropChanged(target, value.toString());
                return ret;
              };
            } else if (prop === "delete") {
              log3.info("call set.delete()", set, prop);
              return (value) => {
                let ret = Reflect.apply(v, target, [value]);
                _this._noticePropChanged(target, value.toString());
                _this._noticeSelfChanged(target);
                return ret;
              };
            } else if (prop === "clear") {
              log3.info("call set.clear()", set, prop);
              return () => {
                set.forEach((v2) => {
                  _this._noticePropChanged(target, v2.toString());
                });
                let ret = Reflect.apply(v, target, []);
                _this._noticeSelfChanged(target);
                return ret;
              };
            } else if (prop === "has") {
              return (value) => {
                _this._traceObjectProp(target, value.toString());
                let ret = Reflect.apply(v, target, [value]);
                return ret;
              };
            } else {
              log3.info("call set function", set, prop);
              return (...args) => {
                let ret = Reflect.apply(v, target, args);
                _this._noticePropChanged(target, prop.toString());
                return ret;
              };
            }
          }
          _this._traceObjectProp(set, prop.toString());
          if (prop === "size") {
            _this._traceObjectSelf(set);
          }
          return v;
        }
      });
    }
    _isWebWorkerNativeObject(obj) {
      return Reflect.has(obj, SymWorkerNativeObject);
    }
    // 将一个对象初始化为可观测对象,此时对象的属性变化会被跟踪
    _makeObserver(obj) {
      if (typeof obj !== "object" || obj === null) return obj;
      if (this._isWebWorkerNativeObject(obj)) return obj;
      if (Reflect.getOwnPropertyDescriptor(obj, SymObjectObserver)) return obj;
      Reflect.defineProperty(obj, SymObjectObserver, {
        value: new ScopeDependents(this._scopeName),
        writable: false,
        enumerable: false
      });
      Reflect.defineProperty(obj, SymObjectInitPropDesc, {
        value: {},
        writable: false,
        enumerable: false
      });
      if (obj instanceof Array) {
        return this._makeObserverArray(obj);
      } else if (obj instanceof Map) {
        return this._makeObserverMap(obj);
      } else if (obj instanceof Set) {
        return this._makeObserverSet(obj);
      } else {
        return this._makeObserverObject(obj);
      }
    }
    // // 搜集作用域对象的所有属性,并生成执行函数
    // private _scopeMembersDeep(): string[] {
    //   let members = new Set<string>();
    //   let workScope: WorkerScope | undefined = this;
    //   while (workScope) {
    //     const keys = Reflect.ownKeys(workScope.scope).filter((k) => typeof k === 'string');
    //     keys.forEach((k) => members.add(k.toString()));
    //     workScope = workScope._parentScope;
    //   }
    //   return Array.from(members);
    // }
    // // 创建一个函数,用于执行表达式
    // // 表达式中的变量会被转换为局部变量
    // // 表达式中的变量数量发生变化时,会重新生成函数
    // scopedFunctionFactory(expr: string) {
    //   let _scopedVersion = (this as any)[SymScopeVerison];
    //   // 将作用域对象的属性转换为局部变量,包括父级作用域
    //   let scopedFunction: Function;
    //   let scopedMembers = [] as any[];
    //   return () => {
    //     if (!scopedFunction || _scopedVersion !== (this as any)[SymScopeVerison]) {
    //       // 创建新函数,并保存版本号
    //       scopedMembers = this._scopeMembersDeep();
    //       // 创建异步执行函数
    //       try {
    //         scopedFunction = new Function(...scopedMembers, `return ${expr};`) as any;
    //         log.debug('new scopedFunction', expr, scopedMembers);
    //       } catch (e) {
    //         scopedFunction = new Function(...scopedMembers, "return ''") as any;
    //         log.error('new scopedFunction error', expr, scopedMembers, e);
    //       }
    //       _scopedVersion = (this as any)[SymScopeVerison];
    //     }
    //     let values = scopedMembers.map((k) => this._scope[k]);
    //     return scopedFunction.apply(this._scope, values);
    //   };
    // }
    // 执行一个表达式函数,跟踪表达式执行过程中的依赖关系,当依赖的对象发生变化时,通知依赖的对象处理变更
    // 表达式支持异步对象
    // $watch<T>(func: () => T, listener: (old: T, compute: () => T) => T): T {
    //   const err = new Error();
    //   return {} as T;
    // }
    // private _mkProxy<T extends object>(obj: T): T {
    //     const _this = this
    //     // 不是对象则返回
    //     if (typeof obj !== 'object' || obj === null) return obj;
    //     if (Reflect.getOwnPropertyDescriptor(obj, SymObserver)) return obj
    //     // 定义观察对象
    //     Object.defineProperty(obj, SymObserver, {
    //         value: {
    //             $deps: new Set<string>(),// 依赖对象集合,当自身发生改变时,通知依赖对象变化
    //         }
    //     });
    //     return new Proxy(obj as any, {
    //         get(target, prop) {
    //         },
    //         set(target, prop, value) {
    //             // 如果value为对象,则递归生成代理对象
    //             target[prop] = _this._mkProxy(value);
    //             return true
    //         }
    //     })
    // }
  };
  var workerObserver = new class WorkerObserver {
    /**
     * 创建一个可观测对象,在对象的属性发生变化时,通知依赖的对象处理变更
     * @param target
     * @param prop
     */
    observe(target) {
    }
    // 生成代理对象
    makeProxy(obj) {
      const _this = this;
      if (Reflect.getOwnPropertyDescriptor(obj, SymObjectObserver)) return obj;
      Reflect.defineProperty(obj, SymObjectObserver, {
        value: {
          // 依赖的Set集合，即当自身发生变化时,可能会影响到的其他对象
          deps: /* @__PURE__ */ new Set()
        }
      });
      console.log("makeProxy", obj);
      return new Proxy(obj, {
        get(target, prop) {
          const value = target[prop];
          if (typeof value !== "object" || value === null || Reflect.getOwnPropertyDescriptor(value, SymObjectObserver)) {
            return value;
          }
          target[prop] = _this.makeProxy(value);
          return target[prop];
        },
        set(target, prop, value) {
          if (target[prop] === value) return true;
          if (typeof value !== "object" || value === null || Reflect.getOwnPropertyDescriptor(value, SymObjectObserver)) {
            target[prop] = value;
            return true;
          }
          target[prop] = _this.makeProxy(value);
          return true;
        }
      });
    }
  }();

  // src/worker/workerComponents.ts
  var log4 = Logger("WOO:WorkerComponent");
  var tplRegistry = new class TplRegistry {
    constructor() {
      this._tplRegistry = /* @__PURE__ */ new Map();
    }
    async get(tag) {
      if (!this._tplRegistry.has(tag)) {
        let relPrefix = workerMeta.tagPathPrefix(tag);
        let tplUrl = relPrefix + ".html";
        let html = await NetUtils.httpGetText(tplUrl);
        let result = await WorkerMessage.templateParse.send({ text: html });
        this._tplRegistry.set(tag, {
          rootElem: result.tpl,
          relUrl: relPrefix
        });
      }
      return this._tplRegistry.get(tag);
    }
  }();
  var workerComponentRegistry = /* @__PURE__ */ new Map();
  var WAttr = class {
    constructor(_elem, _tplName, _tplValue) {
      this._elem = _elem;
      this._tplName = _tplName;
      this._tplValue = _tplValue;
      this.name = "";
      this._dirty = true;
      this._value = "";
      try {
        if (_tplName.startsWith("$")) {
          this._computeFunc = new Function("$scope", "$el", `with($scope){return ${_tplValue}}`);
        } else if (_tplName.startsWith(":")) {
          this._computeFunc = new Function("$scope", "$el", `with($scope){return \`${_tplValue}\`;}`);
        } else if (_tplName.startsWith("@")) {
          this._computeFunc = new Function("$scope", "$el", "$ev", `with($scope){${_tplValue};}`);
        }
      } catch (e) {
        log4.warn("Error create compute function:", _tplName, _tplValue, e.message);
      }
      this.name = this._computeFunc ? this._tplName.slice(1) : _tplName;
      this._value = this._tplValue;
      this._dirty = this._computeFunc ? true : false;
    }
    // 计算属性值
    _computeValue() {
      if (this._computeFunc) {
        try {
          let rt = this._computeFunc(this._elem.scope);
          this._value = rt;
        } catch (e) {
          log4.error("Error compute attr:", this._elem.tag, this._tplName, this._tplValue, e.message);
          log4.error("Function:", this._computeFunc.toString());
        }
        this._dirty = false;
      } else {
        this._value = this._tplValue;
        this._dirty = false;
      }
    }
    get value() {
      if (this._dirty) {
        this._computeValue();
      }
      return this._value;
    }
    get isDynamic() {
      return !this._computeFunc;
    }
    setValue(v) {
      log4.warn("==>>>???? setValue: ", v);
      this._value = v;
    }
    invalidate() {
      this._dirty = true;
    }
  };
  var WTextNode = class {
    /**
     * @param _tplText 模板字符串
     * @param calcMode 计算模式,取值 "$"或':',代表值绑定或者模板绑定
     */
    constructor(_elem, _tplText, calcMode) {
      this._elem = _elem;
      this._tplText = _tplText;
      this._value = "";
      try {
        if (calcMode == "$") {
          this._computeFunc = new Function("$scope", "$el", `with($scope){return ${_tplText}}`);
        } else if (calcMode == ":") {
          this._computeFunc = new Function("$scope", "$el", `with($scope){return \`${_tplText}\`;}`);
        } else {
          this._value = _tplText;
        }
      } catch (e) {
        log4.warn("Error create compute function:", _tplText, e.message);
      }
    }
    get value() {
      if (this._computeFunc) {
        try {
          let rt = this._computeFunc(this._elem.scope);
          this._value = rt;
        } catch (e) {
          log4.error("Error compute text:", this._elem.tag, this._tplText, e.message);
          log4.error("Function:", this._computeFunc.toString());
        }
      }
      return this._value;
    }
  };
  var WElem = class _WElem {
    // 从ElemJson构造WElem
    constructor(_componentRoot, _parentElem, tplElem) {
      this._componentRoot = _componentRoot;
      this._parentElem = _parentElem;
      this._attrs = {};
      this._events = [];
      this._children = [];
      // 创建作用域对象,每个元素的scope中保存元素的动态属性,不包括静态属性
      this._loadPromises = [];
      this._contentCalcMode = "";
      this._tag = tplElem.tag;
      this._scope = Object.create(_parentElem?.scope || _componentRoot.workScope.rootScope);
      this._initAttrs(tplElem);
      this._initChildContent(tplElem);
      if (this._tag.includes("-")) {
        this._loadPromises.push(this._loadWebComponentElem());
      }
    }
    _initAttrs(tplElem) {
      JsUtils.objectForEach(tplElem.attrs, (v, k) => {
        if (k == "$" || k == ":") {
          this._contentCalcMode = k;
          return;
        }
        let att = new WAttr(this, k, v);
        if (att.name) {
          this._attrs[att.name] = att;
          if (att.isDynamic) {
            this._scope[att.name] = att.value;
          }
        }
      });
      if (this._parentElem) this._attrs["_eid"] = new WAttr(this, "_eid", this._componentRoot.newEid(this).toString());
    }
    _initChildContent(tplElem) {
      tplElem.children.forEach((child) => {
        if (typeof child === "string") {
          this._children.push(new WTextNode(this, child, this._contentCalcMode));
        } else {
          let elem = new _WElem(this._componentRoot, this, child);
          this._children.push(elem);
          if (elem.tag.includes("-")) this._loadPromises.push(elem.waitLoad());
        }
      });
    }
    async _loadWebComponentElem() {
      let result = await WorkerMessage.registerComponent.send({
        relUrl: this._componentRoot.relUrl,
        tag: this._tag,
        attrs: JsUtils.objectMap(this._attrs, (v, k) => {
          return v.value;
        })
      });
      if (result.elem) {
        this._tag = result.elem.tag;
        JsUtils.objectForEach(result.elem.attrs, (v, k) => {
          if (this._attrs[k]) {
            this._attrs[k].setValue(v);
          } else {
            this._attrs[k] = new WAttr(this, k, v);
          }
        });
      }
    }
    get tag() {
      return this._tag;
    }
    get scope() {
      return this._scope;
    }
    async waitLoad() {
      await Promise.all(this._loadPromises);
    }
    attrsValue() {
      return JsUtils.objectMap(this._attrs, (v, k) => {
        return v.value;
      });
    }
    // 生成当前元素的完整HTML
    renderOuterHtml(outStringBuilder, includeChilds = true) {
      outStringBuilder.push(
        `<${this._tag} `,
        ...JsUtils.objectMapToArray(this._attrs, (attr) => {
          return `${attr.name}="${attr.value}" `;
        }),
        ">"
      );
      if (includeChilds) this.renderInnerHtml(outStringBuilder);
      outStringBuilder.push(`</${this._tag}>`);
    }
    // 生成所有子元素的HTML
    renderInnerHtml(outStringBuilder) {
      this._children.forEach((child) => {
        if (child instanceof WTextNode) {
          outStringBuilder.push(child.value);
        } else {
          child.renderOuterHtml(outStringBuilder);
        }
      });
    }
    // get scope() {
    //     return this._workScope
    // }
    get indentify() {
      return `${this._componentRoot.indentify}|<${this._tag} eid=${this._attrs["_eid"]}>`;
    }
  };
  var WorkerComponent = class {
    constructor(rootTag, _attrs) {
      this.rootTag = rootTag;
      this._attrs = _attrs;
      this._eidMap = /* @__PURE__ */ new Map();
      this._cid = "";
      this._eidCounter = 0;
      this._relUrl = "";
      // 根作用域
      this._workScope = new WorkerScope(this.indentify, {});
      this._cid = _attrs["_cid"];
      if (!this._cid) throw new Error("WorkerComponent must have _cid attribute");
      workerComponentRegistry.set(this._cid, this);
    }
    get workScope() {
      return this._workScope;
    }
    newEid(elem) {
      let eid = `${this._cid}:${this._eidCounter++}`;
      this._eidMap.set(eid, elem);
      return eid;
    }
    get indentify() {
      return `<${this.rootTag} cid="${this._cid}">`;
    }
    // 加载组件
    async load() {
      let tpl = await tplRegistry.get(this.rootTag);
      this._relUrl = tpl.relUrl;
      if (tpl.rootElem.tag != "template") {
        log4.error("load component:", this.rootTag, '"root element must be <template>"');
        return;
      }
      this._interRootElem = new WElem(this, void 0, tpl.rootElem);
      return this._interRootElem.waitLoad();
    }
    get relUrl() {
      return this._relUrl;
    }
    // 获取根元素的属性
    rootAttrs() {
      let rootAttrs = this._interRootElem?.attrsValue() || {};
      JsUtils.objectForEach(this._attrs, (v, k) => {
        if (!rootAttrs[k]) {
          rootAttrs[k] = v;
        }
      });
      return rootAttrs;
    }
    renderContentHtml(outStringBuilder) {
      this._interRootElem?.renderInnerHtml(outStringBuilder);
    }
  };

  // src/worker/worker.ts
  var log5 = Logger("WOO:Worker");
  log5.debug("Worker init");
  MainMessage.setGlobalMeta.on(async (data) => {
    if (data.htmlUrl) workerMeta.setHomeUrl(data.htmlUrl);
    workerMeta.setMeta(data.meta);
    return {};
  });
  MainMessage.loadComponent.on(async (data) => {
    let tag = workerMeta.normalizeTag(data.tag, data.relUrl);
    log5.warn("==> start LoadElem:", data.tag, tag, data.attrs);
    let htmlBuilder = [];
    const comp = new WorkerComponent(tag, data.attrs);
    await comp.load();
    comp.renderContentHtml(htmlBuilder);
    let result = { tag, attrs: comp.rootAttrs(), content: htmlBuilder.join("") };
    log5.warn("==> end LoadElem:", result);
    return result;
  });
})();
