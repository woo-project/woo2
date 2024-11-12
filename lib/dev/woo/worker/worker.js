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
    get $rootScope() {
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
        let result = await message.send("W:ParseTpl", { text: html });
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
          let rt = this._computeFunc();
          this._value = rt;
        } catch (e) {
          log4.error("Error compute attr:", this._elem.tag, this._tplName, this._tplValue, e.message);
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
      this.text = "TEXT";
      if (calcMode == "$") {
      } else if (calcMode == ":") {
      } else {
        this.text = _tplText;
      }
    }
  };
  var WElem = class _WElem {
    // 从ElemJson构造WElem
    constructor(_componentRoot, _parent, tplElem) {
      this._componentRoot = _componentRoot;
      this._parent = _parent;
      this._attrs = {};
      this._events = [];
      this._children = [];
      // 创建作用域对象,每个元素的scope中保存元素的动态属性,不包括静态属性
      this._loadPromises = [];
      this._contentCalcMode = "";
      this._tag = tplElem.tag;
      this._scope = Object.create(_parent?._scope || _componentRoot.workScope);
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
          }
        }
      });
      if (this._parent)
        this._attrs["_eid"] = new WAttr(this, "_eid", this._componentRoot.newEid(this).toString());
    }
    _initChildContent(tplElem) {
      tplElem.children.forEach((child) => {
        if (typeof child === "string") {
          this._children.push(new WTextNode(this, child, this._contentCalcMode));
        } else {
          let elem = new _WElem(this._componentRoot, this, child);
          this._children.push(elem);
          if (elem.tag.includes("-"))
            this._loadPromises.push(elem.waitLoad());
        }
      });
    }
    async _loadWebComponentElem() {
      let result = await message.send("W:RegisterElem", { relUrl: this._componentRoot.relUrl, tag: this._tag, attrs: JsUtils.objectMap(this._attrs, (v, k) => {
        return v.value;
      }) });
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
          outStringBuilder.push(child.text);
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
    constructor(rootTag, _compAttrs) {
      this.rootTag = rootTag;
      this._compAttrs = _compAttrs;
      this._eidMap = /* @__PURE__ */ new Map();
      this._cid = "";
      this._eidCounter = 0;
      this._relUrl = "";
      // 根作用域
      this._workScope = new WorkerScope(this.indentify, {});
      this._cid = _compAttrs["_cid"];
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
      JsUtils.objectForEach(this._compAttrs, (v, k) => {
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
  message.on("M:SetMeta", async (data) => {
    if (data.htmlUrl) workerMeta.setHomeUrl(data.htmlUrl);
    workerMeta.setMeta(data.meta);
    return {};
  });
  message.on("M:LoadElem", async (data) => {
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
//# sourceMappingURL=data:application/json;base64,ewogICJ2ZXJzaW9uIjogMywKICAic291cmNlcyI6IFsiLi4vLi4vLi4vc3JjL2xvZ2dlci50cyIsICIuLi8uLi8uLi9zcmMvY29tbW9uLnRzIiwgIi4uLy4uLy4uL3NyYy9tYWluL21haW5Xb3JrZXJMb2FkZXIudHMiLCAiLi4vLi4vLi4vc3JjL21lc3NhZ2VIYW5kbGUudHMiLCAiLi4vLi4vLi4vc3JjL21lc3NhZ2UudHMiLCAiLi4vLi4vLi4vc3JjL3dvcmtlci93b3JrZXJNZXRhLnRzIiwgIi4uLy4uLy4uL3NyYy93b3JrZXIvd29ya2VyU2NvcGUudHMiLCAiLi4vLi4vLi4vc3JjL3dvcmtlci93b3JrZXJDb21wb25lbnRzLnRzIiwgIi4uLy4uLy4uL3NyYy93b3JrZXIvd29ya2VyLnRzIl0sCiAgInNvdXJjZXNDb250ZW50IjogWyIvKipcclxuICogTG9nZ2VyIFx1NTkwNFx1NzQwNlx1RkYwQ1x1NUYwMFx1NTNEMVx1NkEyMVx1NUYwRlx1RkYwQ1x1NzZGNFx1NjNBNVx1N0VEMVx1NUI5QWNvbnNvbGUubG9nXHVGRjBDXHU2NjNFXHU3OTNBXHU2RTkwXHU3ODAxXHJcbiAqIFx1OEZEMFx1ODg0Q1x1NkEyMVx1NUYwRlx1RkYxQVx1N0VEMVx1NUI5QVx1NTFGRFx1NjU3MFx1RkYwQ1x1NjYzRVx1NzkzQVx1NjVGNlx1OTVGNFx1NjIzM1x1RkYwQ1x1NjQxQ1x1OTZDNlx1NjVFNVx1NUZEN1x1RkYwQ1x1NTNEMVx1OTAwMVx1NTIzMFx1NjVFNVx1NUZEN1x1NjcwRFx1NTJBMVx1NTY2OFxyXG4gKiBcdTkwMUFcdThGQzcgd2luZG93LmVycm9yIFx1NTkwNFx1NzQwNlx1NTE2OFx1NUM0MFx1NUYwMlx1NUUzOCwgXHU4MUVBXHU1MkE4XHU4QkExXHU3Qjk3XHU2NUY2XHU5NUY0XHJcbiAqIEBwYXJhbSBleHBvcnRzT2JqXHJcbiAqIEByZXR1cm5zXHJcbiAqL1xyXG5cclxuXHJcbi8vIGNvbnN0IG1ldGFEZWJ1ZyA9IHNlbGYuZG9jdW1lbnQ/LmhlYWQ/LnF1ZXJ5U2VsZWN0b3IoJ21ldGFbbmFtZT1kZWJ1Z10nKTtcclxuXHJcbmxldCBsb2dnZXJsYXN0VG0gPSAtMTtcclxuXHJcbmNvbnN0IGVuYWJsZURlYnVnID0gISEoZ2xvYmFsVGhpcz8ubG9jYWxTdG9yYWdlPy5nZXRJdGVtKCdfX0RFVicpKTtcclxuXHJcbi8qKlxyXG4gKlxyXG4gKiBAcGFyYW0gbW9kIFx1NEY3Rlx1NzUyOCB0aGlzIFx1NjMwN1x1OTQ4OFx1NjIxNlx1ODAwNVx1NUI1N1x1N0IyNlx1NEUzMlxyXG4gKiBAcGFyYW0gcGtnIFx1NTMwNVx1NTQwRFxyXG4gKiBAcmV0dXJucyBsb2dcclxuICovXHJcbmV4cG9ydCBmdW5jdGlvbiBMb2dnZXIodGFnOiBzdHJpbmcpIHtcclxuICBjb25zdCBoID0gTWF0aC5yb3VuZChNYXRoLnJhbmRvbSgpICogMzYwKTtcclxuICBjb25zdCB0aW1lU3R5bGUgPSBgY29sb3I6aHNsKCR7aH0sMTAwJSw0MCUpO2ZvbnQtc3R5bGU6IGl0YWxpYztgO1xyXG4gIGNvbnN0IGZpbGVTdHlsZSA9IGBjb2xvcjpoc2woJHtofSwxMDAlLDQwJSk7Zm9udC13ZWlnaHQ6IDkwMDtmb250LXNpemU6MTJweDtgO1xyXG5cclxuICBsZXQgdGhpc2xhc3RUbSA9IC0xO1xyXG4gIC8vIFx1OUVEOFx1OEJBNFx1NjYzRVx1NzkzQXdhcm5cdTRFRTVcdTRFMEFcdTdFQTdcdTUyMkJcclxuICAvLyBjb25zdCBERUJVRyA9IChsb2NhbFN0b3JhZ2UuZ2V0SXRlbSgnREVCVUcnKSB8fCBtZXRhRGVidWcgfHwgJycpLnNwbGl0KCc7Jyk7XHJcbiAgY29uc3QgbG9nTGlzdCA9IFsnZGVidWcnLCAnbG9nJywgJ2luZm8nLCAnd2FybicsICdlcnJvciddO1xyXG4gIGZ1bmN0aW9uIG5vbmUoKSB7fVxyXG5cclxuICBjb25zdCBjb24gPSBmdW5jdGlvbiAoLi4uYXJnczogYW55W10pIHtcclxuICAgIChjb24gYXMgYW55KS5sb2cuY2FsbChjb24sIC4uLmFyZ3MpO1xyXG4gIH07XHJcbiAgUmVmbGVjdC5zZXRQcm90b3R5cGVPZihcclxuICAgIGNvbixcclxuICAgIG5ldyBQcm94eShjb25zb2xlLCB7XHJcbiAgICAgIGdldCh0OiBhbnksIHA6IHN0cmluZykge1xyXG4gICAgICAgIC8vIFx1OEJBMVx1N0I5N1x1NjVGNlx1OTVGNFxyXG4gICAgICAgIGxldCBsZXZlbCA9IGxvZ0xpc3QuaW5kZXhPZihwKTtcclxuICAgICAgICBpZiAobGV2ZWwgPCAwKSByZXR1cm4gdFtwXTsgLy8gXHU0RTBEXHU1NzI4TE9HXHU1QjlBXHU0RTQ5XHU3Njg0XHU2NUI5XHU2Q0Q1XHVGRjBDXHU4RkQ0XHU1NkRFXHU1MzlGXHU1OUNCXHU1MUZEXHU2NTcwXHJcblxyXG4gICAgICAgIC8vIGRlYnVnZ2VyO1xyXG4gICAgICAgIGlmIChsZXZlbCA8PSAyICYmICFlbmFibGVEZWJ1Zykge1xyXG4gICAgICAgICAgIHJldHVybiBub25lOyAvLyBcdTRGNEVcdTRFOEVsZXZlbCBcdTRFMERcdTY2M0VcdTc5M0FcclxuICAgICAgICB9XHJcblxyXG4gICAgICAgIGxldCB0bSA9IG5ldyBEYXRlKCkuZ2V0VGltZSgpO1xyXG4gICAgICAgIGxldCBzcGFuQWxsID0gbG9nZ2VybGFzdFRtID4gMCA/IHRtIC0gbG9nZ2VybGFzdFRtIDogMDtcclxuICAgICAgICBsZXQgc3BhblRoaXMgPSB0aGlzbGFzdFRtID4gMCA/IHRtIC0gdGhpc2xhc3RUbSA6IDA7XHJcbiAgICAgICAgbG9nZ2VybGFzdFRtID0gdG07XHJcbiAgICAgICAgdGhpc2xhc3RUbSA9IHRtO1xyXG4gICAgICAgIHJldHVybiAoY29uc29sZSBhcyBhbnkpW3BdLmJpbmQoXHJcbiAgICAgICAgICBjb25zb2xlLFxyXG4gICAgICAgICAgYCVjJHtwLnN1YnN0cmluZygwLCAxKS50b1VwcGVyQ2FzZSgpfXwke3NwYW5BbGx9fCR7c3BhblRoaXN9ICVjJHt0YWd9YCxcclxuICAgICAgICAgIHRpbWVTdHlsZSxcclxuICAgICAgICAgIGZpbGVTdHlsZVxyXG4gICAgICAgICk7XHJcbiAgICAgIH0sXHJcbiAgICB9KVxyXG4gICk7XHJcbiAgcmV0dXJuIGNvbiBhcyBhbnkgYXMgQ29uc29sZTtcclxufVxyXG5cclxuLy8gXHU1QjlBXHU0RTQ5XHU1MTY4XHU1QzQwbG9nXHU1QkY5XHU4QzYxXHJcbihnbG9iYWxUaGlzIGFzIGFueSkuTG9nZ2VyID0gTG9nZ2VyO1xyXG4iLCAiaW1wb3J0IHsgTG9nZ2VyIH0gZnJvbSBcIi4vbG9nZ2VyXCI7XHJcblxyXG5jb25zdCBsb2cgPSBMb2dnZXIoXCJXT086VXRpbHNcIilcclxuXHJcblxyXG5leHBvcnQgY29uc3QgUHJvbWlzZUV4dCA9IHtcclxuICAvKipcclxuICAgKiBcdThEODVcdTY1RjZQcm9taXNlXHJcbiAgICogQHBhcmFtIHByb21pc2VcclxuICAgKiBAcGFyYW0gdGltZW91dE1zXHJcbiAgICogQHJldHVybnNcclxuICAgKi9cclxuICB0aW1lb3V0KHByb21pc2U6IFByb21pc2U8YW55PiwgdGltZW91dE1zOiBudW1iZXIpIHtcclxuICAgIHJldHVybiBQcm9taXNlLnJhY2UoW1xyXG4gICAgICBwcm9taXNlLFxyXG4gICAgICBuZXcgUHJvbWlzZSgocmVzLCByZWopID0+IHtcclxuICAgICAgICBzZXRUaW1lb3V0KCgpID0+IHtcclxuICAgICAgICAgIHJlaihcInRpbWVvdXRcIik7XHJcbiAgICAgICAgfSwgdGltZW91dE1zKTtcclxuICAgICAgfSksXHJcbiAgICBdKTtcclxuICB9LFxyXG5cclxuICB3YWl0KHRpbWVvdXRNczogbnVtYmVyKSB7XHJcbiAgICByZXR1cm4gbmV3IFByb21pc2UocmVzID0+IHtcclxuICAgICAgc2V0VGltZW91dChyZXMsIHRpbWVvdXRNcyk7XHJcbiAgICB9KTtcclxuICB9XHJcbn07XHJcblxyXG5cclxuLyoqXHJcbiAqIERlZmVyIFx1NUYwMlx1NkI2NSBQcm9taXNlIFxyXG4gKi9cclxuZXhwb3J0IGNsYXNzIERlZmVyPFQgPSBhbnk+IHtcclxuICBwcml2YXRlIF9yZXM6ICh2YWx1ZTogVCkgPT4gdm9pZCA9ICgpID0+IHsgfTtcclxuICBwcml2YXRlIF9yZWo6IChyZWFzb246IGFueSkgPT4gdm9pZCA9ICgpID0+IHsgfTtcclxuICBwcml2YXRlIF9wcm9taXNlXHJcblxyXG4gIGNvbnN0cnVjdG9yKHB1YmxpYyBuYW1lPzogc3RyaW5nLCBwcml2YXRlIF90aW1lb3V0TXMgPSAtMSkge1xyXG4gICAgbGV0IHAgPSBuZXcgUHJvbWlzZTxUPigocmVzLCByZWopID0+IHtcclxuICAgICAgdGhpcy5fcmVzID0gcmVzO1xyXG4gICAgICB0aGlzLl9yZWogPSByZWo7XHJcbiAgICB9KVxyXG4gICAgdGhpcy5fcHJvbWlzZSA9IF90aW1lb3V0TXMgPiAwID8gUHJvbWlzZUV4dC50aW1lb3V0KHAsIF90aW1lb3V0TXMpIDogcFxyXG5cclxuICB9XHJcbiAgYXN5bmMgcmVzdWx0KHRpbWVvdXQ6IG51bWJlciA9IC0xKSB7XHJcbiAgICBpZiAodGltZW91dCA+IDApIHtcclxuICAgICAgcmV0dXJuIFByb21pc2VFeHQudGltZW91dCh0aGlzLl9wcm9taXNlLCB0aW1lb3V0KVxyXG4gICAgfVxyXG4gICAgcmV0dXJuIHRoaXMuX3Byb21pc2U7XHJcbiAgfVxyXG4gIHJlc2xvdmUocmVzdWx0OiBhbnkpIHtcclxuICAgIC8vIGxvZy5pbmZvKCdEZWZlci5yZXNsb3ZlJywgdGhpcy5fbmFtZSwgcmVzdWx0KVxyXG4gICAgdGhpcy5fcmVzKHJlc3VsdCk7XHJcbiAgfVxyXG4gIHJlamVjdChyZWFzb246IGFueSkge1xyXG4gICAgLy8gbG9nLmVycm9yKCdEZWZlci5yZWplY3QnLCB0aGlzLl9uYW1lLCByZWFzb24pXHJcbiAgICB0aGlzLl9yZWoocmVhc29uKTtcclxuICB9XHJcbn1cclxuXHJcbmV4cG9ydCBjb25zdCBOZXRVdGlscyA9IHtcclxuICBhc3luYyBodHRwR2V0VGV4dCh1cmw6IHN0cmluZykge1xyXG4gICAgcmV0dXJuIGZldGNoKHVybCkudGhlbihyZXMgPT4ge1xyXG4gICAgICBpZiAocmVzLm9rKSB7XHJcbiAgICAgICAgcmV0dXJuIHJlcy50ZXh0KClcclxuICAgICAgfSBlbHNlIHtcclxuICAgICAgICB0aHJvdyBuZXcgRXJyb3IoYCR7cmVzLnN0YXR1c30gJHtyZXMuc3RhdHVzVGV4dH06ICR7dXJsfWApXHJcbiAgICAgIH1cclxuICAgIH0pXHJcbiAgfSxcclxuICBhc3luYyBodHRwR2V0SnNvbih1cmw6IHN0cmluZykge1xyXG4gICAgcmV0dXJuIEpTT04ucGFyc2UoYXdhaXQgdGhpcy5odHRwR2V0VGV4dCh1cmwpKVxyXG4gIH1cclxufVxyXG5cclxuXHJcblxyXG5leHBvcnQgY29uc3QgaXNXb3JrZXIgPSAhc2VsZi53aW5kb3dcclxuXHJcbmV4cG9ydCBpbnRlcmZhY2UgSUVsZW1Kc29uIHtcclxuICB0YWc6IHN0cmluZ1xyXG4gIGF0dHJzOiB7IFtrOiBzdHJpbmddOiBzdHJpbmcgfVxyXG4gIGNoaWxkcmVuOiAoSUVsZW1Kc29uIHwgc3RyaW5nKVtdXHJcbn1cclxuXHJcbmV4cG9ydCBjb25zdCBKc1V0aWxzID0ge1xyXG5cclxuICAvKipcclxuICAgKiBcdTVCRjlcdThDNjFcdTY2MjBcdTVDMDQsXHU4RkM3XHU2RUU0dW5kZWZpbmVkXHJcbiAgICogQHBhcmFtIG9iaiBcclxuICAgKiBAcGFyYW0gZm4gXHJcbiAgICogQHJldHVybnMgXHJcbiAgICovXHJcbiAgb2JqZWN0TWFwPFQgZXh0ZW5kcyB7IFtrOiBzdHJpbmddOiBhbnkgfSwgUj4gKG9iajogVCwgZm46ICh2OiBUW3N0cmluZ10sIGs6IHN0cmluZykgPT4gUik6IHsgW2sgaW4ga2V5b2YgVF06Tm9uTnVsbGFibGU8Uj4gfSB7XHJcbiAgICBsZXQgbmV3T2JqID0ge30gYXMgYW55XHJcbiAgICBmb3IgKGxldCBrIG9mIE9iamVjdC5rZXlzKG9iaikpIHtcclxuICAgICAgbGV0IHYgPSBmbihvYmpba10sIGspXHJcbiAgICAgIGlmICh2ICE9PSB1bmRlZmluZWQpIG5ld09ialtrXSA9IHZcclxuICAgIH1cclxuICAgIHJldHVybiBuZXdPYmpcclxuICB9LFxyXG5cclxuICBvYmplY3RNYXBUb0FycmF5PFQgZXh0ZW5kcyB7IFtrOiBzdHJpbmddOiBhbnkgfSwgUj4ob2JqOiBULCBmbjogKHY6IFRbc3RyaW5nXSwgazogc3RyaW5nKSA9PiBSKTogTm9uTnVsbGFibGU8Uj5bXSB7XHJcbiAgICBsZXQgYXJyID0gW10gYXMgYW55W11cclxuICAgIGZvciAobGV0IGsgb2YgT2JqZWN0LmtleXMob2JqKSkge1xyXG4gICAgICBsZXQgdiA9IGZuKG9ialtrXSwgaylcclxuICAgICAgaWYgKHYgIT09IHVuZGVmaW5lZCkgYXJyLnB1c2godilcclxuICAgIH1cclxuICAgIHJldHVybiBhcnIgXHJcbiAgfSxcclxuICBvYmplY3RGb3JFYWNoPFQgZXh0ZW5kcyB7IFtrOiBzdHJpbmddOiBhbnkgfT4ob2JqOiBULCBmbjogKHY6IFRbc3RyaW5nXSwgazogc3RyaW5nKSA9PiB2b2lkKSB7XHJcbiAgICBmb3IgKGxldCBrIG9mIE9iamVjdC5rZXlzKG9iaikpIHtcclxuICAgICAgZm4ob2JqW2tdLCBrKVxyXG4gICAgfVxyXG4gIH0sXHJcbiAgaXNDbGFzcyhvYmo6IGFueSk6Ym9vbGVhbiB7XHJcbiAgICBpZighKHR5cGVvZiBvYmogPT09ICdmdW5jdGlvbicpKSByZXR1cm4gZmFsc2VcclxuICAgIHRyeXtcclxuICAgICAgbGV0IHRtcCA9IGNsYXNzIGV4dGVuZHMgb2Jqe31cclxuICAgICAgcmV0dXJuIHRydWVcclxuICAgIH1jYXRjaChlKXtcclxuICAgICAgcmV0dXJuIGZhbHNlXHJcbiAgICB9XHJcbiAgfSxcclxuXHJcblxyXG5cclxuXHJcbn1cclxuXHJcbiIsICJpbXBvcnQgeyBpc1dvcmtlciB9IGZyb20gXCIuLi9jb21tb25cIjtcclxuXHJcbmV4cG9ydCBsZXQgd29ya2VyID0gdW5kZWZpbmVkIGFzIFdvcmtlciB8IHVuZGVmaW5lZDtcclxuXHJcbmlmKCFpc1dvcmtlcil7XHJcbiAgICBjb25zdCBzcmNTY3JpcHQgPSAoZG9jdW1lbnQuY3VycmVudFNjcmlwdCBhcyBIVE1MU2NyaXB0RWxlbWVudCkuc3JjO1xyXG4gICAgbGV0IHdvcmtlclVybCA9IHNyY1NjcmlwdC5yZXBsYWNlKC9pbmRleFxcLmpzJC8sICd3b3JrZXIvd29ya2VyLmpzJylcclxuICAgIGNvbnNvbGUubG9nKCdNYWluV29ya2VyTG9hZGVyIDQ0Oicsc3JjU2NyaXB0LHdvcmtlclVybClcclxuICAgIHdvcmtlciA9ICBuZXcgV29ya2VyKHdvcmtlclVybCx7bmFtZTpcIldvb1dvcmtlclwifSlcclxufVxyXG4iLCAiLyoqXHJcbiAqIEBmaWxlIG1lc3NhZ2VIYW5kbGUudHNcclxuICogV29ya2VyXHU1NDhDTWFpblx1OTBGRFx1OEZEQlx1ODg0Q1x1NUYxNVx1NzUyOFx1NzY4NFx1NTE2Q1x1NTE3MVx1NTMwNVx1RkYwQ1x1NUJGQ1x1NTFGQVx1OTAxQVx1OEJBRlx1NkQ4OFx1NjA2Rlx1NTNFNVx1NjdDNFxyXG4gKiBcdTU0MENcdTY1RjZcdTU5ODJcdTY3OUNcdTY2MkZcdTRFM0JcdTdFQkZcdTdBMEJcdTUyMTlcdTUyMUJcdTVFRkFXb3JrZXJcdTdFQkZcdTdBMEJcclxuICovXHJcblxyXG5pbXBvcnQgeyB3b3JrZXIgfSBmcm9tIFwiLi9tYWluL21haW5Xb3JrZXJMb2FkZXJcIjtcclxuXHJcblxyXG4vLyBcdTUxNjhcdTVDNDBcdTZEODhcdTYwNkZcdTUzRTVcdTY3QzQsXHU4MUVBXHU1MkE4XHU2ODM5XHU2MzZFXHU1RjUzXHU1MjREXHU3M0FGXHU1ODgzXHU5MDA5XHU2MkU5V29ya2VyXHU3RUJGXHU3QTBCXHU2MjE2XHU4MDA1XHU0RTNCXHU3RUJGXHU3QTBCXHJcbmV4cG9ydCBsZXQgZ2xvYmFsTWVzc2FnZUhhbmRsZSA9ICh3b3JrZXIgfHwgc2VsZikgYXMgYW55ICBhcyB7XHJcbiAgICBwb3N0TWVzc2FnZTogKG1lc3NhZ2U6IGFueSwgdHJhbnNmZXI/OiBUcmFuc2ZlcmFibGVbXSB8IHVuZGVmaW5lZCkgPT4gdm9pZDtcclxuICAgIGFkZEV2ZW50TGlzdGVuZXI6ICh0eXBlOiBzdHJpbmcsIGxpc3RlbmVyOiAodGhpczogV29ya2VyLCBldjogTWVzc2FnZUV2ZW50KSA9PiBhbnksIG9wdGlvbnM/OiBib29sZWFuIHwgQWRkRXZlbnRMaXN0ZW5lck9wdGlvbnMgfCB1bmRlZmluZWQpID0+IHZvaWQ7XHJcbn07XHJcblxyXG4iLCAiaW1wb3J0IHsgTG9nZ2VyIH0gZnJvbSAnLi9sb2dnZXInO1xyXG5pbXBvcnQgeyBEZWZlciwgSUVsZW1Kc29uLCBpc1dvcmtlciB9IGZyb20gJy4vY29tbW9uJztcclxuaW1wb3J0IHsgZ2xvYmFsTWVzc2FnZUhhbmRsZSB9IGZyb20gJy4vbWVzc2FnZUhhbmRsZSc7XHJcblxyXG5jb25zdCBsb2cgPSBMb2dnZXIoYFdPTzpNZXNzYWdlOiR7aXNXb3JrZXIgPyAnV29ya2VyJyA6ICdNYWluJ31gKTtcclxuXHJcbi8vIFx1NTE0M1x1N0QyMFx1NUI5QVx1NEY0RDpcclxuLy8gXHU5MDFBXHU4RkM3Y2lkK2VpZFx1NTNFRlx1NTUyRlx1NEUwMFx1NUI5QVx1NEY0RFx1NEUwMFx1NEUyQVx1NTE0M1x1N0QyMFxyXG4vLyBcdTUxNzZcdTRFMkRjaWRcdTRFM0FcdTdFQzRcdTRFRjZJRFx1RkYwQ1x1NTUyRlx1NEUwMFx1NjgwN1x1OEJDNlx1NEUwMFx1NEUyQVx1N0VDNFx1NEVGNlx1NUI5RVx1NEY4QlxyXG4vLyBlaWRcdTRFM0FcdTUxNDNcdTdEMjBJRFx1RkYwQ1x1NTUyRlx1NEUwMFx1NjgwN1x1OEJDNlx1NEUwMFx1NEUyQVx1N0VDNFx1NEVGNlx1NTE4NVx1OTBFOFx1NzY4NFx1NEUwMFx1NEUyQVx1NTE0M1x1N0QyMFxyXG4vLyBjaWRcdTc2ODRcdTUyMDZcdTkxNERcdTc1MzFcclxuXHJcbi8vIFx1OTAxQVx1NzUyOFx1NkQ4OFx1NjA2Rlx1NjU3MFx1NjM2RVx1N0VEM1x1Njc4NFxyXG5pbnRlcmZhY2UgSU1lc3NhZ2VTdHJ1Y3Qge1xyXG4gIC8vIFx1OEJGN1x1NkM0Mlx1NkQ4OFx1NjA2Rlx1N0M3Qlx1NTc4QixcdTY4M0NcdTVGMEZcdTRFM0EgXCJXOnh4eFwiIFx1NjIxNlx1ODAwNSBcIk06eHh4XCJcclxuICB0eXBlOiBzdHJpbmc7XHJcbiAgLy8gXHU2RDg4XHU2MDZGSUQsXHU2RDg4XHU2MDZGXHU4QkY3XHU2QzQyXHU2NUY2LFx1NzUyOFx1NEU4RVx1NTUyRlx1NEUwMFx1NjgwN1x1OEJDNlx1NEUwMFx1NEUyQVx1NkQ4OFx1NjA2RixcclxuICBpZD86IG51bWJlcjtcclxuICAvLyBcdTUyMjRcdTY1QURcdTY2MkZcdTU0MjZcdTRFM0FcdTVFOTRcdTdCNTRcdTZEODhcdTYwNkYsXHU1OTgyXHU2NzlDXHU0RTNBXHU1RTk0XHU3QjU0XHU2RDg4XHU2MDZGLFx1NTIxOVx1NkI2NFx1NUI1N1x1NkJCNVx1NEUzQVx1OEJGN1x1NkM0Mlx1NkQ4OFx1NjA2Rlx1NzY4NElEXHJcbiAgcmVwbHk/OiBudW1iZXI7XHJcbiAgLy8gXHU2RDg4XHU2MDZGXHU2NTcwXHU2MzZFXHJcbiAgZGF0YT86IGFueTtcclxuICAvLyBcdTU5ODJcdTY3OUNcdTYyNjdcdTg4NENcdTk1MTlcdThCRUYsXHU1MjE5XHU1OTA0XHU3NDA2XHU5NTE5XHU4QkVGXHU0RkUxXHU2MDZGXHJcbiAgZXJyPzogYW55O1xyXG59XHJcblxyXG5jb25zdCBUSU1FT1VUID0gNTAwMDAwO1xyXG50eXBlIElNZXNzYWdlVHlwZSA9IGtleW9mIElNZXNzYWdlcztcclxuXHJcbi8qKlxyXG4gKiBcdTZEODhcdTYwNkZcdTdDN0JcdTU3OEJcdTVCOUFcdTRFNDksXCJXOlwiXHU0RTNBV29ya2VyXHU3RUJGXHU3QTBCXHU2RDg4XHU2MDZGLFwiTTpcIlx1NEUzQVx1NEUzQlx1N0VCRlx1N0EwQlx1NkQ4OFx1NjA2RlxyXG4gKi9cclxuaW50ZXJmYWNlIElNZXNzYWdlcyB7XHJcbiAgLy89PT09PT09PT0gXHU1REU1XHU0RjVDXHU3RUJGXHU3QTBCXHU1M0QxXHU4RDc3XHU0RThCXHU0RUY2XHVGRjBDXHU0RTNCXHU3RUJGXHU3QTBCXHU1NENEXHU1RTk0ID09PT09PT09PVxyXG5cclxuICAvLyBcdTVGNTNXb3JrZXJcdTdFQkZcdTdBMEJcdTUxQzZcdTU5MDdcdTU5N0RcdTY1RjYsXHU1M0QxXHU5MDAxXHU2QjY0XHU2RDg4XHU2MDZGLFx1OTAxQVx1NzdFNVx1NEUzQlx1N0VCRlx1N0EwQldvcmtlclx1NTQyRlx1NTJBOFx1NUI4Q1x1NjIxMFxyXG4gICdXOlJlYWR5Jzoge1xyXG4gICAgc2VuZDoge307XHJcbiAgICByZXBseToge307XHJcbiAgfTtcclxuICAvLyBcdTc1MzFcdTRFOEVEb21QYXJzZVx1NEVDNVx1ODBGRFx1NTcyOFx1NEUzQlx1N0VCRlx1N0EwQlx1OEMwM1x1NzUyOFx1RkYwQ1x1NTZFMFx1NkI2NFx1RkYwQ1x1NUY1M1dvcmtlclx1N0VCRlx1N0EwQlx1OTcwMFx1ODk4MVx1ODlFM1x1Njc5MERvbVx1NjVGNlx1RkYwQ1x1NTNEMVx1OTAwMVx1NkI2NFx1NkQ4OFx1NjA2Rlx1NTIzMFx1NEUzQlx1N0VCRlx1N0EwQlx1RkYwQ1x1NzUzMVx1NEUzQlx1N0VCRlx1N0EwQlx1ODlFM1x1Njc5MFx1NUI4Q1x1NkJENVx1NTQwRVx1OEZENFx1NTZERVx1ODlFM1x1Njc5MFx1N0VEM1x1Njc5Q1xyXG4gICdXOlBhcnNlVHBsJzoge1xyXG4gICAgc2VuZDogeyB0ZXh0OiBzdHJpbmcgfTtcclxuICAgIHJlcGx5OiB7IHRwbDogSUVsZW1Kc29uIH07XHJcbiAgfTtcclxuXHJcbiAgLy8gXHU1RjUzV29ya2VyXHU3RUJGXHU3QTBCXHU5NzAwXHU4OTgxXHU5ODg0XHU1MkEwXHU4RjdEXHU1MTQzXHU3RDIwXHU2NUY2XHVGRjBDXHU1M0QxXHU5MDAxXHU2QjY0XHU2RDg4XHU2MDZGXHU1MjMwXHU0RTNCXHU3RUJGXHU3QTBCXHJcbiAgJ1c6UmVnaXN0ZXJFbGVtJzoge1xyXG4gICAgc2VuZDogeyByZWxVcmw6IHN0cmluZzsgdGFnOiBzdHJpbmc7IGF0dHJzOiB7IFtrZXk6IHN0cmluZ106IHN0cmluZyB9IH07XHJcbiAgICByZXBseTogeyBlbGVtPzogeyB0YWc6IHN0cmluZzsgYXR0cnM6IHsgW2tleTogc3RyaW5nXTogc3RyaW5nIH0gfSB9O1xyXG4gIH07XHJcblxyXG4gICdXOlVwZGF0ZUVsZW0nOiB7XHJcbiAgICBzZW5kOiB7IGNpZDogc3RyaW5nOyBlaWQ6IHN0cmluZzsgYXR0cnM6IHsgW2tleTogc3RyaW5nXTogc3RyaW5nIH0gfTtcclxuICAgIHJlcGx5OiB7fTtcclxuICB9O1xyXG5cclxuICAvLyA9PT09PT09IFx1NEUzQlx1N0VCRlx1N0EwQlx1NTNEMVx1OEQ3N1x1NEU4Qlx1NEVGNlx1RkYwQ1x1NURFNVx1NEY1Q1x1N0VCRlx1N0EwQlx1NTRDRFx1NUU5NCA9PT09PT09PT1cclxuICAvLyBcdTY2RjRcdTY1QjBcdTUxNjhcdTVDNDBtZXRhXHU1QzVFXHU2MDI3XHJcbiAgJ006U2V0TWV0YSc6IHtcclxuICAgIHNlbmQ6IHtcclxuICAgICAgbWV0YTogSUVsZW1Kc29uW107IC8vIFx1OTcwMFx1ODk4MVx1NjZGNFx1NjVCMFx1NzY4NG1ldGFcdTVDNUVcdTYwMjdcdTUyMTdcdTg4NjhcclxuICAgICAgaHRtbFVybD86IHN0cmluZzsgLy8gXHU1RjUzXHU1MjREXHU5ODc1XHU5NzYyXHU3Njg0VXJsXHJcbiAgICB9O1xyXG4gICAgcmVwbHk6IHt9O1xyXG4gIH07XHJcbiAgLy8gXHU4QkY3XHU2QzQyXHU1MkEwXHU4RjdEXHU1MTQzXHU3RDIwLFx1NEYyMFx1NTE2NVx1OEJGN1x1NkM0Mlx1NTJBMFx1OEY3RFx1NzY4NFx1NTE0M1x1N0QyMFx1NjgwN1x1N0I3RVx1NTQ4Q1x1NUM1RVx1NjAyNyxcdTRFMDBcdTgyMkNcdTc1MjhcdTRFOEVcdTU3MjhcdTk5OTZcdTk4NzVcdTUyQTBcdThGN0RcdTU2RkFcdTVCOUFcdTUxNDNcdTdEMjBcdTYyMTZcdTgwMDVcdTcyRUNcdTdBQ0JcdTUxNDNcdTdEMjAoXHU2NUUwXHU3MjM2XHU1MTQzXHU3RDIwKVxyXG4gICdNOkxvYWRFbGVtJzoge1xyXG4gICAgc2VuZDogeyB0YWc6IHN0cmluZzsgYXR0cnM6IHsgW2s6IHN0cmluZ106IHN0cmluZyB9OyByZWxVcmw6IHN0cmluZyB9O1xyXG4gICAgcmVwbHk6IHsgdGFnOiBzdHJpbmc7IGF0dHJzOiB7IFtrZXk6IHN0cmluZ106IHN0cmluZyB9OyBjb250ZW50OiBzdHJpbmcgfTtcclxuICB9O1xyXG59XHJcblxyXG4vKipcclxuICogXHU1QjlFXHU3M0IwV29ya2VyXHU1NDhDXHU0RTNCXHU3RUJGXHU3QTBCXHU3Njg0XHU2RDg4XHU2MDZGXHU5MDFBXHU0RkUxLFx1NTkwNFx1NzQwNlx1NUU5NFx1N0I1NFxyXG4gKlxyXG4gKi9cclxuZXhwb3J0IGNsYXNzIE1lc3NhZ2Uge1xyXG4gIHByaXZhdGUgX21zZ0lkID0gaXNXb3JrZXIgPyAxMDAwMCA6IDE7XHJcbiAgcHJpdmF0ZSBfd2FpdFJlcGx5ID0gbmV3IE1hcDxudW1iZXIsIHsgcmVzOiAoZGF0YTogYW55KSA9PiB2b2lkOyByZWo6IChlcnI6IHN0cmluZykgPT4gdm9pZCB9PigpO1xyXG4gIHByaXZhdGUgX2xpc3RlbmVycyA9IG5ldyBNYXA8SU1lc3NhZ2VUeXBlLCAoZGF0YTogYW55KSA9PiBQcm9taXNlPGFueT4+KCk7XHJcbiAgcHJpdmF0ZSBfd29ya2VyUmVhZHlEZWZlciA9IG5ldyBEZWZlcjxJTWVzc2FnZVN0cnVjdD4oJ1dvcmtlclJlYWR5Jyk7XHJcblxyXG4gIGNvbnN0cnVjdG9yKCkge1xyXG4gICAgLy8gbG9nLmluZm8oJ01lc3NhZ2UuY29uc3RydWN0b3InKTtcclxuICAgIGdsb2JhbE1lc3NhZ2VIYW5kbGUuYWRkRXZlbnRMaXN0ZW5lcignbWVzc2FnZScsIHRoaXMub25NZXNzYWdlLmJpbmQodGhpcykpO1xyXG5cclxuICAgIGlmIChpc1dvcmtlcikge1xyXG4gICAgICAvLyBXb3JrZXJcdTdFQkZcdTdBMEJcdUZGMENcdTUzRDFcdTkwMDFXb3JrZXJSZWFkeVx1NkQ4OFx1NjA2RlxyXG4gICAgICB0aGlzLnNlbmQoJ1c6UmVhZHknLCB7fSkudGhlbigoZGF0YSkgPT4ge1xyXG4gICAgICAgIHRoaXMuX3dvcmtlclJlYWR5RGVmZXIucmVzbG92ZShkYXRhKTtcclxuICAgICAgfSk7XHJcbiAgICB9IGVsc2Uge1xyXG4gICAgICAvLyBcdTRFM0JcdTdFQkZcdTdBMEJcdUZGMENcdTdCNDlcdTVGODVXb3JrZXJSZWFkeVx1NkQ4OFx1NjA2RlxyXG4gICAgICB0aGlzLm9uKCdXOlJlYWR5JywgYXN5bmMgKGRhdGEpID0+IHtcclxuICAgICAgICB0aGlzLl93b3JrZXJSZWFkeURlZmVyLnJlc2xvdmUoZGF0YSk7XHJcbiAgICAgICAgcmV0dXJuIHt9O1xyXG4gICAgICB9KTtcclxuICAgICAgdGhpcy5fd29ya2VyUmVhZHlEZWZlci5yZXN1bHQoKS50aGVuKCgpID0+IHtcclxuICAgICAgICBsb2cuaW5mbygnV29ya2VyUmVhZHknKTtcclxuICAgICAgfSk7XHJcbiAgICB9XHJcbiAgfVxyXG5cclxuICBvbk1lc3NhZ2UoZXY6IE1lc3NhZ2VFdmVudCkge1xyXG4gICAgY29uc3QgZGF0YSA9IGV2LmRhdGEgYXMgSU1lc3NhZ2VTdHJ1Y3Q7XHJcbiAgICBpZiAoZGF0YS5yZXBseSkge1xyXG4gICAgICAvLyBcdTU5MDRcdTc0MDZcdTVFOTRcdTdCNTRcdTZEODhcdTYwNkZcclxuICAgICAgY29uc3QgcmVwbHkgPSB0aGlzLl93YWl0UmVwbHkuZ2V0KGRhdGEucmVwbHkpO1xyXG4gICAgICAvLyBsb2cuaW5mbygnPDw9IFJlcGx5IE1lc3NhZ2UgJywgZGF0YSk7XHJcbiAgICAgIGlmIChyZXBseSkge1xyXG4gICAgICAgIGlmIChkYXRhLmVycikgcmVwbHkucmVqKGRhdGEuZXJyKTtcclxuICAgICAgICBlbHNlIHJlcGx5LnJlcyhkYXRhLmRhdGEpO1xyXG4gICAgICAgIHRoaXMuX3dhaXRSZXBseS5kZWxldGUoZGF0YS5yZXBseSk7XHJcbiAgICAgIH0gZWxzZSB7XHJcbiAgICAgICAgbG9nLndhcm4oJ01lc3NhZ2Uub25NZXNzYWdlJywgJ3JlcGx5IG5vdCBmb3VuZCcsIGRhdGEpO1xyXG4gICAgICB9XHJcbiAgICB9IGVsc2Uge1xyXG4gICAgICAvLyBcdTU5MDRcdTc0MDZcdThCRjdcdTZDNDJcdTZEODhcdTYwNkZcclxuICAgICAgLy8gbG9nLmluZm8oJz0+PiBSZWNlaXZlZCBNZXNzYWdlJywgZGF0YSk7XHJcbiAgICAgIGNvbnN0IGxpc3RlbmVyID0gdGhpcy5fbGlzdGVuZXJzLmdldChkYXRhLnR5cGUgYXMgSU1lc3NhZ2VUeXBlKTtcclxuICAgICAgaWYgKGxpc3RlbmVyKSB7XHJcbiAgICAgICAgbGlzdGVuZXIoZGF0YS5kYXRhKVxyXG4gICAgICAgICAgLnRoZW4oKHJlc3VsdDogYW55KSA9PiB7XHJcbiAgICAgICAgICAgIGdsb2JhbE1lc3NhZ2VIYW5kbGUucG9zdE1lc3NhZ2Uoe1xyXG4gICAgICAgICAgICAgIHR5cGU6IGRhdGEudHlwZSxcclxuICAgICAgICAgICAgICByZXBseTogZGF0YS5pZCxcclxuICAgICAgICAgICAgICBkYXRhOiByZXN1bHQsXHJcbiAgICAgICAgICAgIH0pO1xyXG4gICAgICAgICAgfSlcclxuICAgICAgICAgIC5jYXRjaCgoZXJyOiBhbnkpID0+IHtcclxuICAgICAgICAgICAgbG9nLmVycm9yKGBvbk1lc3NhZ2UgJHtkYXRhLnR5cGV9YCwgZXJyKTtcclxuICAgICAgICAgICAgZ2xvYmFsTWVzc2FnZUhhbmRsZS5wb3N0TWVzc2FnZSh7XHJcbiAgICAgICAgICAgICAgcmVwbHk6IGRhdGEuaWQsXHJcbiAgICAgICAgICAgICAgZXJyOiBlcnIsXHJcbiAgICAgICAgICAgIH0pO1xyXG4gICAgICAgICAgfSk7XHJcbiAgICAgIH0gZWxzZSB7XHJcbiAgICAgICAgbG9nLndhcm4oJ01lc3NhZ2Uub25NZXNzYWdlJywgJ2xpc3RlbmVyIG5vdCBmb3VuZCcsIGRhdGEpO1xyXG4gICAgICB9XHJcbiAgICB9XHJcbiAgfVxyXG5cclxuICAvLyBcdTUzRDFcdTkwMDFcdTZEODhcdTYwNkYsXHU1RTc2XHU4M0I3XHU1M0Q2XHU4RkQ0XHU1NkRFXHU3RUQzXHU2NzlDXHJcbiAgYXN5bmMgc2VuZDxUIGV4dGVuZHMgSU1lc3NhZ2VUeXBlPihcclxuICAgIHR5cGU6IFQsXHJcbiAgICBkYXRhOiBJTWVzc2FnZXNbVF1bJ3NlbmQnXSxcclxuICAgIHRyYW5zZmVyPzogYW55W11cclxuICApOiBQcm9taXNlPElNZXNzYWdlc1tUXVsncmVwbHknXT4ge1xyXG4gICAgaWYgKCFpc1dvcmtlcikge1xyXG4gICAgICAvLyBcdTRFM0JcdTdFQkZcdTdBMEJcdUZGMENcdTdCNDlcdTVGODVXb3JrZXJcdTUxQzZcdTU5MDdcdTU5N0RcclxuICAgICAgYXdhaXQgdGhpcy5fd29ya2VyUmVhZHlEZWZlci5yZXN1bHQoKTtcclxuICAgIH1cclxuXHJcbiAgICByZXR1cm4gbmV3IFByb21pc2UoKHJlcywgcmVqKSA9PiB7XHJcbiAgICAgIGNvbnN0IGlkID0gdGhpcy5fbXNnSWQrKztcclxuICAgICAgdGhpcy5fd2FpdFJlcGx5LnNldChpZCwgeyByZXMsIHJlaiB9KTtcclxuICAgICAgLy8gXHU4RDg1XHU2NUY2XHU1OTA0XHU3NDA2XHJcbiAgICAgIHNldFRpbWVvdXQoKCkgPT4ge1xyXG4gICAgICAgIGlmICh0aGlzLl93YWl0UmVwbHkuaGFzKGlkKSkge1xyXG4gICAgICAgICAgdGhpcy5fd2FpdFJlcGx5LmRlbGV0ZShpZCk7XHJcbiAgICAgICAgICByZWooJ3RpbWVvdXQnKTtcclxuICAgICAgICAgIC8vIGxvZy5lcnJvcignTWVzc2FnZS5zZW5kJywgJ3RpbWVvdXQnLCB0eXBlLCBkYXRhKVxyXG4gICAgICAgIH1cclxuICAgICAgfSwgVElNRU9VVCk7XHJcbiAgICAgIC8vIFx1NTNEMVx1OTAwMVx1NkQ4OFx1NjA2RlxyXG4gICAgICBnbG9iYWxNZXNzYWdlSGFuZGxlLnBvc3RNZXNzYWdlKFxyXG4gICAgICAgIHtcclxuICAgICAgICAgIHR5cGUsXHJcbiAgICAgICAgICBpZCxcclxuICAgICAgICAgIGRhdGEsXHJcbiAgICAgICAgfSxcclxuICAgICAgICB0cmFuc2ZlclxyXG4gICAgICApO1xyXG4gICAgfSk7XHJcbiAgfVxyXG5cclxuICBvbjxUIGV4dGVuZHMgSU1lc3NhZ2VUeXBlPih0eXBlOiBULCBjYWxsYmFjazogKGRhdGE6IElNZXNzYWdlc1tUXVsnc2VuZCddKSA9PiBQcm9taXNlPElNZXNzYWdlc1tUXVsncmVwbHknXT4pIHtcclxuICAgIHRoaXMuX2xpc3RlbmVycy5zZXQodHlwZSwgY2FsbGJhY2spO1xyXG4gIH1cclxufVxyXG5cclxuZXhwb3J0IGNvbnN0IG1lc3NhZ2UgPSBuZXcgTWVzc2FnZSgpO1xyXG4iLCAiaW1wb3J0IHsgSUVsZW1Kc29uIH0gZnJvbSBcIi4uL2NvbW1vblwiO1xyXG5cclxuY29uc3QgX0xPQ0FMX1RBR19QUkVGSVggPSAnc2VsZidcclxuXHJcblxyXG5leHBvcnQgY29uc3Qgd29ya2VyTWV0YSA9IG5ldyBjbGFzcyBXb3JrZXJNZXRhIHtcclxuICAgIG5wbVVybCA9ICcvbm9kZV9tb2R1bGVzLydcclxuICAgIGhvbWVVcmw9Jy8nXHJcbiAgICBjb25zdHJ1Y3RvcigpIHtcclxuICAgIH1cclxuXHJcbiAgICBub3JtYWxpemVUYWcodGFnOiBzdHJpbmcscmVsVXJsOnN0cmluZykge1xyXG4gICAgICAgIGlmKHRhZy5pbmNsdWRlcygnLicpKSByZXR1cm4gdGFnXHJcbiAgICAgICAgLy8gXHU0RTNBdGFnXHU2REZCXHU1MkEwXHU5RUQ4XHU4QkE0XHU3Njg0XHU1MjREXHU3RjAwXHJcbiAgICAgICAgaWYoIHJlbFVybC5tYXRjaCgvXmh0dHBzPzpcXC9cXC8vKSAhPSBudWxsKXtcclxuICAgICAgICAgICAgICAgIHJldHVybiBfTE9DQUxfVEFHX1BSRUZJWCsnLicgKyB0YWdcclxuICAgICAgICB9XHJcbiAgICAgICAgZWxzZXtcclxuICAgICAgICAgICAgLy8gTnBtXHU1MzA1XHU4REVGXHU1Rjg0XHJcbiAgICAgICAgICAgIHJldHVybiByZWxVcmwucmVwbGFjZSgvLS8sJ18nKS5yZXBsYWNlKC9ALywnJykucmVwbGFjZSgvXFwvL2csJy0nKSArICcuJyArIHRhZ1xyXG4gICAgICAgIH0gICAgXHJcbiAgICB9XHJcbiAgICAvLyBcdTRFQ0VcdTY4MDdcdTdCN0VcdTU0MERcdThGNkNcdTYzNjJcdTRFM0FcdTdFQzRcdTRFRjZcdThERUZcdTVGODRcdTUyNERcdTdGMDBcclxuICAgIHRhZ1BhdGhQcmVmaXgodGFnOiBzdHJpbmcpIHtcclxuICAgICAgICBsZXQgW3MxLHMyXSA9IHRhZy5zcGxpdCgnLicpXHJcbiAgICAgICAgLy8gczJcdTRFM0FcdTY4MDdcdTdCN0VcdTU0MEQsXHU2NkZGXHU2MzYyJy0nXHU0RTNBJy8nLFx1NjZGRlx1NjM2MidfJ1x1NTQwRVx1OTc2Mlx1NUI1N1x1NkJDRFx1NEUzQVx1NTkyN1x1NTE5OSxcdTU5ODJcdTY3OUNcdTY3MDBcdTU0MEVcdTRFMDBcdTRFMkFcdTVCNTdcdTdCMjZcdTRFM0EnLScsXHU1MjE5XHU1MjIwXHU5NjY0XHJcbiAgICAgICAgaWYoczIuZW5kc1dpdGgoJy0nKSkgczIgPSBzMi5zbGljZSgwLC0xKVxyXG4gICAgICAgIGNvbnN0IHBhdGggPSBzMi5yZXBsYWNlKC8tL2csICcvJykucmVwbGFjZSgvXyhcXHcpL2csIChfLCBzKSA9PiBzLnRvVXBwZXJDYXNlKCkpXHJcblxyXG4gICAgICAgIGlmKHMxID09IF9MT0NBTF9UQUdfUFJFRklYKXtcclxuICAgICAgICAgICAgLy8gXHU1M0JCXHU5NjY0cGF0aG5hbWVcdTY1ODdcdTRFRjZcdTU0MERcdUZGMENcdTRGRERcdTc1NTlcdThERUZcdTVGODRcclxuICAgICAgICAgICAgcmV0dXJuIHRoaXMuaG9tZVVybCAgKyBwYXRoO1xyXG4gICAgICAgICAgICBcclxuICAgICAgICB9ZWxzZXtcclxuICAgICAgICAgICAgLy8gXHU0RUU1bnBtXHU1MzA1XHU0RTNBXHU2ODM5XHU3NkVFXHU1RjU1LFx1ODNCN1x1NTNENlx1N0VDNFx1NEVGNlx1OERFRlx1NUY4NCwnLSdcdTUyMDZcdTUyNzIgQHNjb3BlL3BhY2thZ2UsICdfJ1x1OEY2Q1x1NjM2Mlx1NEUzQVx1NTM5Rlx1NTlDQlx1NjU4N1x1NEVGNlx1NTQwRFx1NEUyRFx1NzY4NCctJ1xyXG4gICAgICAgICAgICBsZXQgcGtnID0gczEucmVwbGFjZSgvLS9nLCAnLycpLnJlcGxhY2UoL18vZywnLScpO1xyXG4gICAgICAgICAgICBpZihwa2cuaW5jbHVkZXMoJy8nKSkgcGtnID0gJ0AnK3BrZztcclxuXHJcbiAgICAgICAgICAgIHJldHVybiB0aGlzLm5wbVVybCArIHBrZyArICcvJyArIHBhdGhcclxuICAgICAgICB9XHJcbiAgICB9XHJcbiAgICBzZXRIb21lVXJsKHVybDogc3RyaW5nKSB7XHJcbiAgICAgICAgdGhpcy5ob21lVXJsID0gdXJsLnJlcGxhY2UoL1teL10qJC8sICcnKTtcclxuICAgIH1cclxuXHJcbiAgICBzZXRNZXRhKG1ldGE6IElFbGVtSnNvbltdKSB7XHJcbiAgICB9XHJcbn0iLCAiaW1wb3J0IHsgTG9nZ2VyIH0gZnJvbSAnLi4vbG9nZ2VyJztcclxuXHJcbmNvbnN0IGxvZyA9IExvZ2dlcignd29ya2VyU2NvcGUnKTtcclxuY29uc3QgVFJJR0dFUl9OT1RJQ0VfSU5URVJWQUwgPSA1O1xyXG5cclxuLy8gXHU4OUMyXHU1QkRGXHU1QkY5XHU4QzYxLHN5bU9ic2VydmVyIFx1NEZERFx1NUI1OFx1NEU4Nlx1NEY5RFx1OEQ1Nlx1NzY4NFNldFx1OTZDNlx1NTQwOFxyXG5leHBvcnQgY29uc3QgU3ltT2JqZWN0T2JzZXJ2ZXIgPSBTeW1ib2woJ1N5bU9iamVjdE9ic2VydmVyJyk7XHJcbi8vIFx1NUI5QVx1NEU0OVx1N0IyNlx1NTNGNyxcdTc1MjhcdTRFOEVcdTY4MDdcdTVGRDdcdTkwNERcdTUzODZcdTkwMTJcdTVGNTJcdTVCRjlcdThDNjFcdTY1RjZcdTc2ODRcdTVGQUFcdTczQUZcdTY4QzBcdTZENEJcclxuZXhwb3J0IGNvbnN0IFN5bU9iamVjdFZpc2l0VGlja3MgPSBTeW1ib2woJ1N5bU9iamVjdFZpc2l0ZWQnKTtcclxuLy8gXHU1QzA2XHU1QkY5XHU4QzYxXHU4RjZDXHU2MzYyXHU0RTNBXHU1M0VGXHU4OUMyXHU2RDRCXHU1QkY5XHU4QzYxXHU2NUY2LFx1NEZERFx1NUI1OFx1NTM5Rlx1NTlDQlx1NUM1RVx1NjAyN1x1NjNDRlx1OEZGMFxyXG5leHBvcnQgY29uc3QgU3ltT2JqZWN0SW5pdFByb3BEZXNjID0gU3ltYm9sKCdTeW1PYmplY3RJbml0UHJvcERlc2MnKTtcclxuZXhwb3J0IGNvbnN0IFN5bVNjb3BlUHJvdG8gPSBTeW1ib2woJ1Njb3BlUHJvdG8nKTtcclxuLy8gXHU1QjlBXHU0RTQ5V29ya2VyXHU1MzlGXHU3NTFGXHU1QkY5XHU4QzYxXHU3QjI2XHU1M0Y3LFx1NzUyOFx1NEU4RVx1NTIyNFx1NUI5QVx1NjYyRlx1NTQyNlx1NEUzQVx1NTM5Rlx1NzUxRlx1NUJGOVx1OEM2MVxyXG5leHBvcnQgY29uc3QgU3ltV29ya2VyTmF0aXZlT2JqZWN0ID0gU3ltYm9sKCdXb3JrZXJOYXRpdmVPYmplY3QnKTtcclxuXHJcbi8vIFx1NEUzQVx1NjI0MFx1NjcwOVx1NTM5Rlx1NzUxRlx1NUJGOVx1OEM2MVx1NkRGQlx1NTJBMFx1NTM5Rlx1NzUxRlx1NUJGOVx1OEM2MVx1NjgwN1x1NUZENyxcdTRFRTVcdTRGNUNcdTUyMjRcdTVCOUFcclxuW1xyXG4gIE1lc3NhZ2VQb3J0LFxyXG4gIEltYWdlQml0bWFwLFxyXG4gIE9mZnNjcmVlbkNhbnZhcyxcclxuICBJbWFnZURhdGEsXHJcbiAgQmxvYixcclxuICBGaWxlLFxyXG4gIEZpbGVMaXN0LFxyXG4gIEZvcm1EYXRhLFxyXG4gIFJlYWRhYmxlU3RyZWFtLFxyXG4gIFJlc3BvbnNlLFxyXG4gIFVSTCxcclxuICBVUkxTZWFyY2hQYXJhbXMsXHJcbiAgV29ya2VyLFxyXG4gIChnbG9iYWxUaGlzIGFzIGFueSlbJ1dvcmtMb2NhdGlvbiddLFxyXG4gIFRleHREZWNvZGVyLFxyXG4gIFRleHRFbmNvZGVyLFxyXG4gIEZpbGVSZWFkZXIsXHJcbiAgV2ViU29ja2V0LFxyXG4gIFBlcmZvcm1hbmNlLFxyXG4gIFhNTEh0dHBSZXF1ZXN0LFxyXG4gIFhNTEh0dHBSZXF1ZXN0RXZlbnRUYXJnZXQsXHJcbiAgWE1MSHR0cFJlcXVlc3RVcGxvYWQsXHJcbiAgT2Zmc2NyZWVuQ2FudmFzLFxyXG4gIE9mZnNjcmVlbkNhbnZhc1JlbmRlcmluZ0NvbnRleHQyRCxcclxuXHJcbl0uZm9yRWFjaCgodikgPT4ge1xyXG4gIGlmICh2KVxyXG4gICAgT2JqZWN0LmRlZmluZVByb3BlcnR5KHYsIFN5bVdvcmtlck5hdGl2ZU9iamVjdCwge1xyXG4gICAgICB2YWx1ZTogdHJ1ZSxcclxuICAgICAgd3JpdGFibGU6IGZhbHNlLFxyXG4gICAgICBlbnVtZXJhYmxlOiBmYWxzZSxcclxuICAgIH0pO1xyXG59KTtcclxuXHJcbi8vIFx1NEY1Q1x1NzUyOFx1NTdERlx1OTAxQVx1NzdFNVx1NUJGOVx1OEM2MSxcdTRFRTVTY29wZVx1NEUzQVx1NTM1NVx1NEY0RCxcdTkwMUFcdTc3RTVcdTRGOURcdThENTZcdTc2ODRcdTVCRjlcdThDNjFcdTU5MDRcdTc0MDZcdTUzRDhcdTY2RjRcclxuY29uc3QgX2dsb2JhbFNjb3BlTm90aWZpZXIgPSBuZXcgKGNsYXNzIFNjb3BlTm90aWZpZXIge1xyXG4gIHByaXZhdGUgX25vdGljZVNldHMgPSBuZXcgTWFwPHN0cmluZywgU2V0PFNldDxzdHJpbmc+Pj4oKTtcclxuICBjb25zdHJ1Y3RvcigpIHtcclxuICAgIHNldEludGVydmFsKCgpID0+IHtcclxuICAgICAgdGhpcy5fdHJpZ2dlck5vdGljZSgpO1xyXG4gICAgfSwgVFJJR0dFUl9OT1RJQ0VfSU5URVJWQUwpO1xyXG4gIH1cclxuXHJcbiAgLy8gXHU2REZCXHU1MkEwXHU0RTAwXHU0RTJBXHU5MDFBXHU3N0U1XHU1QkY5XHU4QzYxLFx1NkRGQlx1NTJBMFx1NTQ4Q1x1OEJCMFx1NUY1NVx1NTM5Rlx1NTlDQlx1OERERlx1OEUyQVx1NUJGOVx1OEM2MVxyXG4gIC8vIFx1OEZEOVx1NjgzN1x1NTNFRlx1NEVFNVx1NTg5RVx1NTJBMFx1NjAyN1x1ODBGRFx1RkYwQ1x1NUY1M1x1OTg5MVx1N0U0MVx1NTNEOFx1NjZGNFx1NjVGNlx1RkYwQ1x1NTNFQVx1OEJCMFx1NUY1NVx1NjcwMFx1NTQwRVx1NEUwMFx1NkIyMVx1NTNEOFx1NjZGNFxyXG4gIC8vIFx1NjcwMFx1N0VDOFx1NTcyOFx1NjI2N1x1ODg0Q1x1NjVGNlx1OEZEQlx1ODg0Q1x1NEUwMFx1NkIyMVx1NTQwOFx1NUU3Nlx1OEJBMVx1N0I5N1xyXG4gIGFkZE5vdGljZVNldChzY29wZU5hbWU6IHN0cmluZywgc2V0OiBTZXQ8c3RyaW5nPikge1xyXG4gICAgbG9nLmluZm8oYD09PmFkZE5vdGljZVNldDogJHtzY29wZU5hbWV9LT4gJHtbLi4uc2V0XS5qb2luKCcsJyl9YCk7XHJcbiAgICBsZXQgbm90aWNlU2V0ID0gdGhpcy5fbm90aWNlU2V0cy5nZXQoc2NvcGVOYW1lKTtcclxuICAgIGlmICghbm90aWNlU2V0KSB7XHJcbiAgICAgIG5vdGljZVNldCA9IG5ldyBTZXQoKTtcclxuICAgICAgdGhpcy5fbm90aWNlU2V0cy5zZXQoc2NvcGVOYW1lLCBub3RpY2VTZXQpO1xyXG4gICAgfVxyXG4gICAgbm90aWNlU2V0LmFkZChzZXQpO1xyXG4gIH1cclxuXHJcbiAgcHJpdmF0ZSBfdHJpZ2dlck5vdGljZSgpIHtcclxuICAgIC8vIGxvZy5pbmZvKCd0cmlnZ2VyTm90aWNlJyx0aGlzLl9ub3RpY2VTZXRzKTtcclxuICAgIC8vIFx1OEJBMVx1N0I5N1x1NTQ4Q1x1NTQwOFx1NUU3Nlx1OTAxQVx1NzdFNVx1NUJGOVx1OEM2MVxyXG4gICAgdGhpcy5fbm90aWNlU2V0cy5mb3JFYWNoKChub3RpY2VTZXQsIHNjb3BlTmFtZSkgPT4ge1xyXG4gICAgICBsZXQgbWVyZ2VkU2V0ID0gbmV3IFNldDxzdHJpbmc+KCk7XHJcbiAgICAgIG5vdGljZVNldC5mb3JFYWNoKChzZXQpID0+IHtcclxuICAgICAgICBzZXQuZm9yRWFjaCgoaykgPT4gbWVyZ2VkU2V0LmFkZChrKSk7XHJcbiAgICAgIH0pO1xyXG4gICAgICAvLyBcdTYyNjdcdTg4NENcdTkwMUFcdTc3RTVcclxuICAgICAgbGV0IHNjb3BlID0gX2dsb2JhbFNjb3Blc01hcC5nZXQoc2NvcGVOYW1lKTtcclxuICAgICAgaWYgKHNjb3BlKSB7XHJcbiAgICAgICAgbG9nLmluZm8oJ3RyaWdnZXJOb3RpY2UnLCBzY29wZU5hbWUsIG1lcmdlZFNldCk7XHJcbiAgICAgICAgbWVyZ2VkU2V0LmZvckVhY2goKGspID0+IHtcclxuICAgICAgICAgIHRyeSB7XHJcbiAgICAgICAgICAgIHNjb3BlLmV4ZWNUcmFjZU9uQ2hhbmdlZENhbGxiYWNrKGspO1xyXG4gICAgICAgICAgfSBjYXRjaCAoZSkge1xyXG4gICAgICAgICAgICBsb2cuZXJyb3IoYHRyaWdnZXJOb3RpY2UgZXJyb3I6ICR7c2NvcGVOYW1lfS0+JHtrfWAsIGUpO1xyXG4gICAgICAgICAgfVxyXG4gICAgICAgIH0pO1xyXG4gICAgICB9XHJcbiAgICB9KTtcclxuXHJcbiAgICAvLyBcdTZFMDVcdTdBN0FcdTkwMUFcdTc3RTVcdTVCRjlcdThDNjFcclxuICAgIHRoaXMuX25vdGljZVNldHMuY2xlYXIoKTtcclxuICB9XHJcbn0pKCk7XHJcblxyXG5leHBvcnQgY2xhc3MgU2NvcGVEZXBlbmRlbnRzIHtcclxuICAvLyBcdTVCRjlcdThDNjFcdTgxRUFcdThFQUJcdTc2ODRcdTRGOURcdThENTZcdTUzRDhcdTY2RjRcdTVCRjlcdThDNjFcdUZGMENcdTVGNTNcdTVCRjlcdThDNjFcdTUzRDhcdTUzMTZcdTY1RjZcdUZGMENcdTkwMUFcdTc3RTVcdTYyNDBcdTY3MDlcdTRGOURcdThENTZcdTc2ODRcdTVCRjlcdThDNjFcclxuICAvLyBcdTZCNjRcdTRGOURcdThENTZcdTk4NzlcdTU3MjhcdTUxNzZcdTUxNzZcdTRFRDZcdTVCRjlcdThDNjFcdTc2ODRcdTVDNUVcdTYwMjdcdTRFMkRcdTUzRDhcdTUzMTZcdTY1RjZcdUZGMENcdThCQjBcdTVGNTVcdTRGOURcdThENTZcdUZGMENcdTRFRTVcdTU3MjhcdTgxRUFcdThFQUJcdTUzRDhcdTUzMTZcdTY1RjZcdUZGMENcdTU5ODJkZWxldGVcdTY1RjZcdUZGMENcdTkwMUFcdTc3RTVcdTRGOURcdThENTZcdTVCRjlcdThDNjFcclxuICBwcml2YXRlIF9zZWxmRGVwZW5kZW50cyA9IG5ldyBTZXQ8c3RyaW5nPigpO1xyXG4gIC8vIFx1OEJCMFx1NUY1NVx1NUM1RVx1NjAyN1x1NEY5RFx1OEQ1Nlx1NUJGOVx1OEM2MVxyXG4gIHByaXZhdGUgX3Byb3BEZXBlbmRlbnRzID0gbmV3IE1hcDxzdHJpbmcsIFNldDxzdHJpbmc+PigpO1xyXG4gIGNvbnN0cnVjdG9yKHNjb3BlTmFtZTogc3RyaW5nKSB7fVxyXG5cclxuICBhZGRTZWxmRGVwZW5kZW50KGtleTogc3RyaW5nKSB7XHJcbiAgICB0aGlzLl9zZWxmRGVwZW5kZW50cy5hZGQoa2V5KTtcclxuICB9XHJcblxyXG4gIGFkZFByb3BEZXBlbmRlbnQoa2V5OiBzdHJpbmcsIHByb3A6IHN0cmluZykge1xyXG4gICAgbGV0IHNldCA9IHRoaXMuX3Byb3BEZXBlbmRlbnRzLmdldChwcm9wKTtcclxuICAgIGlmICghc2V0KSB7XHJcbiAgICAgIHNldCA9IG5ldyBTZXQ8c3RyaW5nPigpO1xyXG4gICAgICB0aGlzLl9wcm9wRGVwZW5kZW50cy5zZXQocHJvcCwgc2V0KTtcclxuICAgIH1cclxuICAgIHNldC5hZGQoa2V5KTtcclxuICB9XHJcbiAgZ2V0UHJvcERlcGVuZGVudHMoa2V5OiBzdHJpbmcpOiBTZXQ8c3RyaW5nPiB8IHVuZGVmaW5lZCB7XHJcbiAgICByZXR1cm4gdGhpcy5fcHJvcERlcGVuZGVudHMuZ2V0KGtleSk7XHJcbiAgfVxyXG4gIGdldFNlbGZEZXBlbmRlbnRzKCk6IFNldDxzdHJpbmc+IHtcclxuICAgIHJldHVybiB0aGlzLl9zZWxmRGVwZW5kZW50cztcclxuICB9XHJcbn1cclxuXHJcbi8vIFx1NUY1M1x1NTI0RFx1NTE2OFx1NUM0MFx1NEY1Q1x1NzUyOFx1NTdERlx1OERERlx1OEUyQVxyXG5sZXQgX2dsb2JhbFRyYWNlS2V5OiBzdHJpbmcgfCB1bmRlZmluZWQgPSB1bmRlZmluZWQ7XHJcbmxldCBfZ2xvYmFsU2NvcGVzTWFwID0gbmV3IE1hcDxzdHJpbmcsIFdvcmtlclNjb3BlPigpO1xyXG5cclxuLyoqXHJcbiAqIFx1NEY1Q1x1NzUyOFx1NTdERlx1NUJGOVx1OEM2MSwgXHU4MUVBXHU1MkE4XHU4RERGXHU4RTJBXHU1QkY5XHU4QzYxXHU3Njg0XHU1QzVFXHU2MDI3XHU1M0Q4XHU1MzE2LFx1NUU3Nlx1OTAxQVx1NzdFNVx1NEY5RFx1OEQ1Nlx1NzY4NFx1NUJGOVx1OEM2MVx1NTkwNFx1NzQwNlx1NTNEOFx1NjZGNFxyXG4gKiBcdTVGNTNcdTRFMDBcdTRFMkFcdTVCRjlcdThDNjFcdTZERkJcdTUyQTBcdTUyMzBcdTRGNUNcdTc1MjhcdTU3REZcdTRFMkRcdTY1RjYsXHU0RjFBXHU4MUVBXHU1MkE4XHU4RERGXHU4RTJBXHU1QkY5XHU4QzYxXHU3Njg0XHU1QzVFXHU2MDI3XHU1M0Q4XHU1MzE2XHJcbiAqIFx1NkJDRlx1NEUyQVdlYkNvbXBvbmVudFx1NUI5RVx1NEY4Qlx1NjJFNVx1NjcwOVx1NTUyRlx1NEUwMFx1NzY4NFx1NEY1Q1x1NzUyOFx1NTdERlx1NUJGOVx1OEM2MVxyXG4gKiBcdTVGNTMgV2ViQ29tcG9uZW50XHU1QjlFXHU0RjhCXHU5NTAwXHU2QkMxXHU2NUY2LFx1NEY1Q1x1NzUyOFx1NTdERlx1NUJGOVx1OEM2MVx1NEU1Rlx1NEYxQVx1OTUwMFx1NkJDMVxyXG4gKiBcdTUzRUZcdTRFRTVcdTRFM0FcdTVCNTBcdTUxNDNcdTdEMjBcdTUyMUJcdTVFRkFcdTVCNTBTY29wZSxcdTVCNTBTY29wZVx1OTAxQVx1OEZDN1x1NTM5Rlx1NTc4Qlx1OTRGRVx1N0VFN1x1NjI3Rlx1NzIzNlNjb3BlXHU3Njg0XHU1QzVFXHU2MDI3XHVGRjBDXHU1NzI4XHU1QjUwU2NvcGVcdTZERkJcdTUyQTBcdTRFMERcdTVCNThcdTU3MjhcdTc2ODRcdTVDNUVcdTYwMjdcdTY1RjYsXHU0RjFBXHU1NzI4XHU1QjUwU2NvcGVcdTRFMkRcdTUyMUJcdTVFRkFcdTY1QjBcdTc2ODRcdTVDNUVcdTYwMjdcdUZGMENcdTgwMENcdTRFMERcdTY2MkZcdTU3MjhcdTcyMzZTY29wZVx1NEUyRFx1NTIxQlx1NUVGQVx1NjVCMFx1NzY4NFx1NUM1RVx1NjAyN1xyXG4gKlxyXG4gKi9cclxuZXhwb3J0IGNsYXNzIFdvcmtlclNjb3BlIHtcclxuICBwcml2YXRlIF9yb290U2NvcGUgPSB7fSBhcyBhbnk7XHJcbiAgcHJpdmF0ZSBfdHJhY2VDYWxsYmFja3MgPSBuZXcgTWFwPFxyXG4gICAgc3RyaW5nLFxyXG4gICAge1xyXG4gICAgICBjYWxjRnVuYzogKCkgPT4gYW55O1xyXG4gICAgICBjaGFuZ2VkQ2FsbGJhY2s6IChyZXN1bHQ6IGFueSkgPT4gdm9pZDtcclxuICAgIH1cclxuICA+KCk7XHJcblxyXG4gIGNvbnN0cnVjdG9yKFxyXG4gICAgcHJpdmF0ZSBfc2NvcGVOYW1lOiBzdHJpbmcsIC8vIFx1NEY1Q1x1NzUyOFx1NTdERlx1NTE3M1x1ODA1NGNvbXBvbmVudElkLFx1NzUyOFx1NEU4RVx1NTNEOFx1NjZGNFx1OERERlx1OEUyQVxyXG4gICAgX2luaXRPYmplY3Q6IGFueSAvLyBcdTUyMURcdTU5Q0JcdTUzMTZcdTVCRjlcdThDNjFcclxuICApIHtcclxuICAgIGxvZy5pbmZvKCduZXcgV29ya2VyU2NvcGUnLCBfc2NvcGVOYW1lLCBfaW5pdE9iamVjdCk7XHJcbiAgICB0aGlzLl9yb290U2NvcGUgPSB0aGlzLl9pbml0Um9vdFNjb3BlKF9pbml0T2JqZWN0IHx8IHt9KTtcclxuXHJcbiAgICAvLyBcdTUxNjhcdTVDNDBcdTZDRThcdTUxOENTY29wZVxyXG4gICAgX2dsb2JhbFNjb3Blc01hcC5zZXQoX3Njb3BlTmFtZSwgdGhpcyk7XHJcbiAgfVxyXG4gIC8vIFx1NTIxRFx1NTlDQlx1NTMxNlx1NEYyMFx1NTE2NVx1NzY4NFx1OTg4NFx1NUI5QVx1NEU0OVx1NUJGOVx1OEM2MVxyXG4gIHByaXZhdGUgX2luaXRSb290U2NvcGUob2JqOiBhbnkpOiBhbnkge1xyXG4gICAgbGV0IHJvb3QgPSB7fTtcclxuICAgIC8vIFx1NjhDMFx1NkQ0Qm9ialx1NjYyRlx1NTQyNlx1NEUzQVx1N0M3QixcdTU5ODJcdTY3OUNcdTY2MkZcdTdDN0JcdTUyMTlcdTUyMURcdTU5Q0JcdTUzMTZcdTRFMDBcdTRFMkFcdTVCOUVcdTRGOEJcclxuICAgIGlmIChvYmogaW5zdGFuY2VvZiBGdW5jdGlvbikge1xyXG4gICAgICB0cnkge1xyXG4gICAgICAgIHJvb3QgPSBuZXcgb2JqKCk7XHJcbiAgICAgIH0gY2F0Y2ggKGUpIHtcclxuICAgICAgICBsb2cud2Fybigncm9vdCBvYmplY3Qgbm90IGNsYXNzJywgdGhpcy5fc2NvcGVOYW1lKTtcclxuICAgICAgfVxyXG4gICAgfSBlbHNlIGlmICh0eXBlb2Ygb2JqID09PSAnb2JqZWN0Jykge1xyXG4gICAgICByb290ID0gb2JqO1xyXG4gICAgfSBlbHNlIHtcclxuICAgICAgLy8gXHU0RTBEXHU2NTJGXHU2MzAxXHU5NzVFXHU1QkY5XHU4QzYxXHU3QzdCXHU1NzhCXHJcbiAgICAgIGxvZy5lcnJvcigncm9vdCBvYmplY3Qgbm90IG9iamVjdCcsIHRoaXMuX3Njb3BlTmFtZSwgdHlwZW9mIG9iaiwgb2JqKTtcclxuICAgIH1cclxuICAgIC8vIFx1NEUzQVx1NUJGOVx1OEM2MVx1NTIxQlx1NUVGQVx1ODlDMlx1NUJERlx1NUJGOVx1OEM2MVxyXG4gICAgcm9vdCA9IHRoaXMuX21ha2VPYnNlcnZlcihyb290KTtcclxuXHJcbiAgICAvLyBcdThCQkVcdTdGNkUgcm9vcHRTY29wZVx1NzY4NFx1NTM5Rlx1NTc4Qlx1NEUzQXRoaXMsXHU3RUU3XHU2MjdGXHU3NkY4XHU1MTczXHU2NENEXHU0RjVDXHU1NDhDXHU1MUZEXHU2NTcwXHJcbiAgICBSZWZsZWN0LnNldFByb3RvdHlwZU9mKHRoaXMuX2ZpbmRPYmplY3RQcm90b1Jvb3Qocm9vdCksIHRoaXMuX2NyZWF0ZVJvb3RQcm90bygpKTtcclxuICAgIHJldHVybiByb290O1xyXG4gIH1cclxuXHJcbiAgcHJpdmF0ZSBfY3JlYXRlUm9vdFByb3RvKCkge1xyXG4gICAgbGV0IF90aGlzID0gdGhpcztcclxuICAgIHJldHVybiB7XHJcbiAgICAgIC8vIFx1ODNCN1x1NTNENlx1NjgzOVx1NEY1Q1x1NzUyOFx1NTdERlx1NUJGOVx1OEM2MVxyXG4gICAgICBnZXQgJHJvb3RTY29wZSgpIHtcclxuICAgICAgICByZXR1cm4gX3RoaXMuX3Jvb3RTY29wZTtcclxuICAgICAgfSxcclxuICAgIH07XHJcbiAgfVxyXG4gIGdldCAkcm9vdFNjb3BlKCkge1xyXG4gICAgcmV0dXJuIHRoaXMuX3Jvb3RTY29wZTtcclxuICB9XHJcblxyXG5cclxuICByZWxlYXNlKCkge1xyXG4gICAgX2dsb2JhbFNjb3Blc01hcC5kZWxldGUodGhpcy5fc2NvcGVOYW1lKTtcclxuICB9XHJcblxyXG4gIC8qKlxyXG4gICAqIFx1NEY1Q1x1NzUyOFx1NTdERlx1OERERlx1OEUyQVx1OEMwM1x1NzUyOFxyXG4gICAqIEBUT0RPOiBcdTY3MkFcdTY3NjVcdTY1MkZcdTYzMDFcdTU5MUFcdTRFMkFcdThEREZcdThFMkFcdTVCRjlcdThDNjEsXHU0RTVGXHU1QzMxXHU2NjJGXHU1RjUzXHU1NzI4Y2FsbEZ1bmNcdTRFMkRcdTUxOERcdTZCMjFcdThDMDNcdTc1Mjh0cmFjZUNhbGxcdTY1RjYsXHU1M0VGXHU4RkRCXHU4ODRDXHU1NDBDXHU2QjY1XHU4RERGXHU4RTJBXHJcbiAgICogQHBhcmFtIGtleVxyXG4gICAqIEBwYXJhbSBmdW5jXHJcbiAgICogQHJldHVybnNcclxuICAgKi9cclxuICB0cmFjZUNhbGwoa2V5OiBzdHJpbmcsIGNhbGNGdW5jOiAoKSA9PiBhbnksIGNoYW5nZWRDYWxsYmFjazogKHJlc3VsdDogYW55KSA9PiB2b2lkKSB7XHJcbiAgICAvLyBcdTZDRThcdTUxOENcdTU2REVcdThDMDNcdTUxRkRcdTY1NzBcclxuICAgIHRoaXMuX3RyYWNlQ2FsbGJhY2tzLnNldChrZXksIHtcclxuICAgICAgY2FsY0Z1bmM6IGNhbGNGdW5jLFxyXG4gICAgICBjaGFuZ2VkQ2FsbGJhY2s6IGNoYW5nZWRDYWxsYmFjayxcclxuICAgIH0pO1xyXG5cclxuICAgIC8vIFx1NkNFOFx1NTE4Q1x1NTE2OFx1NUM0MFx1OERERlx1OEUyQWtleVxyXG4gICAgX2dsb2JhbFRyYWNlS2V5ID0ga2V5O1xyXG4gICAgbGV0IHJldCA9IGNhbGNGdW5jKCk7XHJcbiAgICBfZ2xvYmFsVHJhY2VLZXkgPSB1bmRlZmluZWQ7XHJcblxyXG4gICAgLy8gXHU2Q0U4XHU1MThDXHU1MTY4XHU1QzQwXHU4RERGXHU4RTJBa2V5XHJcbiAgICByZXR1cm4gcmV0O1xyXG4gIH1cclxuICB1bnRyYWNlQ2FsbChrZXk6IHN0cmluZykge1xyXG4gICAgdGhpcy5fdHJhY2VDYWxsYmFja3MuZGVsZXRlKGtleSk7XHJcbiAgfVxyXG5cclxuICAvLyBcdTkxQ0RcdTY1QjBcdThCQTFcdTdCOTdcdTVGODVcdTYyNjdcdTg4NENcdTc2ODRcdTUxRkRcdTY1NzBcdUZGMENcdTVFNzZcdThGRDRcdTU2REVcdTdFRDNcdTY3OUNcdUZGMENcdThDMDNcdTc1MjhcdTU2REVcdThDMDNcdTUxRkRcdTY1NzBcclxuICBleGVjVHJhY2VPbkNoYW5nZWRDYWxsYmFjayhrZXk6IHN0cmluZykge1xyXG4gICAgbGV0IGNiID0gdGhpcy5fdHJhY2VDYWxsYmFja3MuZ2V0KGtleSk7XHJcbiAgICBsb2cuaW5mbygnZXhlY0V4aXN0ZFRyYWNlQ2FsbCcsIGtleSwgY2IpO1xyXG4gICAgaWYgKGNiKSB7XHJcbiAgICAgIC8vIFx1NTZFMFx1NEUzQVx1Njc2MVx1NEVGNlx1NTNFRlx1ODBGRFx1NTNEMVx1NzUxRlx1NjUzOVx1NTNEOFx1RkYwQ1x1OTFDRFx1NjVCMFx1OEJBMVx1N0I5N1xyXG4gICAgICAvLyBcdTZDRThcdTUxOENcdTUxNjhcdTVDNDBcdThEREZcdThFMkFrZXlcclxuICAgICAgX2dsb2JhbFRyYWNlS2V5ID0ga2V5O1xyXG4gICAgICBsZXQgcmV0ID0gY2IuY2FsY0Z1bmMoKTtcclxuICAgICAgX2dsb2JhbFRyYWNlS2V5ID0gdW5kZWZpbmVkO1xyXG4gICAgICBjYi5jaGFuZ2VkQ2FsbGJhY2socmV0KTtcclxuICAgIH1cclxuICB9XHJcblxyXG4gIHByaXZhdGUgX2ZpbmRPYmplY3RQcm90b1Jvb3Qob2JqOiBhbnkpOiBhbnkge1xyXG4gICAgbGV0IHByb3RvID0gT2JqZWN0LmdldFByb3RvdHlwZU9mKG9iaik7XHJcbiAgICBpZiAocHJvdG8gPT09IG51bGwgfHwgcHJvdG8gPT09IE9iamVjdC5wcm90b3R5cGUpIHJldHVybiBvYmo7XHJcbiAgICByZXR1cm4gdGhpcy5fZmluZE9iamVjdFByb3RvUm9vdChwcm90byk7XHJcbiAgfVxyXG5cclxuICBwcml2YXRlIF9zYXZlT2JqZWN0SW5pdFByb3BEZXNjKG9iajogYW55LCBwcm9wOiBzdHJpbmcpIHtcclxuICAgIGxldCBkZXNjID0gUmVmbGVjdC5nZXRPd25Qcm9wZXJ0eURlc2NyaXB0b3Iob2JqLCBwcm9wKTtcclxuICAgIGlmIChkZXNjKSB7XHJcbiAgICAgIChvYmpbU3ltT2JqZWN0SW5pdFByb3BEZXNjXSBhcyB7IFtrOiBzdHJpbmddOiBQcm9wZXJ0eURlc2NyaXB0b3IgfSlbcHJvcF0gPSBkZXNjO1xyXG4gICAgfVxyXG4gIH1cclxuXHJcbiAgcHJpdmF0ZSBfZ2V0T2JqZWN0SW5pdFByb3BEZXNjKG9iajogYW55LCBwcm9wOiBzdHJpbmcpOiBQcm9wZXJ0eURlc2NyaXB0b3IgfCB1bmRlZmluZWQge1xyXG4gICAgcmV0dXJuIChvYmpbU3ltT2JqZWN0SW5pdFByb3BEZXNjXSBhcyB7IFtrOiBzdHJpbmddOiBQcm9wZXJ0eURlc2NyaXB0b3IgfSlbcHJvcF07XHJcbiAgfVxyXG5cclxuICAvKipcclxuICAgKiBcdTVDMDZcdTVGNTNcdTUyNERcdTUxNDNcdTdEMjBcdTc2ODRcdTVDNUVcdTYwMjdcdThGNkNcdTYzNjJcdTRFM0FnZXQvc2V0XHU1QzVFXHU2MDI3LFx1NUI5RVx1NzNCMFx1NUM1RVx1NjAyN1x1NTNEOFx1NjZGNFx1OERERlx1OEUyQVxyXG4gICAqL1xyXG4gIHByaXZhdGUgX21ha2VPYmplY3RQcm9wR2V0U2V0KG9iajogYW55LCBwcm9wOiBzdHJpbmcpIHtcclxuICAgIGNvbnN0IF90aGlzID0gdGhpcztcclxuICAgIC8vIFx1NTk4Mlx1Njc5Q1x1NUY1M1x1NTI0RFx1NUJGOVx1OEM2MVx1NEUwRFx1NjYyRlx1NTNFRlx1ODlDMlx1NkQ0Qlx1NUJGOVx1OEM2MVx1RkYwQ1x1OTAwMFx1NTFGQVxyXG4gICAgbGV0IGRlcGVuZGVudHMgPSBvYmpbU3ltT2JqZWN0T2JzZXJ2ZXJdIGFzIFNjb3BlRGVwZW5kZW50cyB8IHVuZGVmaW5lZDtcclxuICAgIGlmICghZGVwZW5kZW50cykge1xyXG4gICAgICBsb2cud2Fybignbm90IG9ic2VydmVyIG9iamVjdCcsIG9iaik7XHJcbiAgICAgIHJldHVybjtcclxuICAgIH1cclxuICAgIC8vIFx1NTk4Mlx1Njc5Q1x1NURGMlx1N0VDRlx1NUU5NFx1NzUyOFx1OEZDN1x1NUY1M1x1NTI0RFx1NUM1RVx1NjAyN1x1NzY4NGdldC9zZXQsXHU1MjE5XHU5MDAwXHU1MUZBXHU0RTBEXHU1MThEXHU5MUNEXHU1OTBEXHU1OTA0XHU3NDA2XHJcbiAgICAvLyBpZiAoZGVwZW5kZW50cy5nZXRQcm9wRGVwZW5kZW50cyhwcm9wKSkgcmV0dXJuO1xyXG5cclxuICAgIC8vIFx1ODNCN1x1NTNENlx1NUM1RVx1NjAyN1x1NjNDRlx1OEZGMCxcdTU5ODJcdTY3OUNcdTVGNTNcdTUyNERcdTVDNUVcdTYwMjdcdTRFMERcdTVCNThcdTU3MjhcdTUyMTlcdTUyMUJcdTVFRkFcclxuICAgIGxldCBkZXNjID0gUmVmbGVjdC5nZXRPd25Qcm9wZXJ0eURlc2NyaXB0b3Iob2JqLCBwcm9wKTtcclxuICAgIC8vIFx1NTk4Mlx1Njc5Q1x1NUM1RVx1NjAyN1x1NEUwRFx1NTNFRlx1OTE0RFx1N0Y2RSxcdTRFMERcdTUzRUZcdTY3OUFcdTRFM0UsXHU0RTBEXHU1M0VGXHU1MTk5XHU1MTY1LFx1NjIxNlx1ODAwNVx1NjYyRlx1NTFGRFx1NjU3MCxcdTUyMTlcdTc2RjRcdTYzQTVcdThCQkVcdTdGNkVcclxuICAgIGlmICghZGVzYyB8fCAhZGVzYy5jb25maWd1cmFibGUgfHwgIWRlc2MuZW51bWVyYWJsZSB8fCAhZGVzYy53cml0YWJsZSB8fCB0eXBlb2YgZGVzYy52YWx1ZSA9PT0gJ2Z1bmN0aW9uJykge1xyXG4gICAgICByZXR1cm47XHJcbiAgICB9XHJcbiAgICAvLyBcdTRGRERcdTVCNThcdTUzOUZcdTU5Q0JcdTVDNUVcdTYwMjdcdTYzQ0ZcdThGRjBcclxuICAgIF90aGlzLl9zYXZlT2JqZWN0SW5pdFByb3BEZXNjKG9iaiwgcHJvcCk7XHJcblxyXG4gICAgLy8gXHU0RTNBXHU1QkY5XHU4QzYxXHU1QzVFXHU2MDI3XHU1MjFCXHU1RUZBZ2V0L3NldFx1NTFGRFx1NjU3MFxyXG4gICAgUmVmbGVjdC5kZWZpbmVQcm9wZXJ0eShvYmosIHByb3AsIHtcclxuICAgICAgZ2V0KCkge1xyXG4gICAgICAgIC8vIFx1OERERlx1OEUyQVx1NUM1RVx1NjAyN1x1OEMwM1x1NzUyOFxyXG4gICAgICAgIF90aGlzLl90cmFjZU9iamVjdFByb3Aob2JqLCBwcm9wKTtcclxuICAgICAgICBsZXQgaW5pdEdldCA9IF90aGlzLl9nZXRPYmplY3RJbml0UHJvcERlc2Mob2JqLCBwcm9wKT8uZ2V0O1xyXG4gICAgICAgIGxldCB2ID0gaW5pdEdldCA/IGluaXRHZXQoKSA6IGRlc2MudmFsdWU7XHJcblxyXG4gICAgICAgIC8vIFx1NkRGQlx1NTJBMFx1OERERlx1OEUyQVx1NUJGOVx1OEM2MVx1ODFFQVx1OEVBQixcdTRFRTVcdTRGQkZcdTU3MjhcdTVCRjlcdThDNjFcdTgxRUFcdThFQUJcdTUzRDFcdTc1MUZcdTUzRDhcdTUzMTZcdTY1RjYsXHU5MDFBXHU3N0U1XHU0RjlEXHU4RDU2XHU1QkY5XHU4QzYxXHJcbiAgICAgICAgX3RoaXMuX3RyYWNlT2JqZWN0U2VsZih2KTtcclxuXHJcbiAgICAgICAgcmV0dXJuIHY7XHJcbiAgICAgIH0sXHJcbiAgICAgIHNldCh2YWx1ZSkge1xyXG4gICAgICAgIGxvZy5pbmZvKCdPYmplY3RTZXQnLCBvYmosIHByb3AsIHZhbHVlKTtcclxuXHJcbiAgICAgICAgX3RoaXMuX25vdGljZVByb3BDaGFuZ2VkKG9iaiwgcHJvcCk7XHJcblxyXG4gICAgICAgIC8vIFx1OEJCRVx1N0Y2RVx1NjVCMFx1NTAzQ1xyXG4gICAgICAgIGxldCBvYlZhbHVlID0gX3RoaXMuX21ha2VPYnNlcnZlcih2YWx1ZSk7XHJcbiAgICAgICAgbGV0IGluaXRTZXQgPSBfdGhpcy5fZ2V0T2JqZWN0SW5pdFByb3BEZXNjKG9iaiwgcHJvcCk/LnNldDtcclxuICAgICAgICBpZiAoaW5pdFNldCkge1xyXG4gICAgICAgICAgaW5pdFNldChvYlZhbHVlKTtcclxuICAgICAgICB9IGVsc2Uge1xyXG4gICAgICAgICAgZGVzYy52YWx1ZSA9IG9iVmFsdWU7XHJcbiAgICAgICAgfVxyXG4gICAgICAgIHJldHVybiB0cnVlO1xyXG4gICAgICB9LFxyXG4gICAgfSk7XHJcbiAgfVxyXG5cclxuICBwcml2YXRlIF90cmFjZU9iamVjdFByb3Aob2JqOiBhbnksIHByb3A6IHN0cmluZykge1xyXG4gICAgaWYgKF9nbG9iYWxUcmFjZUtleSkge1xyXG4gICAgICBvYmpbU3ltT2JqZWN0T2JzZXJ2ZXJdPy5hZGRQcm9wRGVwZW5kZW50KF9nbG9iYWxUcmFjZUtleSwgcHJvcCk7XHJcbiAgICB9XHJcbiAgfVxyXG4gIHByaXZhdGUgX3RyYWNlT2JqZWN0U2VsZihvYmo6IGFueSkge1xyXG4gICAgaWYgKF9nbG9iYWxUcmFjZUtleSkge1xyXG4gICAgICBpZiAodHlwZW9mIG9iaiA9PT0gJ29iamVjdCcgJiYgb2JqICE9PSBudWxsKSB7XHJcbiAgICAgICAgb2JqW1N5bU9iamVjdE9ic2VydmVyXT8uYWRkU2VsZkRlcGVuZGVudChfZ2xvYmFsVHJhY2VLZXkpO1xyXG4gICAgICB9XHJcbiAgICB9XHJcbiAgfVxyXG5cclxuICBwcml2YXRlIF9ub3RpY2VQcm9wQ2hhbmdlZChvYmo6IGFueSwgcHJvcDogc3RyaW5nKSB7XHJcbiAgICBsZXQgZGVwZW5kZW50cyA9IG9ialtTeW1PYmplY3RPYnNlcnZlcl0gYXMgU2NvcGVEZXBlbmRlbnRzIHwgdW5kZWZpbmVkO1xyXG4gICAgaWYgKCFkZXBlbmRlbnRzKSByZXR1cm47XHJcbiAgICBsZXQgcHJvcERlcHMgPSBkZXBlbmRlbnRzLmdldFByb3BEZXBlbmRlbnRzKHByb3ApO1xyXG4gICAgaWYgKHByb3BEZXBzICYmIHByb3BEZXBzLnNpemUgPiAwKSB7XHJcbiAgICAgIF9nbG9iYWxTY29wZU5vdGlmaWVyLmFkZE5vdGljZVNldCh0aGlzLl9zY29wZU5hbWUsIHByb3BEZXBzKTtcclxuICAgIH1cclxuICB9XHJcbiAgcHJpdmF0ZSBfbm90aWNlU2VsZkNoYW5nZWQob2JqOiBhbnkpIHtcclxuICAgIGxldCBkZXBlbmRlbnRzID0gb2JqW1N5bU9iamVjdE9ic2VydmVyXSBhcyBTY29wZURlcGVuZGVudHMgfCB1bmRlZmluZWQ7XHJcbiAgICBpZiAoIWRlcGVuZGVudHMpIHJldHVybjtcclxuICAgIGxldCBzZWxmRGVwcyA9IGRlcGVuZGVudHMuZ2V0U2VsZkRlcGVuZGVudHMoKTtcclxuICAgIGlmIChzZWxmRGVwcy5zaXplID4gMCkge1xyXG4gICAgICBfZ2xvYmFsU2NvcGVOb3RpZmllci5hZGROb3RpY2VTZXQodGhpcy5fc2NvcGVOYW1lLCBzZWxmRGVwcyk7XHJcbiAgICB9XHJcbiAgfVxyXG5cclxuICBwcml2YXRlIF9tYWtlT2JzZXJ2ZXJPYmplY3Qob2JqOiBhbnkpOiBhbnkge1xyXG4gICAgLy8gPT09PT09PT09PT09PT09PT09IFx1NjgwN1x1NTFDNlx1NTMxNlx1NUJGOVx1OEM2MVx1NUM1RVx1NjAyN1x1NTkwNFx1NzQwNiA9PT09PT09PT09PT09PT09PT1cclxuICAgIGxldCBfdGhpcyA9IHRoaXM7XHJcbiAgICAvLyBcdTRFM0FcdTVCRjlcdThDNjFcdTYyNDBcdTY3MDlcdTgxRUFcdThFQUJcdTVDNUVcdTYwMjdcdTUyMUJcdTVFRkFnZXQvc2V0XHU1MUZEXHU2NTcwXHJcbiAgICBSZWZsZWN0Lm93bktleXMob2JqKS5mb3JFYWNoKChrKSA9PiB7XHJcbiAgICAgIGlmICh0eXBlb2YgayAhPT0gJ3N0cmluZycpIHJldHVybjtcclxuXHJcbiAgICAgIC8vIFx1NEUzQVx1NUJGOVx1OEM2MVx1NUM1RVx1NjAyN1x1NTIxQlx1NUVGQWdldC9zZXRcdTUxRkRcdTY1NzBcclxuICAgICAgX3RoaXMuX21ha2VPYmplY3RQcm9wR2V0U2V0KG9iaiwgayk7XHJcbiAgICB9KTtcclxuICAgIC8vIFx1NEUzQVx1NUJGOVx1OEM2MVx1NTM5Rlx1NTc4Qlx1NTIxQlx1NUVGQXByb3h5LFx1NEVFNVx1NTcyOFx1NjVCMFx1NUVGQVx1NUM1RVx1NjAyN1x1NjVGNlx1NTIxQlx1NUVGQVx1ODlDMlx1NUJERlx1NUJGOVx1OEM2MVxyXG4gICAgbGV0IG9sZFByb3RvID0gUmVmbGVjdC5nZXRQcm90b3R5cGVPZihvYmopIHx8ICh7fSBhcyBhbnkpO1xyXG4gICAgaWYgKHR5cGVvZiBvbGRQcm90byA9PSAnb2JqZWN0JyAmJiAhT2JqZWN0LmdldE93blByb3BlcnR5RGVzY3JpcHRvcihvYmosIFN5bVNjb3BlUHJvdG8pKSB7XHJcbiAgICAgIGxldCBuZXdQcm90byA9IE9iamVjdC5jcmVhdGUob2xkUHJvdG8pO1xyXG4gICAgICBPYmplY3QuZGVmaW5lUHJvcGVydHkobmV3UHJvdG8sIFN5bVNjb3BlUHJvdG8sIHtcclxuICAgICAgICB2YWx1ZTogdHJ1ZSxcclxuICAgICAgfSk7XHJcblxyXG4gICAgICBSZWZsZWN0LnNldFByb3RvdHlwZU9mKFxyXG4gICAgICAgIG9iaixcclxuICAgICAgICBuZXcgUHJveHkobmV3UHJvdG8sIHtcclxuICAgICAgICAgIGdldCh0YXJnZXQsIHByb3ApIHtcclxuICAgICAgICAgICAgLy8gXHU1OTgyXHU2NzlDXHU1MzlGXHU1NzhCXHU1QjU4XHU1NzI4XHU1QzVFXHU2MDI3LFx1NTIxOVx1NzZGNFx1NjNBNVx1OEZENFx1NTZERVxyXG4gICAgICAgICAgICBpZiAoUmVmbGVjdC5oYXModGFyZ2V0LCBwcm9wKSkgcmV0dXJuIFJlZmxlY3QuZ2V0KHRhcmdldCwgcHJvcCk7XHJcbiAgICAgICAgICAgIC8vIFx1NTcyOFx1NTM5Rlx1NTc4Qlx1ODNCN1x1NTNENlx1NUM1RVx1NjAyN1x1NjVGNixcdTZERkJcdTUyQTBcdThEREZcdThFMkFcdTVCRjlcdThDNjFcclxuICAgICAgICAgICAgaWYgKHR5cGVvZiBwcm9wICE9PSAnc3RyaW5nJykgcmV0dXJuIHVuZGVmaW5lZDtcclxuXHJcbiAgICAgICAgICAgIC8vIFx1OERERlx1OEUyQVx1NUM1RVx1NjAyN1x1OEMwM1x1NzUyOFxyXG4gICAgICAgICAgICBfdGhpcy5fdHJhY2VPYmplY3RQcm9wKG9iaiwgcHJvcCk7XHJcblxyXG4gICAgICAgICAgICByZXR1cm4gdW5kZWZpbmVkO1xyXG4gICAgICAgICAgfSxcclxuXHJcbiAgICAgICAgICBzZXQodGFyZ2V0LCBwcm9wLCB2YWx1ZSwgcmVjZWl2ZXIpIHtcclxuICAgICAgICAgICAgLy8gXHU1OTgyXHU2NzlDXHU1MzlGXHU1NzhCXHU1QjU4XHU1NzI4XHU1QzVFXHU2MDI3LFx1NTIxOVx1NzZGNFx1NjNBNVx1OEZENFx1NTZERVxyXG4gICAgICAgICAgICBpZiAoUmVmbGVjdC5oYXModGFyZ2V0LCBwcm9wKSkgcmV0dXJuIFJlZmxlY3Quc2V0KHRhcmdldCwgcHJvcCwgdmFsdWUsIHJlY2VpdmVyKTtcclxuICAgICAgICAgICAgaWYgKHR5cGVvZiBwcm9wICE9PSAnc3RyaW5nJykge1xyXG4gICAgICAgICAgICAgIC8vIFx1OTc1RVx1NUI1N1x1N0IyNlx1NEUzMlx1NUJGOVx1OEM2MVx1RkYwQ1x1NTcyOFx1NTM5Rlx1NTlDQlx1NUJGOVx1OEM2MVx1NEUwQVx1NzZGNFx1NjNBNVx1OEJCRVx1N0Y2RVx1NjVCMFx1NUM1RVx1NjAyN1xyXG4gICAgICAgICAgICAgIFJlZmxlY3QuZGVmaW5lUHJvcGVydHkob2JqLCBwcm9wLCB7IHZhbHVlLCB3cml0YWJsZTogdHJ1ZSwgZW51bWVyYWJsZTogdHJ1ZSwgY29uZmlndXJhYmxlOiB0cnVlIH0pO1xyXG4gICAgICAgICAgICAgIHJldHVybiB0cnVlO1xyXG4gICAgICAgICAgICB9XHJcblxyXG4gICAgICAgICAgICBsb2cuaW5mbygnT2JqZWN0TmV3UHJvcCcsIG9iaiwgcHJvcCwgdmFsdWUpO1xyXG5cclxuICAgICAgICAgICAgbGV0IG9sZFZhbHVlID0gUmVmbGVjdC5nZXQob2JqLCBwcm9wKTtcclxuXHJcbiAgICAgICAgICAgIC8vIFx1OEJCRVx1N0Y2RVx1NjVCMFx1NUM1RVx1NjAyNyxcdTVDMDZcdTY1QjBcdTVDNUVcdTYwMjdcdThCQkVcdTdGNkVcdTUyMzBcdTUzOUZcdTU5Q0JcdTVCRjlcdThDNjFcdTRFMkQsXHU1RTc2XHU1NDJGXHU1MkE4XHU4RERGXHU4RTJBXHU1NDhDXHU4OUU2XHU1M0QxXHU1M0Q4XHU2NkY0XHU5MDFBXHU3N0U1XHJcbiAgICAgICAgICAgIFJlZmxlY3QuZGVmaW5lUHJvcGVydHkob2JqLCBwcm9wLCB7XHJcbiAgICAgICAgICAgICAgdmFsdWU6IF90aGlzLl9tYWtlT2JzZXJ2ZXIodmFsdWUpLFxyXG4gICAgICAgICAgICAgIHdyaXRhYmxlOiB0cnVlLFxyXG4gICAgICAgICAgICAgIGVudW1lcmFibGU6IHRydWUsXHJcbiAgICAgICAgICAgICAgY29uZmlndXJhYmxlOiB0cnVlLFxyXG4gICAgICAgICAgICB9KTtcclxuXHJcbiAgICAgICAgICAgIC8vIFx1NTIxQlx1NUVGQWdldC9zZXRcdTUxRkRcdTY1NzBcdTRFRTVcdThGREJcdTg4NENcdThEREZcdThFMkFcclxuICAgICAgICAgICAgX3RoaXMuX21ha2VPYmplY3RQcm9wR2V0U2V0KG9iaiwgcHJvcCk7XHJcblxyXG4gICAgICAgICAgICAvLyBcdTkwMUFcdTc3RTVcdTVDNUVcdTYwMjdcdTUzRDFcdTc1MUZcdTUzRDhcdTY2RjRcclxuICAgICAgICAgICAgX3RoaXMuX25vdGljZVByb3BDaGFuZ2VkKG9iaiwgcHJvcCk7XHJcbiAgICAgICAgICAgIC8vIFx1NUY1M1x1NjZGRlx1NjM2Mlx1NUM1RVx1NjAyN1x1NjVGNixcdTU5ODJcdTY3OUNcdTUzOUZcdTVDNUVcdTYwMjdcdTRFM0FcdTVCRjlcdThDNjEsXHU3NTMxXHU0RThFXHU2NTc0XHU0RTJBXHU1QkY5XHU4QzYxXHU4OEFCXHU2NkZGXHU2MzYyLFx1OTcwMFx1ODk4MVx1NkRGMVx1NUVBNlx1OTAxMlx1NUY1Mlx1OTAxQVx1NzdFNVx1NTM5Rlx1NUJGOVx1OEM2MVx1NzY4NFx1NTE2OFx1OTBFOFx1NEY5RFx1OEQ1Nlx1NUJGOVx1OEM2MVxyXG4gICAgICAgICAgICAvLyBcdTVCOUFcdTRFNDlcdTkwMTJcdTVGNTJcdThCQkZcdTk1RUVcdTY1RjZcdTk1RjRcdTYyMzMsXHU5NjMyXHU2QjYyXHU1RkFBXHU3M0FGXHU4QkJGXHU5NUVFXHJcbiAgICAgICAgICAgIGxldCB2aXNpdGVkVGlja3MgPSBuZXcgRGF0ZSgpLmdldFRpbWUoKTtcclxuICAgICAgICAgICAgZnVuY3Rpb24gX2RlZXBOb3RpY2VPYmoob2JqOiBhbnkpIHtcclxuICAgICAgICAgICAgICBpZiAodHlwZW9mIG9iaiAhPT0gJ29iamVjdCcpIHJldHVybjtcclxuXHJcbiAgICAgICAgICAgICAgbGV0IG9iakRlcGVuZGVudHMgPSBvYmpbU3ltT2JqZWN0T2JzZXJ2ZXJdIGFzIFNjb3BlRGVwZW5kZW50cyB8IHVuZGVmaW5lZDtcclxuICAgICAgICAgICAgICBpZiAoIW9iakRlcGVuZGVudHMpIHJldHVybjtcclxuXHJcbiAgICAgICAgICAgICAgLy8gXHU5NjMyXHU2QjYyXHU1RkFBXHU3M0FGXHU5MDREXHU1Mzg2XHJcbiAgICAgICAgICAgICAgaWYgKFJlZmxlY3QuZ2V0KG9iaiwgU3ltT2JqZWN0VmlzaXRUaWNrcykgPT09IHZpc2l0ZWRUaWNrcykgcmV0dXJuO1xyXG5cclxuICAgICAgICAgICAgICBSZWZsZWN0LmRlZmluZVByb3BlcnR5KG9iaiwgU3ltT2JqZWN0VmlzaXRUaWNrcywgeyB2YWx1ZTogdmlzaXRlZFRpY2tzIH0pO1xyXG5cclxuICAgICAgICAgICAgICAvLyBcdTkwMUFcdTc3RTVcdTVCRjlcdThDNjFcdTgxRUFcdThFQUJcdTc2ODRcdTRGOURcdThENTZcclxuICAgICAgICAgICAgICBfdGhpcy5fbm90aWNlU2VsZkNoYW5nZWQob2JqKTtcclxuXHJcbiAgICAgICAgICAgICAgUmVmbGVjdC5vd25LZXlzKG9iaikuZm9yRWFjaCgoaykgPT4ge1xyXG4gICAgICAgICAgICAgICAgaWYgKHR5cGVvZiBrICE9PSAnc3RyaW5nJykgcmV0dXJuO1xyXG4gICAgICAgICAgICAgICAgLy8gXHU5MDFBXHU3N0U1XHU1QkY5XHU4QzYxXHU3Njg0XHU2MjQwXHU2NzA5XHU1QzVFXHU2MDI3XHU1M0QxXHU3NTFGXHU1M0Q4XHU2NkY0XHJcbiAgICAgICAgICAgICAgICBfdGhpcy5fbm90aWNlUHJvcENoYW5nZWQob2JqLCBrKTtcclxuICAgICAgICAgICAgICAgIC8vIFx1OTAxMlx1NUY1Mlx1OTAxQVx1NzdFNVx1NUJGOVx1OEM2MVx1NzY4NFx1NUM1RVx1NjAyN1xyXG4gICAgICAgICAgICAgICAgbGV0IHZhbHVlID0gUmVmbGVjdC5nZXQob2JqLCBrKTtcclxuICAgICAgICAgICAgICAgIF9kZWVwTm90aWNlT2JqKHZhbHVlKTtcclxuICAgICAgICAgICAgICB9KTtcclxuICAgICAgICAgICAgfVxyXG4gICAgICAgICAgICAvLyBcdTkwMUFcdTc3RTVcdTc2RDFcdTYzQTdcdTUzOUZcdTU5Q0JcdTVCRjlcdThDNjFcdTc2ODRcdTUxNjhcdTkwRThcdTRGOURcdThENTZcdTVCRjlcdThDNjFcclxuICAgICAgICAgICAgX2RlZXBOb3RpY2VPYmoob2xkVmFsdWUpO1xyXG5cclxuICAgICAgICAgICAgcmV0dXJuIHRydWU7XHJcbiAgICAgICAgICB9LFxyXG4gICAgICAgICAgLy8gXHU1MjIwXHU5NjY0XHU1QzVFXHU2MDI3XHVGRjBDXHU5NzAwXHU5MDFBXHU3N0U1XHU1RjUzXHU1MjREXHU1QkY5XHU4QzYxXHU4MUVBXHU4RUFCXHU3Njg0XHU0RjlEXHU4RDU2XHJcbiAgICAgICAgICBkZWxldGVQcm9wZXJ0eSh0YXJnZXQsIHApIHtcclxuICAgICAgICAgICAgbG9nLmluZm8oJ2RlbGV0ZVByb3BlcnR5Jywgb2JqLCBwKTtcclxuICAgICAgICAgICAgLy8gXHU1MjIwXHU5NjY0XHU1QkY5XHU4QzYxXHJcbiAgICAgICAgICAgIGRlbGV0ZSBvYmpbcF07XHJcbiAgICAgICAgICAgIGlmICh0eXBlb2YgcCAhPT0gJ3N0cmluZycpIHJldHVybiB0cnVlO1xyXG4gICAgICAgICAgICAvLyBcdTZERkJcdTUyQTBcdTVDNUVcdTYwMjdcdTc2ODRcdTUzRDhcdTY2RjRcdTkwMUFcdTc3RTVcclxuICAgICAgICAgICAgX3RoaXMuX25vdGljZVByb3BDaGFuZ2VkKG9iaiwgcCk7XHJcbiAgICAgICAgICAgIC8vIFx1NkRGQlx1NTJBMFx1NUY1M1x1NTI0RFx1NUJGOVx1OEM2MVx1NzY4NFx1NTNEOFx1NjZGNFx1OTAxQVx1NzdFNVxyXG4gICAgICAgICAgICBfdGhpcy5fbm90aWNlU2VsZkNoYW5nZWQob2JqKTtcclxuXHJcbiAgICAgICAgICAgIHJldHVybiB0cnVlO1xyXG4gICAgICAgICAgfSxcclxuICAgICAgICB9KVxyXG4gICAgICApO1xyXG4gICAgfVxyXG5cclxuICAgIC8vIFx1NEUzQW9ialx1NTIxQlx1NUVGQVx1NEVFM1x1NzQwNlx1NUJGOVx1OEM2MSxcdTc2RDFcdTYzQTdkZWxldGVQcm9wZXJ0eVx1NTJBOFx1NEY1Q1xyXG4gICAgLy8gXHU2Q0U4XHU2MTBGOiBcdTZCNjRcdTc2RDFcdTYzQTdcdTg4NENcdTRFM0FcdTY1RTBcdTZDRDVcdTc2RDFcdTYzQTdcdTUyMzBcdTVCRjlcdThDNjFcdTUxODVcdTkwRThcdTRGN0ZcdTc1Mjh0aGlzXHU1QkY5XHU4QzYxXHU3Njg0ZGVsZXRlXHU2NENEXHU0RjVDXHJcblxyXG4gICAgcmV0dXJuIG5ldyBQcm94eShvYmosIHtcclxuICAgICAgZGVsZXRlUHJvcGVydHkodGFyZ2V0LCBwKSB7XHJcbiAgICAgICAgbG9nLmluZm8oJ2RlbGV0ZVByb3BlcnR5JywgdGFyZ2V0LCBwKTtcclxuICAgICAgICAvLyBcdTUyMjBcdTk2NjRcdTVCRjlcdThDNjFcclxuICAgICAgICBSZWZsZWN0LmRlbGV0ZVByb3BlcnR5KHRhcmdldCwgcCk7XHJcbiAgICAgICAgaWYgKHR5cGVvZiBwICE9PSAnc3RyaW5nJykgcmV0dXJuIHRydWU7XHJcbiAgICAgICAgLy8gXHU2REZCXHU1MkEwXHU1QzVFXHU2MDI3XHU3Njg0XHU1M0Q4XHU2NkY0XHU5MDFBXHU3N0U1XHJcbiAgICAgICAgX3RoaXMuX25vdGljZVByb3BDaGFuZ2VkKHRhcmdldCwgcCk7XHJcbiAgICAgICAgLy8gXHU2REZCXHU1MkEwXHU1RjUzXHU1MjREXHU1QkY5XHU4QzYxXHU3Njg0XHU1M0Q4XHU2NkY0XHU5MDFBXHU3N0U1XHJcbiAgICAgICAgX3RoaXMuX25vdGljZVNlbGZDaGFuZ2VkKHRhcmdldCk7XHJcblxyXG4gICAgICAgIHJldHVybiB0cnVlO1xyXG4gICAgICB9LFxyXG4gICAgfSk7XHJcbiAgfVxyXG4gIHByaXZhdGUgX21ha2VPYnNlcnZlckFycmF5KGFycjogYW55W10pOiBhbnkge1xyXG4gICAgbGV0IF90aGlzID0gdGhpcztcclxuICAgIC8vIFx1NTIxQlx1NUVGQVx1NjU3MFx1N0VDNFx1ODlDMlx1NUJERlx1NUJGOVx1OEM2MVxyXG4gICAgcmV0dXJuIG5ldyBQcm94eShhcnIsIHtcclxuICAgICAgZ2V0KHRhcmdldCwgcHJvcCkge1xyXG4gICAgICAgIGxldCB2ID0gUmVmbGVjdC5nZXQodGFyZ2V0LCBwcm9wKTtcclxuICAgICAgICBpZiAodHlwZW9mIHByb3AgIT0gJ3N0cmluZycpIHJldHVybiB2O1xyXG4gICAgICAgIGlmICh0eXBlb2YgdiA9PT0gJ2Z1bmN0aW9uJykge1xyXG4gICAgICAgICAgLy8gXHU1OTA0XHU3NDA2XHU2NTcwXHU3RUM0XHU2MjEwXHU1NDU4XHU1MUZEXHU2NTcwXHJcbiAgICAgICAgICBpZiAocHJvcCA9PT0gJ3B1c2gnKSB7XHJcbiAgICAgICAgICAgIHJldHVybiAoLi4uYXJnczogYW55W10pID0+IHtcclxuICAgICAgICAgICAgICBsZXQgcmV0ID0gUmVmbGVjdC5hcHBseSh2LCB0YXJnZXQsIGFyZ3MpO1xyXG4gICAgICAgICAgICAgIC8vIFx1OTAxQVx1NzdFNVx1NjU3MFx1N0VDNFx1ODFFQVx1OEVBQlx1NTNEOFx1NjZGNFxyXG4gICAgICAgICAgICAgIF90aGlzLl9ub3RpY2VTZWxmQ2hhbmdlZCh0YXJnZXQpO1xyXG4gICAgICAgICAgICAgIC8vIFx1OERERlx1OEUyQVx1NjVCMFx1NTg5RVx1NTJBMFx1NzY4NFx1NjU3MFx1N0VDNFx1NjIxMFx1NTQ1OFxyXG4gICAgICAgICAgICAgIGZvciAobGV0IGkgPSAwOyBpIDwgYXJncy5sZW5ndGg7IGkrKykge1xyXG4gICAgICAgICAgICAgICAgX3RoaXMuX3RyYWNlT2JqZWN0UHJvcCh0YXJnZXQsICh0YXJnZXQubGVuZ3RoIC0gYXJncy5sZW5ndGggKyBpKS50b1N0cmluZygpKTtcclxuICAgICAgICAgICAgICB9XHJcbiAgICAgICAgICAgICAgcmV0dXJuIHJldDtcclxuICAgICAgICAgICAgfTtcclxuICAgICAgICAgIH0gZWxzZSBpZiAocHJvcCA9PT0gJ3BvcCcpIHtcclxuICAgICAgICAgICAgcmV0dXJuICgpID0+IHtcclxuICAgICAgICAgICAgICBsZXQgcmV0ID0gUmVmbGVjdC5hcHBseSh2LCB0YXJnZXQsIFtdKTtcclxuICAgICAgICAgICAgICAvLyBcdTkwMUFcdTc3RTVcdTVGMzlcdTUxRkFcdTc2ODRcdTY1NzBcdTdFQzRcdTYyMTBcdTU0NThcdTUzRDhcdTY2RjRcclxuICAgICAgICAgICAgICBfdGhpcy5fbm90aWNlUHJvcENoYW5nZWQodGFyZ2V0LCAodGFyZ2V0Lmxlbmd0aCAtIDEpLnRvU3RyaW5nKCkpO1xyXG5cclxuICAgICAgICAgICAgICAvLyBcdTkwMUFcdTc3RTVcdTY1NzBcdTdFQzRcdTgxRUFcdThFQUJcdTUzRDhcdTY2RjRcclxuICAgICAgICAgICAgICBfdGhpcy5fbm90aWNlU2VsZkNoYW5nZWQodGFyZ2V0KTtcclxuICAgICAgICAgICAgICByZXR1cm4gcmV0O1xyXG4gICAgICAgICAgICB9O1xyXG4gICAgICAgICAgfSBlbHNlIGlmIChwcm9wID09PSAnc2hpZnQnKSB7XHJcbiAgICAgICAgICAgIHJldHVybiAoKSA9PiB7XHJcbiAgICAgICAgICAgICAgLy8gXHU2MjQwXHU2NzA5XHU3M0IwXHU2NzA5XHU2MjEwXHU1NDU4XHU5NzAwXHU4OTgxXHU5MDFBXHU3N0U1XHU1M0Q4XHU2NkY0XHJcbiAgICAgICAgICAgICAgZm9yIChsZXQgaSA9IDA7IGkgPCB0YXJnZXQubGVuZ3RoOyBpKyspIHtcclxuICAgICAgICAgICAgICAgIF90aGlzLl9ub3RpY2VQcm9wQ2hhbmdlZCh0YXJnZXQsIGkudG9TdHJpbmcoKSk7XHJcbiAgICAgICAgICAgICAgfVxyXG5cclxuICAgICAgICAgICAgICBsZXQgcmV0ID0gUmVmbGVjdC5hcHBseSh2LCB0YXJnZXQsIFtdKTtcclxuICAgICAgICAgICAgICAvLyBcdTkwMUFcdTc3RTVcdTY1NzBcdTdFQzRcdTgxRUFcdThFQUJcdTUzRDhcdTY2RjRcclxuICAgICAgICAgICAgICBfdGhpcy5fbm90aWNlU2VsZkNoYW5nZWQodGFyZ2V0KTtcclxuICAgICAgICAgICAgICByZXR1cm4gcmV0O1xyXG4gICAgICAgICAgICB9O1xyXG4gICAgICAgICAgfSBlbHNlIGlmIChwcm9wID09PSAndW5zaGlmdCcpIHtcclxuICAgICAgICAgICAgcmV0dXJuICguLi5hcmdzOiBhbnlbXSkgPT4ge1xyXG4gICAgICAgICAgICAgIGxldCByZXQgPSBSZWZsZWN0LmFwcGx5KHYsIHRhcmdldCwgYXJncyk7XHJcbiAgICAgICAgICAgICAgLy8gXHU5MDFBXHU3N0U1XHU2NTcwXHU3RUM0XHU4MUVBXHU4RUFCXHU1M0Q4XHU2NkY0XHJcbiAgICAgICAgICAgICAgX3RoaXMuX25vdGljZVNlbGZDaGFuZ2VkKHRhcmdldCk7XHJcbiAgICAgICAgICAgICAgLy8gXHU2MjQwXHU2NzA5XHU3M0IwXHU2NzA5XHU2MjEwXHU1NDU4XHU5NzAwXHU4OTgxXHU5MDFBXHU3N0U1XHU1M0Q4XHU2NkY0XHJcbiAgICAgICAgICAgICAgZm9yIChsZXQgaSA9IDA7IGkgPCB0YXJnZXQubGVuZ3RoOyBpKyspIHtcclxuICAgICAgICAgICAgICAgIF90aGlzLl9ub3RpY2VQcm9wQ2hhbmdlZCh0YXJnZXQsIGkudG9TdHJpbmcoKSk7XHJcbiAgICAgICAgICAgICAgfVxyXG4gICAgICAgICAgICAgIHJldHVybiByZXQ7XHJcbiAgICAgICAgICAgIH07XHJcbiAgICAgICAgICB9IGVsc2UgaWYgKHByb3AgPT09ICdzcGxpY2UnKSB7XHJcbiAgICAgICAgICAgIHJldHVybiAoLi4uYXJnczogYW55W10pID0+IHtcclxuICAgICAgICAgICAgICAvLyBzcGxpY2VcdTY0Q0RcdTRGNUMsXHU0RUM1XHU5MDFBXHU3N0U1XHU1M0Q4XHU1MzE2XHU3Njg0XHU1MTQzXHU3RDIwXHU1NDhDXHU4MUVBXHU4RUFCXHJcbiAgICAgICAgICAgICAgbGV0IHJldCA9IFJlZmxlY3QuYXBwbHkodiwgdGFyZ2V0LCBhcmdzKTtcclxuICAgICAgICAgICAgICBsZXQgc3RhcnQgPSBhcmdzWzBdO1xyXG4gICAgICAgICAgICAgIGlmIChzdGFydCA8IDApIHN0YXJ0ID0gdGFyZ2V0Lmxlbmd0aCArIHN0YXJ0O1xyXG4gICAgICAgICAgICAgIGxldCBkZWxldGVDb3VudCA9IGFyZ3NbMV07XHJcbiAgICAgICAgICAgICAgaWYgKGRlbGV0ZUNvdW50IDwgMCkgZGVsZXRlQ291bnQgPSAwO1xyXG4gICAgICAgICAgICAgIGxldCBhZGRDb3VudCA9IGFyZ3MubGVuZ3RoIC0gMjtcclxuICAgICAgICAgICAgICBpZiAoYWRkQ291bnQgPCAwKSBhZGRDb3VudCA9IDA7XHJcbiAgICAgICAgICAgICAgbGV0IGNoYW5nZWRDb3VudCA9IE1hdGgubWF4KGRlbGV0ZUNvdW50LCBhZGRDb3VudCk7XHJcbiAgICAgICAgICAgICAgLy8gXHU5MDFBXHU3N0U1XHU1M0Q4XHU1MzE2XHU3Njg0XHU1MTQzXHU3RDIwXHJcbiAgICAgICAgICAgICAgZm9yIChsZXQgaSA9IDA7IGkgPCBjaGFuZ2VkQ291bnQ7IGkrKykge1xyXG4gICAgICAgICAgICAgICAgX3RoaXMuX25vdGljZVByb3BDaGFuZ2VkKHRhcmdldCwgKHN0YXJ0ICsgaSkudG9TdHJpbmcoKSk7XHJcbiAgICAgICAgICAgICAgfVxyXG4gICAgICAgICAgICAgIC8vIFx1OTAxQVx1NzdFNVx1NjU3MFx1N0VDNFx1ODFFQVx1OEVBQlx1NTNEOFx1NjZGNFxyXG4gICAgICAgICAgICAgIF90aGlzLl9ub3RpY2VTZWxmQ2hhbmdlZCh0YXJnZXQpO1xyXG4gICAgICAgICAgICAgIHJldHVybiByZXQ7XHJcbiAgICAgICAgICAgIH07XHJcbiAgICAgICAgICB9IGVsc2UgaWYgKHByb3AgPT09ICdyZXZlcnNlJyB8fCBwcm9wID09PSAnc29ydCcpIHtcclxuICAgICAgICAgICAgcmV0dXJuICguLi5hcmdzOiBhbnlbXSkgPT4ge1xyXG4gICAgICAgICAgICAgIGxldCBvbGRMZW5ndGggPSB0YXJnZXQubGVuZ3RoO1xyXG5cclxuICAgICAgICAgICAgICBsZXQgcmV0ID0gUmVmbGVjdC5hcHBseSh2LCB0YXJnZXQsIGFyZ3MpO1xyXG4gICAgICAgICAgICAgIC8vIFx1OTAxQVx1NzdFNVx1NjU3MFx1N0VDNFx1NTE2OFx1OTBFOFx1NTE0M1x1N0QyMFx1NTNEOFx1NjZGNFxyXG4gICAgICAgICAgICAgIGxldCBjaGFuZ2VkQ291bnQgPSBNYXRoLm1heChvbGRMZW5ndGgsIHRhcmdldC5sZW5ndGgpO1xyXG4gICAgICAgICAgICAgIGZvciAobGV0IGkgPSAwOyBpIDwgY2hhbmdlZENvdW50OyBpKyspIHtcclxuICAgICAgICAgICAgICAgIF90aGlzLl9ub3RpY2VQcm9wQ2hhbmdlZCh0YXJnZXQsIGkudG9TdHJpbmcoKSk7XHJcbiAgICAgICAgICAgICAgfVxyXG4gICAgICAgICAgICAgIC8vIFx1OTAxQVx1NzdFNVx1NjU3MFx1N0VDNFx1ODFFQVx1OEVBQlx1NTNEOFx1NjZGNFxyXG4gICAgICAgICAgICAgIF90aGlzLl9ub3RpY2VTZWxmQ2hhbmdlZCh0YXJnZXQpO1xyXG4gICAgICAgICAgICAgIHJldHVybiByZXQ7XHJcbiAgICAgICAgICAgIH07XHJcbiAgICAgICAgICB9IGVsc2UgaWYgKHByb3AgPT09ICdjb3B5V2l0aGluJykge1xyXG4gICAgICAgICAgICByZXR1cm4gKC4uLmFyZ3M6IGFueVtdKSA9PiB7XHJcbiAgICAgICAgICAgICAgLy8gXHU2ODM5XHU2MzZFXHU1M0MyXHU2NTcwXHU4M0I3XHU1M0Q2XHU1M0Q3XHU1RjcxXHU1NENEXHU3Njg0XHU1MTQzXHU3RDIwXHU5NkM2XHU1NDA4XHJcbiAgICAgICAgICAgICAgbGV0IHRhcmdldEluZGV4ID0gYXJnc1swXTtcclxuICAgICAgICAgICAgICBsZXQgc3RhcnQgPSBhcmdzWzFdO1xyXG4gICAgICAgICAgICAgIGlmIChzdGFydCA8IDApIHN0YXJ0ID0gdGFyZ2V0Lmxlbmd0aCArIHN0YXJ0O1xyXG4gICAgICAgICAgICAgIGxldCBlbmQgPSBhcmdzWzJdO1xyXG4gICAgICAgICAgICAgIGlmIChlbmQgPT09IHVuZGVmaW5lZCkgZW5kID0gdGFyZ2V0Lmxlbmd0aCAtIHN0YXJ0O1xyXG4gICAgICAgICAgICAgIGlmIChlbmQgPCAwKSBlbmQgPSB0YXJnZXQubGVuZ3RoICsgZW5kO1xyXG4gICAgICAgICAgICAgIGxldCBjaGFuZ2VkQ291bnQgPSBNYXRoLm1pbihlbmQgLSBzdGFydCwgdGFyZ2V0Lmxlbmd0aCAtIHRhcmdldEluZGV4KTtcclxuXHJcbiAgICAgICAgICAgICAgbGV0IHJldCA9IFJlZmxlY3QuYXBwbHkodiwgdGFyZ2V0LCBhcmdzKTtcclxuXHJcbiAgICAgICAgICAgICAgLy8gXHU5MDFBXHU3N0U1XHU1M0Q4XHU1MzE2XHU3Njg0XHU1MTQzXHU3RDIwXHJcbiAgICAgICAgICAgICAgZm9yIChsZXQgaSA9IDA7IGkgPCBjaGFuZ2VkQ291bnQ7IGkrKykge1xyXG4gICAgICAgICAgICAgICAgX3RoaXMuX25vdGljZVByb3BDaGFuZ2VkKHRhcmdldCwgKHRhcmdldEluZGV4ICsgaSkudG9TdHJpbmcoKSk7XHJcbiAgICAgICAgICAgICAgfVxyXG5cclxuICAgICAgICAgICAgICAvLyBcdTkwMUFcdTc3RTVcdTY1NzBcdTdFQzRcdTgxRUFcdThFQUJcdTUzRDhcdTY2RjRcclxuICAgICAgICAgICAgICBfdGhpcy5fbm90aWNlU2VsZkNoYW5nZWQodGFyZ2V0KTtcclxuICAgICAgICAgICAgICByZXR1cm4gcmV0O1xyXG4gICAgICAgICAgICB9O1xyXG4gICAgICAgICAgfSBlbHNlIGlmIChwcm9wID09PSAnZmlsbCcpIHtcclxuICAgICAgICAgICAgcmV0dXJuICguLi5hcmdzOiBhbnlbXSkgPT4ge1xyXG4gICAgICAgICAgICAgIGxldCB0YXJnZXRJbmRleCA9IGFyZ3NbMV07XHJcbiAgICAgICAgICAgICAgbGV0IGVuZCA9IGFyZ3NbMl07XHJcbiAgICAgICAgICAgICAgaWYgKGVuZCA9PT0gdW5kZWZpbmVkKSBlbmQgPSB0YXJnZXQubGVuZ3RoO1xyXG4gICAgICAgICAgICAgIGlmIChlbmQgPCAwKSBlbmQgPSB0YXJnZXQubGVuZ3RoICsgZW5kO1xyXG4gICAgICAgICAgICAgIGxldCBjaGFuZ2VkQ291bnQgPSBNYXRoLm1pbihlbmQgLSB0YXJnZXRJbmRleCwgdGFyZ2V0Lmxlbmd0aCAtIHRhcmdldEluZGV4KTtcclxuXHJcbiAgICAgICAgICAgICAgbGV0IHJldCA9IFJlZmxlY3QuYXBwbHkodiwgdGFyZ2V0LCBhcmdzKTtcclxuXHJcbiAgICAgICAgICAgICAgLy8gXHU5MDFBXHU3N0U1XHU1M0Q4XHU1MzE2XHU3Njg0XHU1MTQzXHU3RDIwXHJcbiAgICAgICAgICAgICAgZm9yIChsZXQgaSA9IDA7IGkgPCBjaGFuZ2VkQ291bnQ7IGkrKykge1xyXG4gICAgICAgICAgICAgICAgX3RoaXMuX25vdGljZVByb3BDaGFuZ2VkKHRhcmdldCwgKHRhcmdldEluZGV4ICsgaSkudG9TdHJpbmcoKSk7XHJcbiAgICAgICAgICAgICAgfVxyXG5cclxuICAgICAgICAgICAgICAvLyBcdTkwMUFcdTc3RTVcdTY1NzBcdTdFQzRcdTgxRUFcdThFQUJcdTUzRDhcdTY2RjRcclxuICAgICAgICAgICAgICBfdGhpcy5fbm90aWNlU2VsZkNoYW5nZWQodGFyZ2V0KTtcclxuICAgICAgICAgICAgICByZXR1cm4gcmV0O1xyXG4gICAgICAgICAgICB9O1xyXG4gICAgICAgICAgfSBlbHNlIHtcclxuICAgICAgICAgICAgLy8gXHU4RERGXHU4RTJBXHU1MUZEXHU2NTcwXHU1NDBEXHU2MzA3XHU1QjlBXHU3Njg0XHU1QzVFXHU2MDI3LFx1NUU3Nlx1NTcyOFx1ODhBQlx1OEMwM1x1NzUyOFx1NjVGNlx1OTAxQVx1NzdFNVx1NUM1RVx1NjAyN1x1NTNEOFx1NTMxNlx1OTAxQVx1NzdFNVx1NEVFNVx1ODNCN1x1NTNENlx1NjcwMFx1NjVCMFx1NTAzQ1xyXG4gICAgICAgICAgICBfdGhpcy5fdHJhY2VPYmplY3RQcm9wKHRhcmdldCwgcHJvcC50b1N0cmluZygpKTtcclxuXHJcbiAgICAgICAgICAgIHJldHVybiAoLi4uYXJnczogYW55W10pID0+IHtcclxuICAgICAgICAgICAgICBsZXQgcmV0ID0gUmVmbGVjdC5hcHBseSh2LCB0YXJnZXQsIGFyZ3MpO1xyXG4gICAgICAgICAgICAgIF90aGlzLl9ub3RpY2VQcm9wQ2hhbmdlZCh0YXJnZXQsIHByb3AudG9TdHJpbmcoKSk7XHJcbiAgICAgICAgICAgICAgcmV0dXJuIHJldDtcclxuICAgICAgICAgICAgfTtcclxuICAgICAgICAgIH1cclxuICAgICAgICB9XHJcbiAgICAgICAgLy8gXHU1OTA0XHU3NDA2XHU2NTcwXHU3RUM0XHU2MjEwXHU1NDU4XHU1QzVFXHU2MDI3XHJcbiAgICAgICAgX3RoaXMuX3RyYWNlT2JqZWN0UHJvcChhcnIsIHByb3AudG9TdHJpbmcoKSk7XHJcbiAgICAgICAgaWYgKHByb3AgPT09ICdsZW5ndGgnKSB7XHJcbiAgICAgICAgICBfdGhpcy5fdHJhY2VPYmplY3RTZWxmKGFycik7XHJcbiAgICAgICAgfVxyXG5cclxuICAgICAgICByZXR1cm4gdjtcclxuICAgICAgfSxcclxuICAgICAgc2V0KHRhcmdldCwgcHJvcCwgdmFsdWUpIHtcclxuICAgICAgICBfdGhpcy5fbm90aWNlUHJvcENoYW5nZWQodGFyZ2V0LCBwcm9wLnRvU3RyaW5nKCkpO1xyXG5cclxuICAgICAgICByZXR1cm4gUmVmbGVjdC5zZXQoYXJyLCBwcm9wLCBfdGhpcy5fbWFrZU9ic2VydmVyKHZhbHVlKSk7XHJcbiAgICAgIH0sXHJcbiAgICB9KTtcclxuXHJcbiAgICByZXR1cm4gYXJyO1xyXG4gIH1cclxuICBwcml2YXRlIF9tYWtlT2JzZXJ2ZXJNYXAobWFwOiBNYXA8YW55LCBhbnk+KTogYW55IHtcclxuICAgIGxldCBfdGhpcyA9IHRoaXM7XHJcbiAgICByZXR1cm4gbmV3IFByb3h5KG1hcCwge1xyXG4gICAgICBnZXQodGFyZ2V0LCBwcm9wKSB7XHJcbiAgICAgICAgbGV0IHYgPSBSZWZsZWN0LmdldCh0YXJnZXQsIHByb3ApO1xyXG4gICAgICAgIGlmICh0eXBlb2YgcHJvcCAhPT0gJ3N0cmluZycpIHJldHVybiB2O1xyXG4gICAgICAgIGlmICh0eXBlb2YgdiA9PT0gJ2Z1bmN0aW9uJykge1xyXG4gICAgICAgICAgLy8gXHU1OTA0XHU3NDA2TWFwXHU3Njg0XHU1MUZEXHU2NTcwXHJcbiAgICAgICAgICBpZiAocHJvcCA9PT0gJ3NldCcpIHtcclxuICAgICAgICAgICAgcmV0dXJuIChrZXk6IGFueSwgdmFsdWU6IGFueSkgPT4ge1xyXG4gICAgICAgICAgICAgIGxvZy5pbmZvKCdjYWxsIG1hcC5zZXQoKScsIG1hcCwga2V5LCB2YWx1ZSk7XHJcbiAgICAgICAgICAgICAgaWYgKCFtYXAuaGFzKGtleSkpIHtcclxuICAgICAgICAgICAgICAgIC8vIFx1ODFFQVx1OEVBQlx1NTZERVx1OEMwM1x1NUMwNlx1ODlFNlx1NTNEMWZvclx1NUZBQVx1NzNBRixcdTYyNDBcdTRFRTVcdTU3MjhcdTZCNjRcdTU5MDRcdTkwMUFcdTc3RTVcdTgxRUFcdThFQUJcdTUzRDhcdTY2RjRcclxuICAgICAgICAgICAgICAgIF90aGlzLl9ub3RpY2VTZWxmQ2hhbmdlZCh0YXJnZXQpO1xyXG4gICAgICAgICAgICAgIH1cclxuXHJcbiAgICAgICAgICAgICAgbGV0IHJldCA9IFJlZmxlY3QuYXBwbHkodiwgdGFyZ2V0LCBba2V5LCBfdGhpcy5fbWFrZU9ic2VydmVyKHZhbHVlKV0pO1xyXG4gICAgICAgICAgICAgIF90aGlzLl9ub3RpY2VQcm9wQ2hhbmdlZCh0YXJnZXQsIGtleS50b1N0cmluZygpKTtcclxuICAgICAgICAgICAgICByZXR1cm4gcmV0O1xyXG4gICAgICAgICAgICB9O1xyXG4gICAgICAgICAgfSBlbHNlIGlmIChwcm9wID09PSAnZGVsZXRlJykge1xyXG4gICAgICAgICAgICBsb2cuaW5mbygnY2FsbCBtYXAuZGVsZXRlKCknLCBtYXAsIHByb3ApO1xyXG4gICAgICAgICAgICByZXR1cm4gKGtleTogYW55KSA9PiB7XHJcbiAgICAgICAgICAgICAgbGV0IHJldCA9IFJlZmxlY3QuYXBwbHkodiwgdGFyZ2V0LCBba2V5XSk7XHJcbiAgICAgICAgICAgICAgX3RoaXMuX25vdGljZVByb3BDaGFuZ2VkKHRhcmdldCwga2V5LnRvU3RyaW5nKCkpO1xyXG4gICAgICAgICAgICAgIF90aGlzLl9ub3RpY2VTZWxmQ2hhbmdlZCh0YXJnZXQpO1xyXG4gICAgICAgICAgICAgIHJldHVybiByZXQ7XHJcbiAgICAgICAgICAgIH07XHJcbiAgICAgICAgICB9IGVsc2UgaWYgKHByb3AgPT09ICdjbGVhcicpIHtcclxuICAgICAgICAgICAgbG9nLmluZm8oJ2NhbGwgbWFwLmNsZWFyKCknLCBtYXAsIHByb3ApO1xyXG4gICAgICAgICAgICByZXR1cm4gKCkgPT4ge1xyXG4gICAgICAgICAgICAgIC8vIFx1ODlFNlx1NTNEMVx1NjI0MFx1NjcwOVx1NUI1MFx1OTg3OVx1NTNEOFx1NjZGNFxyXG4gICAgICAgICAgICAgIG1hcC5mb3JFYWNoKCh2LCBrKSA9PiB7XHJcbiAgICAgICAgICAgICAgICBfdGhpcy5fbm90aWNlUHJvcENoYW5nZWQodGFyZ2V0LCBrLnRvU3RyaW5nKCkpO1xyXG4gICAgICAgICAgICAgIH0pO1xyXG4gICAgICAgICAgICAgIGxldCByZXQgPSBSZWZsZWN0LmFwcGx5KHYsIHRhcmdldCwgW10pO1xyXG4gICAgICAgICAgICAgIF90aGlzLl9ub3RpY2VTZWxmQ2hhbmdlZCh0YXJnZXQpO1xyXG4gICAgICAgICAgICAgIHJldHVybiByZXQ7XHJcbiAgICAgICAgICAgIH07XHJcbiAgICAgICAgICB9IGVsc2UgaWYgKHByb3AgPT09ICdnZXQnKSB7XHJcbiAgICAgICAgICAgIHJldHVybiAoa2V5OiBhbnkpID0+IHtcclxuICAgICAgICAgICAgICBfdGhpcy5fdHJhY2VPYmplY3RQcm9wKHRhcmdldCwga2V5LnRvU3RyaW5nKCkpO1xyXG4gICAgICAgICAgICAgIGxldCByZXQgPSBSZWZsZWN0LmFwcGx5KHYsIHRhcmdldCwgW2tleV0pO1xyXG4gICAgICAgICAgICAgIHJldHVybiByZXQ7XHJcbiAgICAgICAgICAgIH07XHJcbiAgICAgICAgICB9IGVsc2Uge1xyXG4gICAgICAgICAgICBsb2cuaW5mbygnY2FsbCBtYXAgZnVuY3Rpb24nLCBtYXAsIHByb3ApO1xyXG4gICAgICAgICAgICAvLyBcdThEREZcdThFMkFcdTUxRkRcdTY1NzBcdTU0MERcdTYzMDdcdTVCOUFcdTc2ODRcdTVDNUVcdTYwMjcsXHU1RTc2XHU1NzI4XHU4OEFCXHU4QzAzXHU3NTI4XHU2NUY2XHU5MDFBXHU3N0U1XHU1QzVFXHU2MDI3XHU1M0Q4XHU1MzE2XHU5MDFBXHU3N0U1XHU0RUU1XHU4M0I3XHU1M0Q2XHU2NzAwXHU2NUIwXHU1MDNDXHJcblxyXG4gICAgICAgICAgICByZXR1cm4gKC4uLmFyZ3M6IGFueVtdKSA9PiB7XHJcbiAgICAgICAgICAgICAgbGV0IHJldCA9IFJlZmxlY3QuYXBwbHkodiwgdGFyZ2V0LCBhcmdzKTtcclxuICAgICAgICAgICAgICBfdGhpcy5fbm90aWNlUHJvcENoYW5nZWQodGFyZ2V0LCBwcm9wLnRvU3RyaW5nKCkpO1xyXG4gICAgICAgICAgICAgIHJldHVybiByZXQ7XHJcbiAgICAgICAgICAgIH07XHJcbiAgICAgICAgICB9XHJcbiAgICAgICAgfVxyXG4gICAgICAgIC8vIFx1NTkwNFx1NzQwNk1hcFx1NzY4NFx1NUM1RVx1NjAyN1xyXG4gICAgICAgIF90aGlzLl90cmFjZU9iamVjdFByb3AobWFwLCBwcm9wLnRvU3RyaW5nKCkpO1xyXG4gICAgICAgIGlmIChwcm9wID09PSAnc2l6ZScpIHtcclxuICAgICAgICAgIF90aGlzLl90cmFjZU9iamVjdFNlbGYobWFwKTtcclxuICAgICAgICB9XHJcbiAgICAgICAgcmV0dXJuIHY7XHJcbiAgICAgIH0sXHJcbiAgICAgIHNldCh0YXJnZXQsIHByb3AsIHZhbHVlKSB7XHJcbiAgICAgICAgbG9nLmluZm8oJ3NldCBtYXAgcHJvcCcsIHRhcmdldCwgcHJvcCwgdmFsdWUpO1xyXG4gICAgICAgIC8vIFx1NTk4Mlx1Njc5Q1x1NjVCMFx1NTg5RSxcdTUyMTlcdTkwMUFcdTc3RTVcdTgxRUFcdThFQUJcdTUzRDhcdTY2RjRcclxuICAgICAgICBpZiAoIXRhcmdldC5oYXMocHJvcCkpIHtcclxuICAgICAgICAgIF90aGlzLl9ub3RpY2VTZWxmQ2hhbmdlZCh0YXJnZXQpO1xyXG4gICAgICAgIH1cclxuXHJcbiAgICAgICAgX3RoaXMuX25vdGljZVByb3BDaGFuZ2VkKHRhcmdldCwgcHJvcC50b1N0cmluZygpKTtcclxuXHJcbiAgICAgICAgcmV0dXJuIFJlZmxlY3Quc2V0KG1hcCwgcHJvcCwgX3RoaXMuX21ha2VPYnNlcnZlcih2YWx1ZSkpO1xyXG4gICAgICB9LFxyXG4gICAgfSk7XHJcbiAgfVxyXG4gIHByaXZhdGUgX21ha2VPYnNlcnZlclNldChzZXQ6IFNldDxhbnk+KTogYW55IHtcclxuICAgIGxldCBfdGhpcyA9IHRoaXM7XHJcbiAgICByZXR1cm4gbmV3IFByb3h5KHNldCwge1xyXG4gICAgICBnZXQodGFyZ2V0LCBwcm9wKSB7XHJcbiAgICAgICAgbGV0IHYgPSBSZWZsZWN0LmdldCh0YXJnZXQsIHByb3ApO1xyXG4gICAgICAgIGlmICh0eXBlb2YgcHJvcCAhPT0gJ3N0cmluZycpIHJldHVybiB2O1xyXG4gICAgICAgIGlmICh0eXBlb2YgdiA9PT0gJ2Z1bmN0aW9uJykge1xyXG4gICAgICAgICAgLy8gXHU1OTA0XHU3NDA2U2V0XHU3Njg0XHU1MUZEXHU2NTcwXHJcbiAgICAgICAgICBpZiAocHJvcCA9PT0gJ2FkZCcpIHtcclxuICAgICAgICAgICAgcmV0dXJuICh2YWx1ZTogYW55KSA9PiB7XHJcbiAgICAgICAgICAgICAgbG9nLmluZm8oJ2NhbGwgc2V0LmFkZCgpJywgc2V0LCB2YWx1ZSk7XHJcbiAgICAgICAgICAgICAgaWYgKCFzZXQuaGFzKHZhbHVlKSkge1xyXG4gICAgICAgICAgICAgICAgLy8gXHU4MUVBXHU4RUFCXHU1NkRFXHU4QzAzXHU1QzA2XHU4OUU2XHU1M0QxZm9yXHU1RkFBXHU3M0FGLFx1NjI0MFx1NEVFNVx1NTcyOFx1NkI2NFx1NTkwNFx1OTAxQVx1NzdFNVx1ODFFQVx1OEVBQlx1NTNEOFx1NjZGNFxyXG4gICAgICAgICAgICAgICAgX3RoaXMuX25vdGljZVNlbGZDaGFuZ2VkKHRhcmdldCk7XHJcbiAgICAgICAgICAgICAgfVxyXG5cclxuICAgICAgICAgICAgICBsZXQgcmV0ID0gUmVmbGVjdC5hcHBseSh2LCB0YXJnZXQsIFtfdGhpcy5fbWFrZU9ic2VydmVyKHZhbHVlKV0pO1xyXG4gICAgICAgICAgICAgIF90aGlzLl9ub3RpY2VQcm9wQ2hhbmdlZCh0YXJnZXQsIHZhbHVlLnRvU3RyaW5nKCkpO1xyXG4gICAgICAgICAgICAgIHJldHVybiByZXQ7XHJcbiAgICAgICAgICAgIH07XHJcbiAgICAgICAgICB9IGVsc2UgaWYgKHByb3AgPT09ICdkZWxldGUnKSB7XHJcbiAgICAgICAgICAgIGxvZy5pbmZvKCdjYWxsIHNldC5kZWxldGUoKScsIHNldCwgcHJvcCk7XHJcbiAgICAgICAgICAgIHJldHVybiAodmFsdWU6IGFueSkgPT4ge1xyXG4gICAgICAgICAgICAgIGxldCByZXQgPSBSZWZsZWN0LmFwcGx5KHYsIHRhcmdldCwgW3ZhbHVlXSk7XHJcbiAgICAgICAgICAgICAgX3RoaXMuX25vdGljZVByb3BDaGFuZ2VkKHRhcmdldCwgdmFsdWUudG9TdHJpbmcoKSk7XHJcbiAgICAgICAgICAgICAgX3RoaXMuX25vdGljZVNlbGZDaGFuZ2VkKHRhcmdldCk7XHJcbiAgICAgICAgICAgICAgcmV0dXJuIHJldDtcclxuICAgICAgICAgICAgfTtcclxuICAgICAgICAgIH0gZWxzZSBpZiAocHJvcCA9PT0gJ2NsZWFyJykge1xyXG4gICAgICAgICAgICBsb2cuaW5mbygnY2FsbCBzZXQuY2xlYXIoKScsIHNldCwgcHJvcCk7XHJcbiAgICAgICAgICAgIHJldHVybiAoKSA9PiB7XHJcbiAgICAgICAgICAgICAgLy8gXHU4OUU2XHU1M0QxXHU2MjQwXHU2NzA5XHU1QjUwXHU5ODc5XHU1M0Q4XHU2NkY0XHJcbiAgICAgICAgICAgICAgc2V0LmZvckVhY2goKHYpID0+IHtcclxuICAgICAgICAgICAgICAgIF90aGlzLl9ub3RpY2VQcm9wQ2hhbmdlZCh0YXJnZXQsIHYudG9TdHJpbmcoKSk7XHJcbiAgICAgICAgICAgICAgfSk7XHJcbiAgICAgICAgICAgICAgbGV0IHJldCA9IFJlZmxlY3QuYXBwbHkodiwgdGFyZ2V0LCBbXSk7XHJcbiAgICAgICAgICAgICAgX3RoaXMuX25vdGljZVNlbGZDaGFuZ2VkKHRhcmdldCk7XHJcbiAgICAgICAgICAgICAgcmV0dXJuIHJldDtcclxuICAgICAgICAgICAgfTtcclxuICAgICAgICAgIH0gZWxzZSBpZiAocHJvcCA9PT0gJ2hhcycpIHtcclxuICAgICAgICAgICAgcmV0dXJuICh2YWx1ZTogYW55KSA9PiB7XHJcbiAgICAgICAgICAgICAgX3RoaXMuX3RyYWNlT2JqZWN0UHJvcCh0YXJnZXQsIHZhbHVlLnRvU3RyaW5nKCkpO1xyXG4gICAgICAgICAgICAgIGxldCByZXQgPSBSZWZsZWN0LmFwcGx5KHYsIHRhcmdldCwgW3ZhbHVlXSk7XHJcbiAgICAgICAgICAgICAgcmV0dXJuIHJldDtcclxuICAgICAgICAgICAgfTtcclxuICAgICAgICAgIH0gZWxzZSB7XHJcbiAgICAgICAgICAgIGxvZy5pbmZvKCdjYWxsIHNldCBmdW5jdGlvbicsIHNldCwgcHJvcCk7XHJcbiAgICAgICAgICAgIC8vIFx1OERERlx1OEUyQVx1NTFGRFx1NjU3MFx1NTQwRFx1NjMwN1x1NUI5QVx1NzY4NFx1NUM1RVx1NjAyNyxcdTVFNzZcdTU3MjhcdTg4QUJcdThDMDNcdTc1MjhcdTY1RjZcdTkwMUFcdTc3RTVcdTVDNUVcdTYwMjdcdTUzRDhcdTUzMTZcdTkwMUFcdTc3RTVcdTRFRTVcdTgzQjdcdTUzRDZcdTY3MDBcdTY1QjBcdTUwM0NcclxuXHJcbiAgICAgICAgICAgIHJldHVybiAoLi4uYXJnczogYW55W10pID0+IHtcclxuICAgICAgICAgICAgICBsZXQgcmV0ID0gUmVmbGVjdC5hcHBseSh2LCB0YXJnZXQsIGFyZ3MpO1xyXG4gICAgICAgICAgICAgIF90aGlzLl9ub3RpY2VQcm9wQ2hhbmdlZCh0YXJnZXQsIHByb3AudG9TdHJpbmcoKSk7XHJcbiAgICAgICAgICAgICAgcmV0dXJuIHJldDtcclxuICAgICAgICAgICAgfTtcclxuICAgICAgICAgIH1cclxuICAgICAgICB9XHJcbiAgICAgICAgLy8gXHU1OTA0XHU3NDA2U2V0XHU3Njg0XHU1QzVFXHU2MDI3XHJcbiAgICAgICAgX3RoaXMuX3RyYWNlT2JqZWN0UHJvcChzZXQsIHByb3AudG9TdHJpbmcoKSk7XHJcbiAgICAgICAgaWYgKHByb3AgPT09ICdzaXplJykge1xyXG4gICAgICAgICAgX3RoaXMuX3RyYWNlT2JqZWN0U2VsZihzZXQpO1xyXG4gICAgICAgIH1cclxuICAgICAgICByZXR1cm4gdjtcclxuICAgICAgfSxcclxuICAgIH0pO1xyXG4gIH1cclxuXHJcbiAgcHJpdmF0ZSBfaXNXZWJXb3JrZXJOYXRpdmVPYmplY3Qob2JqOiBhbnkpOiBib29sZWFuIHtcclxuICAgIHJldHVybiBSZWZsZWN0LmhhcyhvYmosIFN5bVdvcmtlck5hdGl2ZU9iamVjdCk7XHJcbiAgfVxyXG5cclxuICAvLyBcdTVDMDZcdTRFMDBcdTRFMkFcdTVCRjlcdThDNjFcdTUyMURcdTU5Q0JcdTUzMTZcdTRFM0FcdTUzRUZcdTg5QzJcdTZENEJcdTVCRjlcdThDNjEsXHU2QjY0XHU2NUY2XHU1QkY5XHU4QzYxXHU3Njg0XHU1QzVFXHU2MDI3XHU1M0Q4XHU1MzE2XHU0RjFBXHU4OEFCXHU4RERGXHU4RTJBXHJcbiAgcHJpdmF0ZSBfbWFrZU9ic2VydmVyKG9iajogYW55KTogYW55IHtcclxuICAgIGlmICh0eXBlb2Ygb2JqICE9PSAnb2JqZWN0JyB8fCBvYmogPT09IG51bGwpIHJldHVybiBvYmo7XHJcbiAgICBpZiAodGhpcy5faXNXZWJXb3JrZXJOYXRpdmVPYmplY3Qob2JqKSkgcmV0dXJuIG9iajtcclxuICAgIGlmIChSZWZsZWN0LmdldE93blByb3BlcnR5RGVzY3JpcHRvcihvYmosIFN5bU9iamVjdE9ic2VydmVyKSkgcmV0dXJuIG9iajtcclxuICAgIC8vIHJldHVybiBvYmo7XHJcbiAgICAvLyBcdTVCOUFcdTRFNDlcdTg5QzJcdTVCREZcdTVCRjlcdThDNjFcclxuICAgIFJlZmxlY3QuZGVmaW5lUHJvcGVydHkob2JqLCBTeW1PYmplY3RPYnNlcnZlciwge1xyXG4gICAgICB2YWx1ZTogbmV3IFNjb3BlRGVwZW5kZW50cyh0aGlzLl9zY29wZU5hbWUpLFxyXG4gICAgICB3cml0YWJsZTogZmFsc2UsXHJcbiAgICAgIGVudW1lcmFibGU6IGZhbHNlLFxyXG4gICAgfSk7XHJcbiAgICAvLyBcdTVCOUFcdTRFNDlcdTVCRjlcdThDNjFcdTVDNUVcdTYwMjdcdTUyMURcdTU5Q0JcdTUzMTZcdTYzQ0ZcdThGRjBcclxuICAgIFJlZmxlY3QuZGVmaW5lUHJvcGVydHkob2JqLCBTeW1PYmplY3RJbml0UHJvcERlc2MsIHtcclxuICAgICAgdmFsdWU6IHt9LFxyXG4gICAgICB3cml0YWJsZTogZmFsc2UsXHJcbiAgICAgIGVudW1lcmFibGU6IGZhbHNlLFxyXG4gICAgfSk7XHJcblxyXG4gICAgaWYgKG9iaiBpbnN0YW5jZW9mIEFycmF5KSB7XHJcbiAgICAgIC8vIFx1NTIxQlx1NUVGQVx1NjU3MFx1N0VDNFx1ODlDMlx1NUJERlx1NUJGOVx1OEM2MVxyXG4gICAgICByZXR1cm4gdGhpcy5fbWFrZU9ic2VydmVyQXJyYXkob2JqKTtcclxuICAgIH0gZWxzZSBpZiAob2JqIGluc3RhbmNlb2YgTWFwKSB7XHJcbiAgICAgIHJldHVybiB0aGlzLl9tYWtlT2JzZXJ2ZXJNYXAob2JqKTtcclxuICAgIH0gZWxzZSBpZiAob2JqIGluc3RhbmNlb2YgU2V0KSB7XHJcbiAgICAgIHJldHVybiB0aGlzLl9tYWtlT2JzZXJ2ZXJTZXQob2JqKTtcclxuICAgIH0gZWxzZSB7XHJcbiAgICAgIHJldHVybiB0aGlzLl9tYWtlT2JzZXJ2ZXJPYmplY3Qob2JqKTtcclxuICAgIH1cclxuICB9XHJcblxyXG4gIC8vIC8vIFx1NjQxQ1x1OTZDNlx1NEY1Q1x1NzUyOFx1NTdERlx1NUJGOVx1OEM2MVx1NzY4NFx1NjI0MFx1NjcwOVx1NUM1RVx1NjAyNyxcdTVFNzZcdTc1MUZcdTYyMTBcdTYyNjdcdTg4NENcdTUxRkRcdTY1NzBcclxuICAvLyBwcml2YXRlIF9zY29wZU1lbWJlcnNEZWVwKCk6IHN0cmluZ1tdIHtcclxuICAvLyAgIGxldCBtZW1iZXJzID0gbmV3IFNldDxzdHJpbmc+KCk7XHJcbiAgLy8gICBsZXQgd29ya1Njb3BlOiBXb3JrZXJTY29wZSB8IHVuZGVmaW5lZCA9IHRoaXM7XHJcbiAgLy8gICB3aGlsZSAod29ya1Njb3BlKSB7XHJcbiAgLy8gICAgIGNvbnN0IGtleXMgPSBSZWZsZWN0Lm93bktleXMod29ya1Njb3BlLnNjb3BlKS5maWx0ZXIoKGspID0+IHR5cGVvZiBrID09PSAnc3RyaW5nJyk7XHJcbiAgLy8gICAgIGtleXMuZm9yRWFjaCgoaykgPT4gbWVtYmVycy5hZGQoay50b1N0cmluZygpKSk7XHJcbiAgLy8gICAgIHdvcmtTY29wZSA9IHdvcmtTY29wZS5fcGFyZW50U2NvcGU7XHJcbiAgLy8gICB9XHJcbiAgLy8gICByZXR1cm4gQXJyYXkuZnJvbShtZW1iZXJzKTtcclxuICAvLyB9XHJcblxyXG4gIC8vIC8vIFx1NTIxQlx1NUVGQVx1NEUwMFx1NEUyQVx1NTFGRFx1NjU3MCxcdTc1MjhcdTRFOEVcdTYyNjdcdTg4NENcdTg4NjhcdThGQkVcdTVGMEZcclxuICAvLyAvLyBcdTg4NjhcdThGQkVcdTVGMEZcdTRFMkRcdTc2ODRcdTUzRDhcdTkxQ0ZcdTRGMUFcdTg4QUJcdThGNkNcdTYzNjJcdTRFM0FcdTVDNDBcdTkwRThcdTUzRDhcdTkxQ0ZcclxuICAvLyAvLyBcdTg4NjhcdThGQkVcdTVGMEZcdTRFMkRcdTc2ODRcdTUzRDhcdTkxQ0ZcdTY1NzBcdTkxQ0ZcdTUzRDFcdTc1MUZcdTUzRDhcdTUzMTZcdTY1RjYsXHU0RjFBXHU5MUNEXHU2NUIwXHU3NTFGXHU2MjEwXHU1MUZEXHU2NTcwXHJcbiAgLy8gc2NvcGVkRnVuY3Rpb25GYWN0b3J5KGV4cHI6IHN0cmluZykge1xyXG4gIC8vICAgbGV0IF9zY29wZWRWZXJzaW9uID0gKHRoaXMgYXMgYW55KVtTeW1TY29wZVZlcmlzb25dO1xyXG4gIC8vICAgLy8gXHU1QzA2XHU0RjVDXHU3NTI4XHU1N0RGXHU1QkY5XHU4QzYxXHU3Njg0XHU1QzVFXHU2MDI3XHU4RjZDXHU2MzYyXHU0RTNBXHU1QzQwXHU5MEU4XHU1M0Q4XHU5MUNGLFx1NTMwNVx1NjJFQ1x1NzIzNlx1N0VBN1x1NEY1Q1x1NzUyOFx1NTdERlxyXG4gIC8vICAgbGV0IHNjb3BlZEZ1bmN0aW9uOiBGdW5jdGlvbjtcclxuICAvLyAgIGxldCBzY29wZWRNZW1iZXJzID0gW10gYXMgYW55W107XHJcbiAgLy8gICByZXR1cm4gKCkgPT4ge1xyXG4gIC8vICAgICBpZiAoIXNjb3BlZEZ1bmN0aW9uIHx8IF9zY29wZWRWZXJzaW9uICE9PSAodGhpcyBhcyBhbnkpW1N5bVNjb3BlVmVyaXNvbl0pIHtcclxuICAvLyAgICAgICAvLyBcdTUyMUJcdTVFRkFcdTY1QjBcdTUxRkRcdTY1NzAsXHU1RTc2XHU0RkREXHU1QjU4XHU3MjQ4XHU2NzJDXHU1M0Y3XHJcbiAgLy8gICAgICAgc2NvcGVkTWVtYmVycyA9IHRoaXMuX3Njb3BlTWVtYmVyc0RlZXAoKTtcclxuICAvLyAgICAgICAvLyBcdTUyMUJcdTVFRkFcdTVGMDJcdTZCNjVcdTYyNjdcdTg4NENcdTUxRkRcdTY1NzBcclxuICAvLyAgICAgICB0cnkge1xyXG4gIC8vICAgICAgICAgc2NvcGVkRnVuY3Rpb24gPSBuZXcgRnVuY3Rpb24oLi4uc2NvcGVkTWVtYmVycywgYHJldHVybiAke2V4cHJ9O2ApIGFzIGFueTtcclxuICAvLyAgICAgICAgIGxvZy5kZWJ1ZygnbmV3IHNjb3BlZEZ1bmN0aW9uJywgZXhwciwgc2NvcGVkTWVtYmVycyk7XHJcbiAgLy8gICAgICAgfSBjYXRjaCAoZSkge1xyXG4gIC8vICAgICAgICAgc2NvcGVkRnVuY3Rpb24gPSBuZXcgRnVuY3Rpb24oLi4uc2NvcGVkTWVtYmVycywgXCJyZXR1cm4gJydcIikgYXMgYW55O1xyXG4gIC8vICAgICAgICAgbG9nLmVycm9yKCduZXcgc2NvcGVkRnVuY3Rpb24gZXJyb3InLCBleHByLCBzY29wZWRNZW1iZXJzLCBlKTtcclxuICAvLyAgICAgICB9XHJcbiAgLy8gICAgICAgX3Njb3BlZFZlcnNpb24gPSAodGhpcyBhcyBhbnkpW1N5bVNjb3BlVmVyaXNvbl07XHJcbiAgLy8gICAgIH1cclxuXHJcbiAgLy8gICAgIGxldCB2YWx1ZXMgPSBzY29wZWRNZW1iZXJzLm1hcCgoaykgPT4gdGhpcy5fc2NvcGVba10pO1xyXG4gIC8vICAgICByZXR1cm4gc2NvcGVkRnVuY3Rpb24uYXBwbHkodGhpcy5fc2NvcGUsIHZhbHVlcyk7XHJcbiAgLy8gICB9O1xyXG4gIC8vIH1cclxuICAvLyBcdTYyNjdcdTg4NENcdTRFMDBcdTRFMkFcdTg4NjhcdThGQkVcdTVGMEZcdTUxRkRcdTY1NzAsXHU4RERGXHU4RTJBXHU4ODY4XHU4RkJFXHU1RjBGXHU2MjY3XHU4ODRDXHU4RkM3XHU3QTBCXHU0RTJEXHU3Njg0XHU0RjlEXHU4RDU2XHU1MTczXHU3Q0ZCLFx1NUY1M1x1NEY5RFx1OEQ1Nlx1NzY4NFx1NUJGOVx1OEM2MVx1NTNEMVx1NzUxRlx1NTNEOFx1NTMxNlx1NjVGNixcdTkwMUFcdTc3RTVcdTRGOURcdThENTZcdTc2ODRcdTVCRjlcdThDNjFcdTU5MDRcdTc0MDZcdTUzRDhcdTY2RjRcclxuICAvLyBcdTg4NjhcdThGQkVcdTVGMEZcdTY1MkZcdTYzMDFcdTVGMDJcdTZCNjVcdTVCRjlcdThDNjFcclxuICAvLyAkd2F0Y2g8VD4oZnVuYzogKCkgPT4gVCwgbGlzdGVuZXI6IChvbGQ6IFQsIGNvbXB1dGU6ICgpID0+IFQpID0+IFQpOiBUIHtcclxuICAvLyAgIGNvbnN0IGVyciA9IG5ldyBFcnJvcigpO1xyXG5cclxuICAvLyAgIHJldHVybiB7fSBhcyBUO1xyXG4gIC8vIH1cclxuXHJcbiAgLy8gcHJpdmF0ZSBfbWtQcm94eTxUIGV4dGVuZHMgb2JqZWN0PihvYmo6IFQpOiBUIHtcclxuICAvLyAgICAgY29uc3QgX3RoaXMgPSB0aGlzXHJcbiAgLy8gICAgIC8vIFx1NEUwRFx1NjYyRlx1NUJGOVx1OEM2MVx1NTIxOVx1OEZENFx1NTZERVxyXG4gIC8vICAgICBpZiAodHlwZW9mIG9iaiAhPT0gJ29iamVjdCcgfHwgb2JqID09PSBudWxsKSByZXR1cm4gb2JqO1xyXG4gIC8vICAgICBpZiAoUmVmbGVjdC5nZXRPd25Qcm9wZXJ0eURlc2NyaXB0b3Iob2JqLCBTeW1PYnNlcnZlcikpIHJldHVybiBvYmpcclxuICAvLyAgICAgLy8gXHU1QjlBXHU0RTQ5XHU4OUMyXHU1QkRGXHU1QkY5XHU4QzYxXHJcbiAgLy8gICAgIE9iamVjdC5kZWZpbmVQcm9wZXJ0eShvYmosIFN5bU9ic2VydmVyLCB7XHJcbiAgLy8gICAgICAgICB2YWx1ZToge1xyXG4gIC8vICAgICAgICAgICAgICRkZXBzOiBuZXcgU2V0PHN0cmluZz4oKSwvLyBcdTRGOURcdThENTZcdTVCRjlcdThDNjFcdTk2QzZcdTU0MDgsXHU1RjUzXHU4MUVBXHU4RUFCXHU1M0QxXHU3NTFGXHU2NTM5XHU1M0Q4XHU2NUY2LFx1OTAxQVx1NzdFNVx1NEY5RFx1OEQ1Nlx1NUJGOVx1OEM2MVx1NTNEOFx1NTMxNlxyXG4gIC8vICAgICAgICAgfVxyXG4gIC8vICAgICB9KTtcclxuXHJcbiAgLy8gICAgIHJldHVybiBuZXcgUHJveHkob2JqIGFzIGFueSwge1xyXG4gIC8vICAgICAgICAgZ2V0KHRhcmdldCwgcHJvcCkge1xyXG4gIC8vICAgICAgICAgfSxcclxuICAvLyAgICAgICAgIHNldCh0YXJnZXQsIHByb3AsIHZhbHVlKSB7XHJcbiAgLy8gICAgICAgICAgICAgLy8gXHU1OTgyXHU2NzlDdmFsdWVcdTRFM0FcdTVCRjlcdThDNjEsXHU1MjE5XHU5MDEyXHU1RjUyXHU3NTFGXHU2MjEwXHU0RUUzXHU3NDA2XHU1QkY5XHU4QzYxXHJcbiAgLy8gICAgICAgICAgICAgdGFyZ2V0W3Byb3BdID0gX3RoaXMuX21rUHJveHkodmFsdWUpO1xyXG4gIC8vICAgICAgICAgICAgIHJldHVybiB0cnVlXHJcbiAgLy8gICAgICAgICB9XHJcbiAgLy8gICAgIH0pXHJcbiAgLy8gfVxyXG59XHJcblxyXG4vLyBleHBvcnQgY2xhc3MgV2F0Y2hlckNsYXNzIHtcclxuLy8gICAgIGNvbnN0cnVjdG9yKCkge1xyXG4vLyAgICAgICAgIHJldHVybiBtYWtlUHJveHkodGhpcyk7XHJcbi8vICAgICB9XHJcbi8vIH1cclxuLy8gZXhwb3J0IGZ1bmN0aW9uIHdhdGNoT2JqZWN0PFQgZXh0ZW5kcyB7fT4ob2JqOiBUKTogVCB7XHJcbi8vICAgICByZXR1cm4gbWFrZVByb3h5KG9iailcclxuLy8gfVxyXG5cclxuZXhwb3J0IGNvbnN0IHdvcmtlck9ic2VydmVyID0gbmV3IChjbGFzcyBXb3JrZXJPYnNlcnZlciB7XHJcbiAgLyoqXHJcbiAgICogXHU1MjFCXHU1RUZBXHU0RTAwXHU0RTJBXHU1M0VGXHU4OUMyXHU2RDRCXHU1QkY5XHU4QzYxLFx1NTcyOFx1NUJGOVx1OEM2MVx1NzY4NFx1NUM1RVx1NjAyN1x1NTNEMVx1NzUxRlx1NTNEOFx1NTMxNlx1NjVGNixcdTkwMUFcdTc3RTVcdTRGOURcdThENTZcdTc2ODRcdTVCRjlcdThDNjFcdTU5MDRcdTc0MDZcdTUzRDhcdTY2RjRcclxuICAgKiBAcGFyYW0gdGFyZ2V0XHJcbiAgICogQHBhcmFtIHByb3BcclxuICAgKi9cclxuICBvYnNlcnZlKHRhcmdldDogeyBbazogc3RyaW5nXTogYW55IH0pIHt9XHJcblxyXG4gIC8vIFx1NzUxRlx1NjIxMFx1NEVFM1x1NzQwNlx1NUJGOVx1OEM2MVxyXG4gIG1ha2VQcm94eShvYmo6IGFueSkge1xyXG4gICAgY29uc3QgX3RoaXMgPSB0aGlzO1xyXG4gICAgaWYgKFJlZmxlY3QuZ2V0T3duUHJvcGVydHlEZXNjcmlwdG9yKG9iaiwgU3ltT2JqZWN0T2JzZXJ2ZXIpKSByZXR1cm4gb2JqO1xyXG4gICAgUmVmbGVjdC5kZWZpbmVQcm9wZXJ0eShvYmosIFN5bU9iamVjdE9ic2VydmVyLCB7XHJcbiAgICAgIHZhbHVlOiB7XHJcbiAgICAgICAgLy8gXHU0RjlEXHU4RDU2XHU3Njg0U2V0XHU5NkM2XHU1NDA4XHVGRjBDXHU1MzczXHU1RjUzXHU4MUVBXHU4RUFCXHU1M0QxXHU3NTFGXHU1M0Q4XHU1MzE2XHU2NUY2LFx1NTNFRlx1ODBGRFx1NEYxQVx1NUY3MVx1NTRDRFx1NTIzMFx1NzY4NFx1NTE3Nlx1NEVENlx1NUJGOVx1OEM2MVxyXG4gICAgICAgIGRlcHM6IG5ldyBTZXQ8c3RyaW5nPigpLFxyXG4gICAgICB9LFxyXG4gICAgfSk7XHJcbiAgICBjb25zb2xlLmxvZygnbWFrZVByb3h5Jywgb2JqKTtcclxuICAgIHJldHVybiBuZXcgUHJveHkob2JqLCB7XHJcbiAgICAgIGdldCh0YXJnZXQsIHByb3ApIHtcclxuICAgICAgICBjb25zdCB2YWx1ZSA9IHRhcmdldFtwcm9wXTtcclxuICAgICAgICBpZiAodHlwZW9mIHZhbHVlICE9PSAnb2JqZWN0JyB8fCB2YWx1ZSA9PT0gbnVsbCB8fCBSZWZsZWN0LmdldE93blByb3BlcnR5RGVzY3JpcHRvcih2YWx1ZSwgU3ltT2JqZWN0T2JzZXJ2ZXIpKSB7XHJcbiAgICAgICAgICByZXR1cm4gdmFsdWU7XHJcbiAgICAgICAgfVxyXG4gICAgICAgIHRhcmdldFtwcm9wXSA9IF90aGlzLm1ha2VQcm94eSh2YWx1ZSk7XHJcbiAgICAgICAgcmV0dXJuIHRhcmdldFtwcm9wXTtcclxuICAgICAgfSxcclxuICAgICAgc2V0KHRhcmdldCwgcHJvcCwgdmFsdWUpIHtcclxuICAgICAgICBpZiAodGFyZ2V0W3Byb3BdID09PSB2YWx1ZSkgcmV0dXJuIHRydWU7XHJcbiAgICAgICAgaWYgKHR5cGVvZiB2YWx1ZSAhPT0gJ29iamVjdCcgfHwgdmFsdWUgPT09IG51bGwgfHwgUmVmbGVjdC5nZXRPd25Qcm9wZXJ0eURlc2NyaXB0b3IodmFsdWUsIFN5bU9iamVjdE9ic2VydmVyKSkge1xyXG4gICAgICAgICAgdGFyZ2V0W3Byb3BdID0gdmFsdWU7XHJcbiAgICAgICAgICByZXR1cm4gdHJ1ZTtcclxuICAgICAgICB9XHJcbiAgICAgICAgdGFyZ2V0W3Byb3BdID0gX3RoaXMubWFrZVByb3h5KHZhbHVlKTtcclxuICAgICAgICByZXR1cm4gdHJ1ZTtcclxuICAgICAgfSxcclxuICAgIH0pO1xyXG4gIH1cclxufSkoKTtcclxuXHJcbi8vIGNvbnN0IGdsb2JhbFNjb3BlID0gbmV3IFdvcmtlclNjb3BlKCdnbG9iYWxTY29wZScse30sdW5kZWZpbmVkKVxyXG4iLCAiaW1wb3J0IHsgSUVsZW1Kc29uLCBKc1V0aWxzLCBOZXRVdGlscyB9IGZyb20gXCIuLi9jb21tb25cIjtcclxuaW1wb3J0IHsgTG9nZ2VyIH0gZnJvbSBcIi4uL2xvZ2dlclwiO1xyXG5pbXBvcnQgeyBtZXNzYWdlIH0gZnJvbSBcIi4uL21lc3NhZ2VcIjtcclxuaW1wb3J0IHsgd29ya2VyTWV0YSB9IGZyb20gXCIuL3dvcmtlck1ldGFcIjtcclxuaW1wb3J0IHsgV29ya2VyU2NvcGUgfSBmcm9tIFwiLi93b3JrZXJTY29wZVwiO1xyXG5cclxuLy8gV29ya2VyIFx1N0VCRlx1N0EwQlx1NTJBMFx1OEY3RENvbXBvbmVudHNcclxuY29uc3QgbG9nID0gTG9nZ2VyKFwiV09POldvcmtlckNvbXBvbmVudFwiKVxyXG5cclxuY29uc3QgU2VsZkNsb3NlZFRhZ1NldCA9IG5ldyBTZXQoWydpbWcnLCAnaW5wdXQnLCAnYnInLCAnaHInLCAnbWV0YScsICdsaW5rJywgJ2Jhc2UnLCAnYXJlYScsICdjb2wnLCAnY29tbWFuZCcsICdlbWJlZCcsICdrZXlnZW4nLCAncGFyYW0nLCAnc291cmNlJywgJ3RyYWNrJywgJ3diciddKVxyXG5cclxuXHJcbmludGVyZmFjZSBJVHBsRGVzY3JpcHRvciB7XHJcbiAgICByb290RWxlbTogSUVsZW1Kc29uLCByZWxVcmw6IHN0cmluZ1xyXG59XHJcbmNvbnN0IHRwbFJlZ2lzdHJ5ID0gbmV3IGNsYXNzIFRwbFJlZ2lzdHJ5IHtcclxuICAgIHByaXZhdGUgX3RwbFJlZ2lzdHJ5ID0gbmV3IE1hcDxzdHJpbmcsIElUcGxEZXNjcmlwdG9yPigpXHJcblxyXG4gICAgYXN5bmMgZ2V0KHRhZzogc3RyaW5nKTogUHJvbWlzZTxJVHBsRGVzY3JpcHRvcj4ge1xyXG4gICAgICAgIGlmICghdGhpcy5fdHBsUmVnaXN0cnkuaGFzKHRhZykpIHtcclxuICAgICAgICAgICAgbGV0IHJlbFByZWZpeCA9IHdvcmtlck1ldGEudGFnUGF0aFByZWZpeCh0YWcpXHJcbiAgICAgICAgICAgIGxldCB0cGxVcmwgPSByZWxQcmVmaXggKyAnLmh0bWwnXHJcbiAgICAgICAgICAgIGxldCBodG1sID0gYXdhaXQgTmV0VXRpbHMuaHR0cEdldFRleHQodHBsVXJsKVxyXG4gICAgICAgICAgICBsZXQgcmVzdWx0ID0gYXdhaXQgbWVzc2FnZS5zZW5kKCdXOlBhcnNlVHBsJywgeyB0ZXh0OiBodG1sIH0pXHJcbiAgICAgICAgICAgIHRoaXMuX3RwbFJlZ2lzdHJ5LnNldCh0YWcsIHtcclxuICAgICAgICAgICAgICAgIHJvb3RFbGVtOiByZXN1bHQudHBsLFxyXG4gICAgICAgICAgICAgICAgcmVsVXJsOiByZWxQcmVmaXhcclxuICAgICAgICAgICAgfSlcclxuICAgICAgICB9XHJcbiAgICAgICAgcmV0dXJuIHRoaXMuX3RwbFJlZ2lzdHJ5LmdldCh0YWcpITtcclxuICAgIH1cclxufVxyXG5cclxuLy8gY2lkID0+IFdvcmtlckNvbXBvbmVudCBNYXBcclxuZXhwb3J0IGNvbnN0IHdvcmtlckNvbXBvbmVudFJlZ2lzdHJ5ID0gbmV3IE1hcDxzdHJpbmcsIFdvcmtlckNvbXBvbmVudD4oKVxyXG5cclxudHlwZSBJU2NvcGUgPSB7IFtrOiBzdHJpbmddOiBhbnkgfVxyXG5cclxuLyoqXHJcbiAqIFx1NUM1RVx1NjAyN1x1NTkwNFx1NzQwNlx1NzY4NFx1OEJBMVx1N0I5N1x1NkEyMVx1NUYwRjpcclxuICogJGF0dHI6IFx1NTAzQ1x1N0VEMVx1NUI5QSxcdTUxODVcdTVCQjlcdTRFM0FcdThCQTFcdTdCOTdcdTg4NjhcdThGQkVcdTVGMEZcdTc2ODRcdTdFRDNcdTY3OUNcclxuICogOmF0dHI6IFx1NkEyMVx1Njc3Rlx1N0VEMVx1NUI5QSxcdTUxODVcdTVCQjlcdTRFM0FcdTZBMjFcdTY3N0ZcdTVCNTdcdTdCMjZcdTRFMzIsXHU1NzI4Q1NTXHU0RTJEXHU2NTJGXHU2MzAxXCIkXCIgXHU1NDhDICc6JyBcdTg4NjhcdTc5M0FcdTc2ODRcdThCQTFcdTdCOTdcdTZBMjFcdTVGMEYgXHJcbiAqIGF0dHIudHlwZTogXHU3QzdCXHU1NzhCXHU3RUQxXHU1QjlBLFx1NTAzQ1x1NEUzQVx1ODFFQVx1NTJBOFx1OEY2Q1x1NjM2Mlx1NUI1N1x1N0IyNlx1NEUzMlx1NzY4NFx1N0VEM1x1Njc5QyxcdTY1MkZcdTYzMDE6aW50LGZsb2F0LGJvb2wsb2JqZWN0LGFycmF5LG9iaixzdHIsc3RyaW5nXHU3QjQ5XHJcbiAqIGF0dHI6IFx1OUVEOFx1OEJBNFx1NEUzQVx1OTc1OVx1NjAwMVx1NUI1N1x1N0IyNlx1NEUzMlx1N0VEMVx1NUI5QVxyXG4gKi9cclxuY2xhc3MgV0F0dHIge1xyXG4gICAgbmFtZSA9IFwiXCJcclxuICAgIHByaXZhdGUgX2RpcnR5ID0gdHJ1ZVxyXG4gICAgcHJpdmF0ZSBfdmFsdWUgPSAnJyBhcyBhbnlcclxuICAgIHByaXZhdGUgX2NvbXB1dGVGdW5jPzogRnVuY3Rpb25cclxuICAgIGNvbnN0cnVjdG9yKHByaXZhdGUgX2VsZW06IFdFbGVtLCBwcml2YXRlIF90cGxOYW1lOiBzdHJpbmcsIHByaXZhdGUgX3RwbFZhbHVlOiBzdHJpbmcpIHtcclxuICAgICAgICB0cnl7XHJcblxyXG4gICAgICAgICAgICBpZihfdHBsTmFtZS5zdGFydHNXaXRoKCckJykpe1xyXG4gICAgICAgICAgICAgICAgLy8gXHU1MDNDXHU3RUQxXHU1QjlBXHJcbiAgICAgICAgICAgICAgICB0aGlzLl9jb21wdXRlRnVuYyA9ICBuZXcgRnVuY3Rpb24oXCIkc2NvcGVcIiwgXCIkZWxcIiwgYHdpdGgoJHNjb3BlKXtyZXR1cm4gJHtfdHBsVmFsdWV9fWApO1xyXG4gICAgICAgICAgICB9ZWxzZSBpZihfdHBsTmFtZS5zdGFydHNXaXRoKCc6Jykpe1xyXG4gICAgICAgICAgICAgICAgLy8gXHU2QTIxXHU2NzdGXHU3RUQxXHU1QjlBXHJcbiAgICAgICAgICAgICAgICB0aGlzLl9jb21wdXRlRnVuYyA9ICBuZXcgRnVuY3Rpb24oXCIkc2NvcGVcIiwgXCIkZWxcIixgd2l0aCgkc2NvcGUpe3JldHVybiBcXGAke190cGxWYWx1ZX1cXGA7fWApO1xyXG4gICAgICAgICAgICB9ZWxzZSBpZihfdHBsTmFtZS5zdGFydHNXaXRoKCdAJykpe1xyXG4gICAgICAgICAgICAgICAgdGhpcy5fY29tcHV0ZUZ1bmMgPSBuZXcgRnVuY3Rpb24oXCIkc2NvcGVcIiwgXCIkZWxcIiwgXCIkZXZcIiwgYHdpdGgoJHNjb3BlKXske190cGxWYWx1ZX07fWApO1xyXG4gICAgICAgICAgICB9XHJcblxyXG4gICAgICAgIH1jYXRjaChlOmFueSl7XHJcbiAgICAgICAgICAgIGxvZy53YXJuKCdFcnJvciBjcmVhdGUgY29tcHV0ZSBmdW5jdGlvbjonLCBfdHBsTmFtZSwgX3RwbFZhbHVlLCBlLm1lc3NhZ2UpXHJcbiAgICAgICAgfVxyXG5cclxuXHJcbiAgICAgICAgdGhpcy5uYW1lID0gdGhpcy5fY29tcHV0ZUZ1bmMgPyB0aGlzLl90cGxOYW1lLnNsaWNlKDEpIDogX3RwbE5hbWVcclxuICAgICAgICB0aGlzLl92YWx1ZSA9IHRoaXMuX3RwbFZhbHVlXHJcbiAgICAgICAgdGhpcy5fZGlydHkgPSB0aGlzLl9jb21wdXRlRnVuYyA/IHRydWUgOiBmYWxzZVxyXG4gICAgfVxyXG4gICAgLy8gXHU4QkExXHU3Qjk3XHU1QzVFXHU2MDI3XHU1MDNDXHJcbiAgICBwcml2YXRlIF9jb21wdXRlVmFsdWUoKSB7XHJcbiAgICAgICAgaWYgKHRoaXMuX2NvbXB1dGVGdW5jKSB7XHJcbiAgICAgICAgICAgIHRyeSB7XHJcbiAgICAgICAgICAgICAgICBsZXQgcnQgPSB0aGlzLl9jb21wdXRlRnVuYygpXHJcbiAgICAgICAgICAgICAgICB0aGlzLl92YWx1ZSA9IHJ0XHJcblxyXG4gICAgICAgICAgICB9IGNhdGNoIChlOiBhbnkpIHtcclxuICAgICAgICAgICAgICAgIGxvZy5lcnJvcignRXJyb3IgY29tcHV0ZSBhdHRyOicsIHRoaXMuX2VsZW0udGFnLCB0aGlzLl90cGxOYW1lLCB0aGlzLl90cGxWYWx1ZSwgZS5tZXNzYWdlKVxyXG4gICAgICAgICAgICB9XHJcbiAgICAgICAgICAgIHRoaXMuX2RpcnR5ID0gZmFsc2VcclxuICAgICAgICB9IGVsc2Uge1xyXG4gICAgICAgICAgICB0aGlzLl92YWx1ZSA9IHRoaXMuX3RwbFZhbHVlXHJcbiAgICAgICAgICAgIHRoaXMuX2RpcnR5ID0gZmFsc2VcclxuICAgICAgICB9XHJcbiAgICB9XHJcbiAgICBnZXQgdmFsdWUoKSB7XHJcbiAgICAgICAgaWYgKHRoaXMuX2RpcnR5KSB7XHJcbiAgICAgICAgICAgIHRoaXMuX2NvbXB1dGVWYWx1ZSgpXHJcbiAgICAgICAgfVxyXG4gICAgICAgIHJldHVybiB0aGlzLl92YWx1ZVxyXG4gICAgfVxyXG4gICAgZ2V0IGlzRHluYW1pYygpIHtcclxuICAgICAgICByZXR1cm4gIXRoaXMuX2NvbXB1dGVGdW5jXHJcbiAgICB9XHJcbiAgICBzZXRWYWx1ZSh2OiBhbnkpIHtcclxuICAgICAgICBsb2cud2FybihcIj09Pj4+Pz8/PyBzZXRWYWx1ZTogXCIsIHYpXHJcbiAgICAgICAgdGhpcy5fdmFsdWUgPSB2XHJcbiAgICB9XHJcblxyXG4gICAgaW52YWxpZGF0ZSgpIHtcclxuICAgICAgICB0aGlzLl9kaXJ0eSA9IHRydWVcclxuICAgIH1cclxuXHJcbn1cclxuY2xhc3MgV1RleHROb2RlIHtcclxuICAgIHRleHQgPSBcIlRFWFRcIlxyXG4gICAgLyoqXHJcbiAgICAgKiBAcGFyYW0gX3RwbFRleHQgXHU2QTIxXHU2NzdGXHU1QjU3XHU3QjI2XHU0RTMyXHJcbiAgICAgKiBAcGFyYW0gY2FsY01vZGUgXHU4QkExXHU3Qjk3XHU2QTIxXHU1RjBGLFx1NTNENlx1NTAzQyBcIiRcIlx1NjIxNic6JyxcdTRFRTNcdTg4NjhcdTUwM0NcdTdFRDFcdTVCOUFcdTYyMTZcdTgwMDVcdTZBMjFcdTY3N0ZcdTdFRDFcdTVCOUFcclxuICAgICAqL1xyXG4gICAgY29uc3RydWN0b3IocHJpdmF0ZSBfZWxlbTogV0VsZW0sIHByaXZhdGUgX3RwbFRleHQ6IHN0cmluZywgY2FsY01vZGU/OiBzdHJpbmcpIHtcclxuICAgICAgICBpZiAoY2FsY01vZGUgPT0gJyQnKSB7XHJcbiAgICAgICAgfSBlbHNlIGlmIChjYWxjTW9kZSA9PSAnOicpIHtcclxuICAgICAgICB9IGVsc2Uge1xyXG4gICAgICAgICAgICB0aGlzLnRleHQgPSBfdHBsVGV4dFxyXG4gICAgICAgIH1cclxuICAgIH1cclxufVxyXG5cclxuY2xhc3MgV0V2ZW50IHtcclxuICAgIGNvbnN0cnVjdG9yKHByaXZhdGUgX2VsZW06IFdFbGVtLCBwcml2YXRlIF9ldmVudE5hbWU6IHN0cmluZywgcHJpdmF0ZSBfdHBsRXZlbnQ6IHN0cmluZykge1xyXG4gICAgfVxyXG59XHJcblxyXG4vLyBcdTRFMDBcdTZCMjFcdTYwMjdcdTVDMDZcdTUzRDhcdTUyQThcdTUxODVcdTVCQjlcdTU0OENcdTk3MDBcdTg5ODFcdTUzRDhcdTUyQThcdTc2ODRcdTdFQzRcdTRFRjZcdTU0OENcdTdFQzRcdTRFRjZcdTUxODVcdTkwRThcdTY1NzBcdTYzNkVcdTUxNjhcdTkwRThcdThCQTFcdTdCOTcsXHU0RTAwXHU2QjIxXHU2MDI3XHU2NkY0XHU2NUIwXHJcbi8qKlxyXG4gKiBXZWJDb21wb25lbnRcdTUxNDNcdTdEMjAsXHU1OTA0XHU3NDA2V2ViQ29tcG9uZW50XHU1MTQzXHU3RDIwXHU3Njg0XHU1MkEwXHU4RjdEXHU1NDhDXHU2RTMyXHU2N0QzXHJcbiAqIFx1OERERlx1OEUyQVx1NTE0M1x1N0QyMFx1NEY1Q1x1NzUyOFx1NTdERlx1NzY4NFx1NTNEOFx1NTMxNlx1NEY5RFx1OEQ1NixcdTVFNzZcdThCQTFcdTdCOTdcdTRGOURcdThENTZcdTVDNUVcdTYwMjdcdTc2ODRcdTUzRDhcdTUzMTYsXHU2NkY0XHU2NUIwXHU1MTQzXHU3RDIwXHU3Njg0XHU1QzVFXHU2MDI3XHU1NDhDXHU1MTg1XHU1QkI5XHJcbiAqL1xyXG5jbGFzcyBXRWxlbSB7XHJcbiAgICBwcml2YXRlIF90YWc6IHN0cmluZ1xyXG4gICAgcHJpdmF0ZSBfYXR0cnM6IHsgW2s6IHN0cmluZ106IFdBdHRyIH0gPSB7fVxyXG4gICAgcHJpdmF0ZSBfZXZlbnRzOiBXRXZlbnRbXSA9IFtdXHJcbiAgICBwcml2YXRlIF9jaGlsZHJlbjogKFdFbGVtIHwgV1RleHROb2RlKVtdID0gW11cclxuICAgIC8vIFx1NTIxQlx1NUVGQVx1NEY1Q1x1NzUyOFx1NTdERlx1NUJGOVx1OEM2MSxcdTZCQ0ZcdTRFMkFcdTUxNDNcdTdEMjBcdTc2ODRzY29wZVx1NEUyRFx1NEZERFx1NUI1OFx1NTE0M1x1N0QyMFx1NzY4NFx1NTJBOFx1NjAwMVx1NUM1RVx1NjAyNyxcdTRFMERcdTUzMDVcdTYyRUNcdTk3NTlcdTYwMDFcdTVDNUVcdTYwMjdcclxuXHJcbiAgICBwcml2YXRlIF9sb2FkUHJvbWlzZXM6IFByb21pc2U8dm9pZD5bXSA9IFtdXHJcbiAgICBwcml2YXRlIF9jb250ZW50Q2FsY01vZGUgPSAnJ1xyXG5cclxuICAgIHByaXZhdGUgX3Njb3BlOmFueTtcclxuXHJcbiAgICAvLyBcdTRFQ0VFbGVtSnNvblx1Njc4NFx1OTAyMFdFbGVtXHJcbiAgICBjb25zdHJ1Y3Rvcihwcml2YXRlIF9jb21wb25lbnRSb290OiBXb3JrZXJDb21wb25lbnQsIHByaXZhdGUgX3BhcmVudDogV0VsZW0gfCB1bmRlZmluZWQsIHRwbEVsZW06IElFbGVtSnNvbikge1xyXG4gICAgICAgIHRoaXMuX3RhZyA9IHRwbEVsZW0udGFnXHJcblxyXG4gICAgICAgIC8vIFx1NTIxRFx1NTlDQlx1NTMxNnNjb3BlXHJcbiAgICAgICAgdGhpcy5fc2NvcGUgPSBPYmplY3QuY3JlYXRlKF9wYXJlbnQ/Ll9zY29wZSB8fCBfY29tcG9uZW50Um9vdC53b3JrU2NvcGUpXHJcblxyXG4gICAgICAgIC8vIFx1ODlFM1x1Njc5MFx1NTQ4Q1x1NTkwNFx1NzQwNlx1NUM1RVx1NjAyN1xyXG4gICAgICAgIHRoaXMuX2luaXRBdHRycyh0cGxFbGVtKVxyXG5cclxuICAgICAgICAvLyBcdTU5MDRcdTc0MDZcdTVCNTBcdTUxNDNcdTdEMjBcclxuICAgICAgICB0aGlzLl9pbml0Q2hpbGRDb250ZW50KHRwbEVsZW0pXHJcblxyXG4gICAgICAgIC8vIFx1NTJBMFx1OEY3RFx1ODFFQVx1NUI5QVx1NEU0OVx1N0VDNFx1NEVGNlxyXG4gICAgICAgIGlmICh0aGlzLl90YWcuaW5jbHVkZXMoJy0nKSkge1xyXG4gICAgICAgICAgICAvLyBcdTY4QzBcdTZENEJcdTVGNTNcdTUyNERcdTgxRUFcdTVCOUFcdTRFNDlcdTc2ODRcdTdFQzRcdTRFRjZcdTY2MkZcdTU0MjZcdTVERjJcdTdFQ0ZcdTZDRThcdTUxOENcclxuICAgICAgICAgICAgdGhpcy5fbG9hZFByb21pc2VzLnB1c2godGhpcy5fbG9hZFdlYkNvbXBvbmVudEVsZW0oKSlcclxuICAgICAgICB9XHJcbiAgICAgICAgXHJcbiAgICB9XHJcblxyXG5cclxuICAgIHByaXZhdGUgX2luaXRBdHRycyh0cGxFbGVtOiBJRWxlbUpzb24pIHtcclxuICAgICAgICBKc1V0aWxzLm9iamVjdEZvckVhY2godHBsRWxlbS5hdHRycywgKHYsIGspID0+IHtcclxuICAgICAgICAgICAgLy8gXHU2OEMwXHU2RDRCXHU1MTQzXHU3RDIwXHU1MTg1XHU1QkI5XHU4QkExXHU3Qjk3XHU2QTIxXHU1RjBGXHJcbiAgICAgICAgICAgIGlmIChrID09ICckJyB8fCBrID09ICc6Jykge1xyXG4gICAgICAgICAgICAgICAgLy8gXHU1MTg1XHU1QkI5XHU4QkExXHU3Qjk3XHU2QTIxXHU1RjBGXHJcbiAgICAgICAgICAgICAgICB0aGlzLl9jb250ZW50Q2FsY01vZGUgPSBrXHJcbiAgICAgICAgICAgICAgICByZXR1cm5cclxuICAgICAgICAgICAgfVxyXG4gICAgICAgICAgICBsZXQgYXR0ID0gbmV3IFdBdHRyKHRoaXMsIGssIHYpXHJcbiAgICAgICAgICAgIGlmIChhdHQubmFtZSkge1xyXG4gICAgICAgICAgICAgICAgdGhpcy5fYXR0cnNbYXR0Lm5hbWVdID0gYXR0XHJcbiAgICAgICAgICAgICAgICBpZiAoYXR0LmlzRHluYW1pYykge1xyXG4gICAgICAgICAgICAgICAgICAgIC8vIFx1NTJBOFx1NjAwMVx1NUM1RVx1NjAyNyxcdTRFM0FcdTRGNUNcdTc1MjhcdTU3REZcdTZERkJcdTUyQTBnZXRcdTVDNUVcdTYwMjdcclxuICAgICAgICAgICAgICAgICAgICAvLyB0aGlzLl93b3JrU2NvcGUuc2NvcGVbYXR0Lm5hbWVdID0gYXR0LnZhbHVlXHJcbiAgICAgICAgICAgICAgICB9XHJcbiAgICAgICAgICAgIH1cclxuICAgICAgICB9KVxyXG5cclxuICAgICAgICAvLyBcdTY4MzlcdTUxNDNcdTdEMjBcdTRFMERcdThCQkVcdTdGNkVlaWQsXHU1NkUwXHU0RTNBXHU2ODM5XHU1MTQzXHU3RDIwXHU3Njg0ZWlkXHU3NTMxXHU1OTE2XHU5MEU4XHU3RUM0XHU0RUY2XHU1MjA2XHU5MTREXHJcbiAgICAgICAgaWYgKHRoaXMuX3BhcmVudClcclxuICAgICAgICAgICAgdGhpcy5fYXR0cnNbJ19laWQnXSA9IG5ldyBXQXR0cih0aGlzLCAnX2VpZCcsIHRoaXMuX2NvbXBvbmVudFJvb3QubmV3RWlkKHRoaXMpLnRvU3RyaW5nKCkpXHJcbiAgICB9XHJcblxyXG4gICAgcHJpdmF0ZSBfaW5pdENoaWxkQ29udGVudCh0cGxFbGVtOiBJRWxlbUpzb24pIHtcclxuICAgICAgICB0cGxFbGVtLmNoaWxkcmVuLmZvckVhY2goY2hpbGQgPT4ge1xyXG4gICAgICAgICAgICBpZiAodHlwZW9mIGNoaWxkID09PSAnc3RyaW5nJykge1xyXG4gICAgICAgICAgICAgICAgLy8gXHU2NTg3XHU2NzJDXHU4MjgyXHU3MEI5XHJcbiAgICAgICAgICAgICAgICB0aGlzLl9jaGlsZHJlbi5wdXNoKG5ldyBXVGV4dE5vZGUodGhpcywgY2hpbGQsIHRoaXMuX2NvbnRlbnRDYWxjTW9kZSkpXHJcbiAgICAgICAgICAgIH0gZWxzZSB7XHJcbiAgICAgICAgICAgICAgICBsZXQgZWxlbSA9IG5ldyBXRWxlbSh0aGlzLl9jb21wb25lbnRSb290LCB0aGlzLCBjaGlsZClcclxuICAgICAgICAgICAgICAgIHRoaXMuX2NoaWxkcmVuLnB1c2goZWxlbSlcclxuICAgICAgICAgICAgICAgIGlmIChlbGVtLnRhZy5pbmNsdWRlcygnLScpKVxyXG4gICAgICAgICAgICAgICAgICAgIHRoaXMuX2xvYWRQcm9taXNlcy5wdXNoKGVsZW0ud2FpdExvYWQoKSlcclxuICAgICAgICAgICAgfVxyXG4gICAgICAgIH0pXHJcblxyXG4gICAgfVxyXG5cclxuICAgIHByaXZhdGUgYXN5bmMgX2xvYWRXZWJDb21wb25lbnRFbGVtKCkge1xyXG4gICAgICAgIC8vIFx1NjhDMFx1NkQ0Qlx1NjYyRlx1NTQyNlx1N0IyNlx1NTQwOFx1N0VDNFx1NEVGNlx1ODFFQVx1NUI5QVx1NEU0OVx1NjgwN1x1N0I3RVx1ODlDNFx1ODMwM1xyXG4gICAgICAgIC8vIFx1OTk5Nlx1NTE0OFx1NjdFNVx1NjI3RVx1NjYyRlx1NTQyNlx1NURGMlx1N0VDRlx1NkNFOFx1NTE4Q1xyXG4gICAgICAgIC8vIFx1NTk4Mlx1Njc5Q1x1NjcyQVx1NkNFOFx1NTE4Q1x1NTIxOVx1OEJGN1x1NkM0Mlx1NEUzQlx1N0VCRlx1N0EwQlx1Nzg2RVx1NUI5QVx1NjYyRlx1NTQyNlx1ODFFQVx1NUI5QVx1NEU0OVx1N0VDNFx1NEVGNlx1NURGMlx1N0VDRlx1NkNFOFx1NTE4QyhcdTUzRUZcdTgwRkRcdTdCMkNcdTRFMDlcdTY1QjlcdTVERjJcdTdFQ0ZcdTZDRThcdTUxOEMpLFx1NUU3Nlx1NkNFOFx1NTE4Q1x1NTQ4Q1x1NTJBMFx1OEY3RFx1N0VDNFx1NEVGNlxyXG4gICAgICAgIGxldCByZXN1bHQgPSBhd2FpdCBtZXNzYWdlLnNlbmQoJ1c6UmVnaXN0ZXJFbGVtJywgeyByZWxVcmw6IHRoaXMuX2NvbXBvbmVudFJvb3QucmVsVXJsLCB0YWc6IHRoaXMuX3RhZywgYXR0cnM6IEpzVXRpbHMub2JqZWN0TWFwKHRoaXMuX2F0dHJzLCAodiwgaykgPT4geyByZXR1cm4gdi52YWx1ZSB9KSB9KVxyXG4gICAgICAgIC8vIFx1NTk4Mlx1Njc5Q1x1OEZENFx1NTZERVx1RkYwQ1x1NTIxOVx1NEVFM1x1ODg2OFx1ODFFQVx1NUI5QVx1NEU0OVx1NjgwN1x1N0I3RVx1NURGMlx1N0VDRlx1NUI4Q1x1NjIxMFx1NkNFOFx1NTE4Q1x1NTQ4Q1x1NTIxQlx1NUVGQVxyXG4gICAgICAgIGlmIChyZXN1bHQuZWxlbSkge1xyXG4gICAgICAgICAgICB0aGlzLl90YWcgPSByZXN1bHQuZWxlbS50YWdcclxuICAgICAgICAgICAgLy8gXHU2NkY0XHU2NUIwXHU1QzVFXHU2MDI3XHJcbiAgICAgICAgICAgIEpzVXRpbHMub2JqZWN0Rm9yRWFjaChyZXN1bHQuZWxlbS5hdHRycywgKHYsIGspID0+IHtcclxuICAgICAgICAgICAgICAgIGlmICh0aGlzLl9hdHRyc1trXSkge1xyXG4gICAgICAgICAgICAgICAgICAgIHRoaXMuX2F0dHJzW2tdLnNldFZhbHVlKHYpXHJcbiAgICAgICAgICAgICAgICB9IGVsc2Uge1xyXG4gICAgICAgICAgICAgICAgICAgIC8vIFx1NTJBMFx1OEY3RFx1NUI1MFx1N0VDNFx1NEVGNlx1NTNFRlx1ODBGRFx1NEYxQVx1NEVBN1x1NzUxRlx1NjVCMFx1NUM1RVx1NjAyNyxcdTZCNjRcdTVDNUVcdTYwMjdcdTRFMERcdTU3MjhcdTZBMjFcdTY3N0ZcdTVDNUVcdTYwMjdcdTRFMkQsXHU0RkREXHU1QjU4XHU0RTNBXHU2ODA3XHU1MUM2XHU5NzU5XHU2MDAxXHU2QTIxXHU2NzdGXHU1QzVFXHU2MDI3XHJcbiAgICAgICAgICAgICAgICAgICAgdGhpcy5fYXR0cnNba10gPSBuZXcgV0F0dHIodGhpcywgaywgdilcclxuICAgICAgICAgICAgICAgIH1cclxuICAgICAgICAgICAgfSlcclxuICAgICAgICB9XHJcbiAgICB9XHJcblxyXG5cclxuICAgIGdldCB0YWcoKSB7XHJcbiAgICAgICAgcmV0dXJuIHRoaXMuX3RhZ1xyXG4gICAgfVxyXG4gICAgYXN5bmMgd2FpdExvYWQoKSB7XHJcbiAgICAgICAgYXdhaXQgUHJvbWlzZS5hbGwodGhpcy5fbG9hZFByb21pc2VzKVxyXG4gICAgfVxyXG5cclxuICAgIGF0dHJzVmFsdWUoKSB7XHJcbiAgICAgICAgcmV0dXJuIEpzVXRpbHMub2JqZWN0TWFwKHRoaXMuX2F0dHJzLCAodiwgaykgPT4ge1xyXG4gICAgICAgICAgICByZXR1cm4gdi52YWx1ZVxyXG4gICAgICAgIH0pXHJcbiAgICB9XHJcblxyXG4gICAgLy8gXHU3NTFGXHU2MjEwXHU1RjUzXHU1MjREXHU1MTQzXHU3RDIwXHU3Njg0XHU1QjhDXHU2NTc0SFRNTFxyXG4gICAgcmVuZGVyT3V0ZXJIdG1sKG91dFN0cmluZ0J1aWxkZXI6IHN0cmluZ1tdLCBpbmNsdWRlQ2hpbGRzOiBib29sZWFuID0gdHJ1ZSkge1xyXG4gICAgICAgIG91dFN0cmluZ0J1aWxkZXIucHVzaChgPCR7dGhpcy5fdGFnfSBgLFxyXG4gICAgICAgICAgICAuLi5Kc1V0aWxzLm9iamVjdE1hcFRvQXJyYXkodGhpcy5fYXR0cnMsIChhdHRyKSA9PiB7XHJcbiAgICAgICAgICAgICAgICByZXR1cm4gYCR7YXR0ci5uYW1lfT1cIiR7YXR0ci52YWx1ZX1cIiBgXHJcbiAgICAgICAgICAgIH0pLFxyXG4gICAgICAgICAgICAnPicpXHJcbiAgICAgICAgaWYgKGluY2x1ZGVDaGlsZHMpIHRoaXMucmVuZGVySW5uZXJIdG1sKG91dFN0cmluZ0J1aWxkZXIpXHJcbiAgICAgICAgb3V0U3RyaW5nQnVpbGRlci5wdXNoKGA8LyR7dGhpcy5fdGFnfT5gKVxyXG4gICAgfVxyXG4gICAgLy8gXHU3NTFGXHU2MjEwXHU2MjQwXHU2NzA5XHU1QjUwXHU1MTQzXHU3RDIwXHU3Njg0SFRNTFxyXG4gICAgcmVuZGVySW5uZXJIdG1sKG91dFN0cmluZ0J1aWxkZXI6IHN0cmluZ1tdKSB7XHJcbiAgICAgICAgdGhpcy5fY2hpbGRyZW4uZm9yRWFjaChjaGlsZCA9PiB7XHJcbiAgICAgICAgICAgIGlmIChjaGlsZCBpbnN0YW5jZW9mIFdUZXh0Tm9kZSkge1xyXG4gICAgICAgICAgICAgICAgb3V0U3RyaW5nQnVpbGRlci5wdXNoKGNoaWxkLnRleHQpXHJcbiAgICAgICAgICAgIH0gZWxzZSB7XHJcbiAgICAgICAgICAgICAgICBjaGlsZC5yZW5kZXJPdXRlckh0bWwob3V0U3RyaW5nQnVpbGRlcilcclxuICAgICAgICAgICAgfVxyXG4gICAgICAgIH0pXHJcbiAgICB9XHJcbiAgICAvLyBnZXQgc2NvcGUoKSB7XHJcbiAgICAvLyAgICAgcmV0dXJuIHRoaXMuX3dvcmtTY29wZVxyXG4gICAgLy8gfVxyXG4gICAgZ2V0IGluZGVudGlmeSgpIHtcclxuICAgICAgICByZXR1cm4gYCR7dGhpcy5fY29tcG9uZW50Um9vdC5pbmRlbnRpZnl9fDwke3RoaXMuX3RhZ30gZWlkPSR7dGhpcy5fYXR0cnNbJ19laWQnXX0+YFxyXG4gICAgfVxyXG59XHJcblxyXG5cclxuZXhwb3J0IGNsYXNzIFdvcmtlckNvbXBvbmVudCB7XHJcbiAgICBwcml2YXRlIF9laWRNYXAgPSBuZXcgTWFwPHN0cmluZywgV0VsZW0+KClcclxuICAgIHByaXZhdGUgX2NpZCA9ICcnXHJcbiAgICBwcml2YXRlIF9laWRDb3VudGVyID0gMFxyXG5cclxuICAgIC8vIFdlYkNvbXBvbmVudFx1NTE4NVx1OTBFOFx1NjgzOVx1NTE0M1x1N0QyMFxyXG4gICAgcHJpdmF0ZSBfaW50ZXJSb290RWxlbT86IFdFbGVtXHJcbiAgICBwcml2YXRlIF9yZWxVcmwgPSAnJ1xyXG4gICAgLy8gXHU2ODM5XHU0RjVDXHU3NTI4XHU1N0RGXHJcbiAgICBwcml2YXRlIF93b3JrU2NvcGU6IFdvcmtlclNjb3BlID0gbmV3IFdvcmtlclNjb3BlKHRoaXMuaW5kZW50aWZ5LCB7fSlcclxuXHJcbiAgICBjb25zdHJ1Y3RvcihwdWJsaWMgcm9vdFRhZzogc3RyaW5nLCBwcml2YXRlIF9jb21wQXR0cnM6IHsgW2s6IHN0cmluZ106IHN0cmluZyB9KSB7XHJcbiAgICAgICAgdGhpcy5fY2lkID0gX2NvbXBBdHRyc1snX2NpZCddXHJcbiAgICAgICAgaWYgKCF0aGlzLl9jaWQpIHRocm93IG5ldyBFcnJvcignV29ya2VyQ29tcG9uZW50IG11c3QgaGF2ZSBfY2lkIGF0dHJpYnV0ZScpXHJcbiAgICAgICAgd29ya2VyQ29tcG9uZW50UmVnaXN0cnkuc2V0KHRoaXMuX2NpZCwgdGhpcylcclxuICAgIH1cclxuICAgIGdldCB3b3JrU2NvcGUoKSB7XHJcbiAgICAgICAgcmV0dXJuIHRoaXMuX3dvcmtTY29wZVxyXG4gICAgfVxyXG4gICAgbmV3RWlkKGVsZW06IFdFbGVtKSB7XHJcbiAgICAgICAgbGV0IGVpZCA9IGAke3RoaXMuX2NpZH06JHt0aGlzLl9laWRDb3VudGVyKyt9YFxyXG4gICAgICAgIHRoaXMuX2VpZE1hcC5zZXQoZWlkLCBlbGVtKVxyXG4gICAgICAgIHJldHVybiBlaWQ7XHJcbiAgICB9XHJcbiAgICBnZXQgaW5kZW50aWZ5KCkge1xyXG4gICAgICAgIHJldHVybiBgPCR7dGhpcy5yb290VGFnfSBjaWQ9XCIke3RoaXMuX2NpZH1cIj5gXHJcbiAgICB9XHJcblxyXG5cclxuICAgIC8vIFx1NTJBMFx1OEY3RFx1N0VDNFx1NEVGNlxyXG4gICAgYXN5bmMgbG9hZCgpIHtcclxuICAgICAgICAvLyBcdTUyQTBcdThGN0RcdTdFQzRcdTRFRjZcclxuICAgICAgICBsZXQgdHBsID0gYXdhaXQgdHBsUmVnaXN0cnkuZ2V0KHRoaXMucm9vdFRhZylcclxuICAgICAgICB0aGlzLl9yZWxVcmwgPSB0cGwucmVsVXJsXHJcblxyXG4gICAgICAgIGlmICh0cGwucm9vdEVsZW0udGFnICE9ICd0ZW1wbGF0ZScpIHtcclxuICAgICAgICAgICAgbG9nLmVycm9yKCdsb2FkIGNvbXBvbmVudDonLCB0aGlzLnJvb3RUYWcsICdcXFwicm9vdCBlbGVtZW50IG11c3QgYmUgPHRlbXBsYXRlPlxcXCInKVxyXG4gICAgICAgICAgICByZXR1cm5cclxuICAgICAgICB9XHJcbiAgICAgICAgdGhpcy5faW50ZXJSb290RWxlbSA9IG5ldyBXRWxlbSh0aGlzLCB1bmRlZmluZWQsIHRwbC5yb290RWxlbSlcclxuICAgICAgICByZXR1cm4gdGhpcy5faW50ZXJSb290RWxlbS53YWl0TG9hZCgpXHJcbiAgICB9XHJcbiAgICBnZXQgcmVsVXJsKCkge1xyXG4gICAgICAgIHJldHVybiB0aGlzLl9yZWxVcmxcclxuICAgIH1cclxuXHJcbiAgICAvLyBcdTgzQjdcdTUzRDZcdTY4MzlcdTUxNDNcdTdEMjBcdTc2ODRcdTVDNUVcdTYwMjdcclxuICAgIHJvb3RBdHRycygpIHtcclxuICAgICAgICBsZXQgcm9vdEF0dHJzID0gdGhpcy5faW50ZXJSb290RWxlbT8uYXR0cnNWYWx1ZSgpIHx8IHt9XHJcbiAgICAgICAgLy8gXHU1OTgyXHU2NzlDXHU3RUM0XHU0RUY2XHU0RjIwXHU1MTY1XHU1QzVFXHU2MDI3XHU0RTBEXHU1NzI4cm9vdEVsZW1cdTRFMkQsXHU1MjE5XHU2REZCXHU1MkEwXHU1MjMwcm9vdEVsZW1cdTRFMkRcclxuICAgICAgICBKc1V0aWxzLm9iamVjdEZvckVhY2godGhpcy5fY29tcEF0dHJzLCAodiwgaykgPT4ge1xyXG4gICAgICAgICAgICBpZiAoIXJvb3RBdHRyc1trXSkge1xyXG4gICAgICAgICAgICAgICAgcm9vdEF0dHJzW2tdID0gdlxyXG4gICAgICAgICAgICB9XHJcbiAgICAgICAgfSlcclxuXHJcbiAgICAgICAgcmV0dXJuIHJvb3RBdHRyc1xyXG4gICAgfVxyXG4gICAgcmVuZGVyQ29udGVudEh0bWwob3V0U3RyaW5nQnVpbGRlcjogc3RyaW5nW10pIHtcclxuICAgICAgICAvLyBcdTZFMzJcdTY3RDNcdTUxODVcdTVCQjlcclxuICAgICAgICB0aGlzLl9pbnRlclJvb3RFbGVtPy5yZW5kZXJJbm5lckh0bWwob3V0U3RyaW5nQnVpbGRlcilcclxuICAgIH1cclxufVxyXG5cclxuXHJcblxyXG4iLCAiaW1wb3J0IHsgTmV0VXRpbHMgfSBmcm9tIFwiLi4vY29tbW9uXCI7XHJcbmltcG9ydCB7IExvZ2dlciB9IGZyb20gXCIuLi9sb2dnZXJcIjtcclxuaW1wb3J0IFwiLi4vbWVzc2FnZVwiO1xyXG5pbXBvcnQgeyBtZXNzYWdlIH0gZnJvbSBcIi4uL21lc3NhZ2VcIjtcclxuaW1wb3J0IHsgV29ya2VyQ29tcG9uZW50IH0gZnJvbSBcIi4vd29ya2VyQ29tcG9uZW50c1wiO1xyXG5pbXBvcnQgeyB3b3JrZXJNZXRhIH0gZnJvbSBcIi4vd29ya2VyTWV0YVwiO1xyXG5cclxuY29uc3QgbG9nID0gTG9nZ2VyKFwiV09POldvcmtlclwiKVxyXG5sb2cuZGVidWcoXCJXb3JrZXIgaW5pdFwiKVxyXG5cclxuXHJcblxyXG4vKipcclxuICogXHU4QkJFXHU3RjZFXHU1NDhDXHU4OUUzXHU2NzkwXHU1MTY4XHU1QzQwTWV0YVx1NUM1RVx1NjAyN1xyXG4gKi9cclxubWVzc2FnZS5vbihcIk06U2V0TWV0YVwiLCBhc3luYyAoZGF0YSkgPT4ge1xyXG4gICAgaWYgKGRhdGEuaHRtbFVybCkgd29ya2VyTWV0YS5zZXRIb21lVXJsKGRhdGEuaHRtbFVybClcclxuICAgIHdvcmtlck1ldGEuc2V0TWV0YShkYXRhLm1ldGEpXHJcbiAgICByZXR1cm4ge31cclxufSk7XHJcblxyXG5cclxuLyoqXHJcbiAqIFx1NTJBMFx1OEY3RFx1NTE0M1x1N0QyMFxyXG4gKi9cclxubWVzc2FnZS5vbihcIk06TG9hZEVsZW1cIiwgYXN5bmMgKGRhdGEpID0+IHtcclxuICAgIGxldCB0YWcgPSB3b3JrZXJNZXRhLm5vcm1hbGl6ZVRhZyhkYXRhLnRhZyxkYXRhLnJlbFVybClcclxuICAgIGxvZy53YXJuKFwiPT0+IHN0YXJ0IExvYWRFbGVtOlwiLGRhdGEudGFnLCB0YWcsIGRhdGEuYXR0cnMpXHJcblxyXG4gICAgXHJcbiAgICAvLyBcdTUyMUJcdTVFRkFXb3JrZXJcdTdFQzRcdTRFRjZcdTVCOUVcdTRGOEJcclxuICAgIGxldCBodG1sQnVpbGRlcjogc3RyaW5nW10gPSBbXVxyXG4gICAgY29uc3QgY29tcCA9IG5ldyBXb3JrZXJDb21wb25lbnQodGFnLCBkYXRhLmF0dHJzKVxyXG4gICAgYXdhaXQgY29tcC5sb2FkKClcclxuICAgIGNvbXAucmVuZGVyQ29udGVudEh0bWwoaHRtbEJ1aWxkZXIpXHJcblxyXG4gICAgbGV0IHJlc3VsdCA9ICB7IHRhZywgYXR0cnM6IGNvbXAucm9vdEF0dHJzKCksIGNvbnRlbnQ6IGh0bWxCdWlsZGVyLmpvaW4oJycpIH1cclxuICAgIGxvZy53YXJuKFwiPT0+IGVuZCBMb2FkRWxlbTpcIixyZXN1bHQpXHJcbiAgICBcclxuXHJcbiAgICByZXR1cm4gcmVzdWx0O1xyXG59KVxyXG5cclxuIl0sCiAgIm1hcHBpbmdzIjogIjs7O0FBV0EsTUFBSSxlQUFlO0FBRW5CLE1BQU0sY0FBYyxDQUFDLENBQUUsWUFBWSxjQUFjLFFBQVEsT0FBTztBQVF6RCxXQUFTLE9BQU8sS0FBYTtBQUNsQyxVQUFNLElBQUksS0FBSyxNQUFNLEtBQUssT0FBTyxJQUFJLEdBQUc7QUFDeEMsVUFBTSxZQUFZLGFBQWEsQ0FBQztBQUNoQyxVQUFNLFlBQVksYUFBYSxDQUFDO0FBRWhDLFFBQUksYUFBYTtBQUdqQixVQUFNLFVBQVUsQ0FBQyxTQUFTLE9BQU8sUUFBUSxRQUFRLE9BQU87QUFDeEQsYUFBUyxPQUFPO0FBQUEsSUFBQztBQUVqQixVQUFNLE1BQU0sWUFBYSxNQUFhO0FBQ3BDLE1BQUMsSUFBWSxJQUFJLEtBQUssS0FBSyxHQUFHLElBQUk7QUFBQSxJQUNwQztBQUNBLFlBQVE7QUFBQSxNQUNOO0FB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LGVBQVcsUUFBUSxLQUFLLElBQUk7QUFDNUIsV0FBTyxDQUFDO0FBQUEsRUFDWixDQUFDO0FBTUQsVUFBUSxHQUFHLGNBQWMsT0FBTyxTQUFTO0FBQ3JDLFFBQUksTUFBTSxXQUFXLGFBQWEsS0FBSyxLQUFJLEtBQUssTUFBTTtBQUN0RCxJQUFBQSxLQUFJLEtBQUssdUJBQXNCLEtBQUssS0FBSyxLQUFLLEtBQUssS0FBSztBQUl4RCxRQUFJLGNBQXdCLENBQUM7QUFDN0IsVUFBTSxPQUFPLElBQUksZ0JBQWdCLEtBQUssS0FBSyxLQUFLO0FBQ2hELFVBQU0sS0FBSyxLQUFLO0FBQ2hCLFNBQUssa0JBQWtCLFdBQVc7QUFFbEMsUUFBSSxTQUFVLEVBQUUsS0FBSyxPQUFPLEtBQUssVUFBVSxHQUFHLFNBQVMsWUFBWSxLQUFLLEVBQUUsRUFBRTtBQUM1RSxJQUFBQSxLQUFJLEtBQUsscUJBQW9CLE1BQU07QUFHbkMsV0FBTztBQUFBLEVBQ1gsQ0FBQzsiLAogICJuYW1lcyI6IFsibG9nIiwgImxvZyIsICJvYmoiLCAidmFsdWUiLCAidiIsICJsb2ciLCAibG9nIiwgImxvZyIsICJsb2ciXQp9Cg==
