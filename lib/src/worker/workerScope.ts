import { Logger } from '../logger';

const log = Logger('workerScope');
const TRIGGER_NOTICE_INTERVAL = 5;

// 观察对象,symObserver 保存了依赖的Set集合
export const SymObjectObserver = Symbol('SymObjectObserver');
// 定义符号,用于标志遍历递归对象时的循环检测
export const SymObjectVisitTicks = Symbol('SymObjectVisited');
// 将对象转换为可观测对象时,保存原始属性描述
export const SymObjectInitPropDesc = Symbol('SymObjectInitPropDesc');
export const SymScopeProto = Symbol('ScopeProto');
// 定义Worker原生对象符号,用于判定是否为原生对象
export const SymWorkerNativeObject = Symbol('WorkerNativeObject');

// 为所有原生对象添加原生对象标志,以作判定
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
  (globalThis as any)['WorkLocation'],
  TextDecoder,
  TextEncoder,
  FileReader,
  WebSocket,
  Performance,
  XMLHttpRequest,
  XMLHttpRequestEventTarget,
  XMLHttpRequestUpload,
  OffscreenCanvas,
  OffscreenCanvasRenderingContext2D,

].forEach((v) => {
  if (v)
    Object.defineProperty(v, SymWorkerNativeObject, {
      value: true,
      writable: false,
      enumerable: false,
    });
});

// 作用域通知对象,以Scope为单位,通知依赖的对象处理变更
const _globalScopeNotifier = new (class ScopeNotifier {
  private _noticeSets = new Map<string, Set<Set<string>>>();
  constructor() {
    setInterval(() => {
      this._triggerNotice();
    }, TRIGGER_NOTICE_INTERVAL);
  }

  // 添加一个通知对象,添加和记录原始跟踪对象
  // 这样可以增加性能，当频繁变更时，只记录最后一次变更
  // 最终在执行时进行一次合并计算
  addNoticeSet(scopeName: string, set: Set<string>) {
    log.info(`==>addNoticeSet: ${scopeName}-> ${[...set].join(',')}`);
    let noticeSet = this._noticeSets.get(scopeName);
    if (!noticeSet) {
      noticeSet = new Set();
      this._noticeSets.set(scopeName, noticeSet);
    }
    noticeSet.add(set);
  }

  private _triggerNotice() {
    // log.info('triggerNotice',this._noticeSets);
    // 计算和合并通知对象
    this._noticeSets.forEach((noticeSet, scopeName) => {
      let mergedSet = new Set<string>();
      noticeSet.forEach((set) => {
        set.forEach((k) => mergedSet.add(k));
      });
      // 执行通知
      let scope = _globalScopesMap.get(scopeName);
      if (scope) {
        log.info('triggerNotice', scopeName, mergedSet);
        mergedSet.forEach((k) => {
          try {
            scope.execTraceOnChangedCallback(k);
          } catch (e) {
            log.error(`triggerNotice error: ${scopeName}->${k}`, e);
          }
        });
      }
    });

    // 清空通知对象
    this._noticeSets.clear();
  }
})();

export class ScopeDependents {
  // 对象自身的依赖变更对象，当对象变化时，通知所有依赖的对象
  // 此依赖项在其其他对象的属性中变化时，记录依赖，以在自身变化时，如delete时，通知依赖对象
  private _selfDependents = new Set<string>();
  // 记录属性依赖对象
  private _propDependents = new Map<string, Set<string>>();
  constructor(scopeName: string) {}

  addSelfDependent(key: string) {
    this._selfDependents.add(key);
  }

  addPropDependent(key: string, prop: string) {
    let set = this._propDependents.get(prop);
    if (!set) {
      set = new Set<string>();
      this._propDependents.set(prop, set);
    }
    set.add(key);
  }
  getPropDependents(key: string): Set<string> | undefined {
    return this._propDependents.get(key);
  }
  getSelfDependents(): Set<string> {
    return this._selfDependents;
  }
}

// 当前全局作用域跟踪
let _globalTraceKey: string | undefined = undefined;
let _globalScopesMap = new Map<string, WorkerScope>();

/**
 * 作用域对象, 自动跟踪对象的属性变化,并通知依赖的对象处理变更
 * 当一个对象添加到作用域中时,会自动跟踪对象的属性变化
 * 每个WebComponent实例拥有唯一的作用域对象
 * 当 WebComponent实例销毁时,作用域对象也会销毁
 * 可以为子元素创建子Scope,子Scope通过原型链继承父Scope的属性，在子Scope添加不存在的属性时,会在子Scope中创建新的属性，而不是在父Scope中创建新的属性
 *
 */
export class WorkerScope {
  private _rootScope = {} as any;
  private _traceCallbacks = new Map<
    string,
    {
      calcFunc: () => any;
      changedCallback: (result: any) => void;
    }
  >();

  constructor(
    private _scopeName: string, // 作用域关联componentId,用于变更跟踪
    _initObject: any // 初始化对象
  ) {
    log.info('new WorkerScope', _scopeName, _initObject);
    this._rootScope = this._initRootScope(_initObject || {});

    // 全局注册Scope
    _globalScopesMap.set(_scopeName, this);
  }
  // 初始化传入的预定义对象
  private _initRootScope(obj: any): any {
    let root = {};
    // 检测obj是否为类,如果是类则初始化一个实例
    if (obj instanceof Function) {
      try {
        root = new obj();
      } catch (e) {
        log.warn('root object not class', this._scopeName);
      }
    } else if (typeof obj === 'object') {
      root = obj;
    } else {
      // 不支持非对象类型
      log.error('root object not object', this._scopeName, typeof obj, obj);
    }
    // 为对象创建观察对象
    root = this._makeObserver(root);

    // 设置 rooptScope的原型为this,继承相关操作和函数
    Reflect.setPrototypeOf(this._findObjectProtoRoot(root), this._createRootProto());
    return root;
  }

  private _createRootProto() {
    let _this = this;
    return {
      // 获取根作用域对象
      get $rootScope() {
        return _this._rootScope;
      },
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
  traceCall(key: string, calcFunc: () => any, changedCallback: (result: any) => void) {
    // 注册回调函数
    this._traceCallbacks.set(key, {
      calcFunc: calcFunc,
      changedCallback: changedCallback,
    });

    // 注册全局跟踪key
    _globalTraceKey = key;
    let ret = calcFunc();
    _globalTraceKey = undefined;

    // 注册全局跟踪key
    return ret;
  }
  untraceCall(key: string) {
    this._traceCallbacks.delete(key);
  }

  // 重新计算待执行的函数，并返回结果，调用回调函数
  execTraceOnChangedCallback(key: string) {
    let cb = this._traceCallbacks.get(key);
    log.info('execExistdTraceCall', key, cb);
    if (cb) {
      // 因为条件可能发生改变，重新计算
      // 注册全局跟踪key
      _globalTraceKey = key;
      let ret = cb.calcFunc();
      _globalTraceKey = undefined;
      cb.changedCallback(ret);
    }
  }

  private _findObjectProtoRoot(obj: any): any {
    let proto = Object.getPrototypeOf(obj);
    if (proto === null || proto === Object.prototype) return obj;
    return this._findObjectProtoRoot(proto);
  }

  private _saveObjectInitPropDesc(obj: any, prop: string) {
    let desc = Reflect.getOwnPropertyDescriptor(obj, prop);
    if (desc) {
      (obj[SymObjectInitPropDesc] as { [k: string]: PropertyDescriptor })[prop] = desc;
    }
  }

  private _getObjectInitPropDesc(obj: any, prop: string): PropertyDescriptor | undefined {
    return (obj[SymObjectInitPropDesc] as { [k: string]: PropertyDescriptor })[prop];
  }

  /**
   * 将当前元素的属性转换为get/set属性,实现属性变更跟踪
   */
  private _makeObjectPropGetSet(obj: any, prop: string) {
    const _this = this;
    // 如果当前对象不是可观测对象，退出
    let dependents = obj[SymObjectObserver] as ScopeDependents | undefined;
    if (!dependents) {
      log.warn('not observer object', obj);
      return;
    }
    // 如果已经应用过当前属性的get/set,则退出不再重复处理
    // if (dependents.getPropDependents(prop)) return;

    // 获取属性描述,如果当前属性不存在则创建
    let desc = Reflect.getOwnPropertyDescriptor(obj, prop);
    // 如果属性不可配置,不可枚举,不可写入,或者是函数,则直接设置
    if (!desc || !desc.configurable || !desc.enumerable || !desc.writable || typeof desc.value === 'function') {
      return;
    }
    // 保存原始属性描述
    _this._saveObjectInitPropDesc(obj, prop);

    // 为对象属性创建get/set函数
    Reflect.defineProperty(obj, prop, {
      get() {
        // 跟踪属性调用
        _this._traceObjectProp(obj, prop);
        let initGet = _this._getObjectInitPropDesc(obj, prop)?.get;
        let v = initGet ? initGet() : desc.value;

        // 添加跟踪对象自身,以便在对象自身发生变化时,通知依赖对象
        _this._traceObjectSelf(v);

        return v;
      },
      set(value) {
        log.info('ObjectSet', obj, prop, value);

        _this._noticePropChanged(obj, prop);

        // 设置新值
        let obValue = _this._makeObserver(value);
        let initSet = _this._getObjectInitPropDesc(obj, prop)?.set;
        if (initSet) {
          initSet(obValue);
        } else {
          desc.value = obValue;
        }
        return true;
      },
    });
  }

  private _traceObjectProp(obj: any, prop: string) {
    if (_globalTraceKey) {
      obj[SymObjectObserver]?.addPropDependent(_globalTraceKey, prop);
    }
  }
  private _traceObjectSelf(obj: any) {
    if (_globalTraceKey) {
      if (typeof obj === 'object' && obj !== null) {
        obj[SymObjectObserver]?.addSelfDependent(_globalTraceKey);
      }
    }
  }

  private _noticePropChanged(obj: any, prop: string) {
    let dependents = obj[SymObjectObserver] as ScopeDependents | undefined;
    if (!dependents) return;
    let propDeps = dependents.getPropDependents(prop);
    if (propDeps && propDeps.size > 0) {
      _globalScopeNotifier.addNoticeSet(this._scopeName, propDeps);
    }
  }
  private _noticeSelfChanged(obj: any) {
    let dependents = obj[SymObjectObserver] as ScopeDependents | undefined;
    if (!dependents) return;
    let selfDeps = dependents.getSelfDependents();
    if (selfDeps.size > 0) {
      _globalScopeNotifier.addNoticeSet(this._scopeName, selfDeps);
    }
  }

  private _makeObserverObject(obj: any): any {
    // ================== 标准化对象属性处理 ==================
    let _this = this;
    // 为对象所有自身属性创建get/set函数
    Reflect.ownKeys(obj).forEach((k) => {
      if (typeof k !== 'string') return;

      // 为对象属性创建get/set函数
      _this._makeObjectPropGetSet(obj, k);
    });
    // 为对象原型创建proxy,以在新建属性时创建观察对象
    let oldProto = Reflect.getPrototypeOf(obj) || ({} as any);
    if (typeof oldProto == 'object' && !Object.getOwnPropertyDescriptor(obj, SymScopeProto)) {
      let newProto = Object.create(oldProto);
      Object.defineProperty(newProto, SymScopeProto, {
        value: true,
      });

      Reflect.setPrototypeOf(
        obj,
        new Proxy(newProto, {
          get(target, prop) {
            // 如果原型存在属性,则直接返回
            if (Reflect.has(target, prop)) return Reflect.get(target, prop);
            // 在原型获取属性时,添加跟踪对象
            if (typeof prop !== 'string') return undefined;

            // 跟踪属性调用
            _this._traceObjectProp(obj, prop);

            return undefined;
          },

          set(target, prop, value, receiver) {
            // 如果原型存在属性,则直接返回
            if (Reflect.has(target, prop)) return Reflect.set(target, prop, value, receiver);
            if (typeof prop !== 'string') {
              // 非字符串对象，在原始对象上直接设置新属性
              Reflect.defineProperty(obj, prop, { value, writable: true, enumerable: true, configurable: true });
              return true;
            }

            log.info('ObjectNewProp', obj, prop, value);

            let oldValue = Reflect.get(obj, prop);

            // 设置新属性,将新属性设置到原始对象中,并启动跟踪和触发变更通知
            Reflect.defineProperty(obj, prop, {
              value: _this._makeObserver(value),
              writable: true,
              enumerable: true,
              configurable: true,
            });

            // 创建get/set函数以进行跟踪
            _this._makeObjectPropGetSet(obj, prop);

            // 通知属性发生变更
            _this._noticePropChanged(obj, prop);
            // 当替换属性时,如果原属性为对象,由于整个对象被替换,需要深度递归通知原对象的全部依赖对象
            // 定义递归访问时间戳,防止循环访问
            let visitedTicks = new Date().getTime();
            function _deepNoticeObj(obj: any) {
              if (typeof obj !== 'object') return;

              let objDependents = obj[SymObjectObserver] as ScopeDependents | undefined;
              if (!objDependents) return;

              // 防止循环遍历
              if (Reflect.get(obj, SymObjectVisitTicks) === visitedTicks) return;

              Reflect.defineProperty(obj, SymObjectVisitTicks, { value: visitedTicks });

              // 通知对象自身的依赖
              _this._noticeSelfChanged(obj);

              Reflect.ownKeys(obj).forEach((k) => {
                if (typeof k !== 'string') return;
                // 通知对象的所有属性发生变更
                _this._noticePropChanged(obj, k);
                // 递归通知对象的属性
                let value = Reflect.get(obj, k);
                _deepNoticeObj(value);
              });
            }
            // 通知监控原始对象的全部依赖对象
            _deepNoticeObj(oldValue);

            return true;
          },
          // 删除属性，需通知当前对象自身的依赖
          deleteProperty(target, p) {
            log.info('deleteProperty', obj, p);
            // 删除对象
            delete obj[p];
            if (typeof p !== 'string') return true;
            // 添加属性的变更通知
            _this._noticePropChanged(obj, p);
            // 添加当前对象的变更通知
            _this._noticeSelfChanged(obj);

            return true;
          },
        })
      );
    }

    // 为obj创建代理对象,监控deleteProperty动作
    // 注意: 此监控行为无法监控到对象内部使用this对象的delete操作

    return new Proxy(obj, {
      deleteProperty(target, p) {
        log.info('deleteProperty', target, p);
        // 删除对象
        Reflect.deleteProperty(target, p);
        if (typeof p !== 'string') return true;
        // 添加属性的变更通知
        _this._noticePropChanged(target, p);
        // 添加当前对象的变更通知
        _this._noticeSelfChanged(target);

        return true;
      },
    });
  }
  private _makeObserverArray(arr: any[]): any {
    let _this = this;
    // 创建数组观察对象
    return new Proxy(arr, {
      get(target, prop) {
        let v = Reflect.get(target, prop);
        if (typeof prop != 'string') return v;
        if (typeof v === 'function') {
          // 处理数组成员函数
          if (prop === 'push') {
            return (...args: any[]) => {
              let ret = Reflect.apply(v, target, args);
              // 通知数组自身变更
              _this._noticeSelfChanged(target);
              // 跟踪新增加的数组成员
              for (let i = 0; i < args.length; i++) {
                _this._traceObjectProp(target, (target.length - args.length + i).toString());
              }
              return ret;
            };
          } else if (prop === 'pop') {
            return () => {
              let ret = Reflect.apply(v, target, []);
              // 通知弹出的数组成员变更
              _this._noticePropChanged(target, (target.length - 1).toString());

              // 通知数组自身变更
              _this._noticeSelfChanged(target);
              return ret;
            };
          } else if (prop === 'shift') {
            return () => {
              // 所有现有成员需要通知变更
              for (let i = 0; i < target.length; i++) {
                _this._noticePropChanged(target, i.toString());
              }

              let ret = Reflect.apply(v, target, []);
              // 通知数组自身变更
              _this._noticeSelfChanged(target);
              return ret;
            };
          } else if (prop === 'unshift') {
            return (...args: any[]) => {
              let ret = Reflect.apply(v, target, args);
              // 通知数组自身变更
              _this._noticeSelfChanged(target);
              // 所有现有成员需要通知变更
              for (let i = 0; i < target.length; i++) {
                _this._noticePropChanged(target, i.toString());
              }
              return ret;
            };
          } else if (prop === 'splice') {
            return (...args: any[]) => {
              // splice操作,仅通知变化的元素和自身
              let ret = Reflect.apply(v, target, args);
              let start = args[0];
              if (start < 0) start = target.length + start;
              let deleteCount = args[1];
              if (deleteCount < 0) deleteCount = 0;
              let addCount = args.length - 2;
              if (addCount < 0) addCount = 0;
              let changedCount = Math.max(deleteCount, addCount);
              // 通知变化的元素
              for (let i = 0; i < changedCount; i++) {
                _this._noticePropChanged(target, (start + i).toString());
              }
              // 通知数组自身变更
              _this._noticeSelfChanged(target);
              return ret;
            };
          } else if (prop === 'reverse' || prop === 'sort') {
            return (...args: any[]) => {
              let oldLength = target.length;

              let ret = Reflect.apply(v, target, args);
              // 通知数组全部元素变更
              let changedCount = Math.max(oldLength, target.length);
              for (let i = 0; i < changedCount; i++) {
                _this._noticePropChanged(target, i.toString());
              }
              // 通知数组自身变更
              _this._noticeSelfChanged(target);
              return ret;
            };
          } else if (prop === 'copyWithin') {
            return (...args: any[]) => {
              // 根据参数获取受影响的元素集合
              let targetIndex = args[0];
              let start = args[1];
              if (start < 0) start = target.length + start;
              let end = args[2];
              if (end === undefined) end = target.length - start;
              if (end < 0) end = target.length + end;
              let changedCount = Math.min(end - start, target.length - targetIndex);

              let ret = Reflect.apply(v, target, args);

              // 通知变化的元素
              for (let i = 0; i < changedCount; i++) {
                _this._noticePropChanged(target, (targetIndex + i).toString());
              }

              // 通知数组自身变更
              _this._noticeSelfChanged(target);
              return ret;
            };
          } else if (prop === 'fill') {
            return (...args: any[]) => {
              let targetIndex = args[1];
              let end = args[2];
              if (end === undefined) end = target.length;
              if (end < 0) end = target.length + end;
              let changedCount = Math.min(end - targetIndex, target.length - targetIndex);

              let ret = Reflect.apply(v, target, args);

              // 通知变化的元素
              for (let i = 0; i < changedCount; i++) {
                _this._noticePropChanged(target, (targetIndex + i).toString());
              }

              // 通知数组自身变更
              _this._noticeSelfChanged(target);
              return ret;
            };
          } else {
            // 跟踪函数名指定的属性,并在被调用时通知属性变化通知以获取最新值
            _this._traceObjectProp(target, prop.toString());

            return (...args: any[]) => {
              let ret = Reflect.apply(v, target, args);
              _this._noticePropChanged(target, prop.toString());
              return ret;
            };
          }
        }
        // 处理数组成员属性
        _this._traceObjectProp(arr, prop.toString());
        if (prop === 'length') {
          _this._traceObjectSelf(arr);
        }

        return v;
      },
      set(target, prop, value) {
        _this._noticePropChanged(target, prop.toString());

        return Reflect.set(arr, prop, _this._makeObserver(value));
      },
    });

    return arr;
  }
  private _makeObserverMap(map: Map<any, any>): any {
    let _this = this;
    return new Proxy(map, {
      get(target, prop) {
        let v = Reflect.get(target, prop);
        if (typeof prop !== 'string') return v;
        if (typeof v === 'function') {
          // 处理Map的函数
          if (prop === 'set') {
            return (key: any, value: any) => {
              log.info('call map.set()', map, key, value);
              if (!map.has(key)) {
                // 自身回调将触发for循环,所以在此处通知自身变更
                _this._noticeSelfChanged(target);
              }

              let ret = Reflect.apply(v, target, [key, _this._makeObserver(value)]);
              _this._noticePropChanged(target, key.toString());
              return ret;
            };
          } else if (prop === 'delete') {
            log.info('call map.delete()', map, prop);
            return (key: any) => {
              let ret = Reflect.apply(v, target, [key]);
              _this._noticePropChanged(target, key.toString());
              _this._noticeSelfChanged(target);
              return ret;
            };
          } else if (prop === 'clear') {
            log.info('call map.clear()', map, prop);
            return () => {
              // 触发所有子项变更
              map.forEach((v, k) => {
                _this._noticePropChanged(target, k.toString());
              });
              let ret = Reflect.apply(v, target, []);
              _this._noticeSelfChanged(target);
              return ret;
            };
          } else if (prop === 'get') {
            return (key: any) => {
              _this._traceObjectProp(target, key.toString());
              let ret = Reflect.apply(v, target, [key]);
              return ret;
            };
          } else {
            log.info('call map function', map, prop);
            // 跟踪函数名指定的属性,并在被调用时通知属性变化通知以获取最新值

            return (...args: any[]) => {
              let ret = Reflect.apply(v, target, args);
              _this._noticePropChanged(target, prop.toString());
              return ret;
            };
          }
        }
        // 处理Map的属性
        _this._traceObjectProp(map, prop.toString());
        if (prop === 'size') {
          _this._traceObjectSelf(map);
        }
        return v;
      },
      set(target, prop, value) {
        log.info('set map prop', target, prop, value);
        // 如果新增,则通知自身变更
        if (!target.has(prop)) {
          _this._noticeSelfChanged(target);
        }

        _this._noticePropChanged(target, prop.toString());

        return Reflect.set(map, prop, _this._makeObserver(value));
      },
    });
  }
  private _makeObserverSet(set: Set<any>): any {
    let _this = this;
    return new Proxy(set, {
      get(target, prop) {
        let v = Reflect.get(target, prop);
        if (typeof prop !== 'string') return v;
        if (typeof v === 'function') {
          // 处理Set的函数
          if (prop === 'add') {
            return (value: any) => {
              log.info('call set.add()', set, value);
              if (!set.has(value)) {
                // 自身回调将触发for循环,所以在此处通知自身变更
                _this._noticeSelfChanged(target);
              }

              let ret = Reflect.apply(v, target, [_this._makeObserver(value)]);
              _this._noticePropChanged(target, value.toString());
              return ret;
            };
          } else if (prop === 'delete') {
            log.info('call set.delete()', set, prop);
            return (value: any) => {
              let ret = Reflect.apply(v, target, [value]);
              _this._noticePropChanged(target, value.toString());
              _this._noticeSelfChanged(target);
              return ret;
            };
          } else if (prop === 'clear') {
            log.info('call set.clear()', set, prop);
            return () => {
              // 触发所有子项变更
              set.forEach((v) => {
                _this._noticePropChanged(target, v.toString());
              });
              let ret = Reflect.apply(v, target, []);
              _this._noticeSelfChanged(target);
              return ret;
            };
          } else if (prop === 'has') {
            return (value: any) => {
              _this._traceObjectProp(target, value.toString());
              let ret = Reflect.apply(v, target, [value]);
              return ret;
            };
          } else {
            log.info('call set function', set, prop);
            // 跟踪函数名指定的属性,并在被调用时通知属性变化通知以获取最新值

            return (...args: any[]) => {
              let ret = Reflect.apply(v, target, args);
              _this._noticePropChanged(target, prop.toString());
              return ret;
            };
          }
        }
        // 处理Set的属性
        _this._traceObjectProp(set, prop.toString());
        if (prop === 'size') {
          _this._traceObjectSelf(set);
        }
        return v;
      },
    });
  }

  private _isWebWorkerNativeObject(obj: any): boolean {
    return Reflect.has(obj, SymWorkerNativeObject);
  }

  // 将一个对象初始化为可观测对象,此时对象的属性变化会被跟踪
  private _makeObserver(obj: any): any {
    if (typeof obj !== 'object' || obj === null) return obj;
    if (this._isWebWorkerNativeObject(obj)) return obj;
    if (Reflect.getOwnPropertyDescriptor(obj, SymObjectObserver)) return obj;
    // return obj;
    // 定义观察对象
    Reflect.defineProperty(obj, SymObjectObserver, {
      value: new ScopeDependents(this._scopeName),
      writable: false,
      enumerable: false,
    });
    // 定义对象属性初始化描述
    Reflect.defineProperty(obj, SymObjectInitPropDesc, {
      value: {},
      writable: false,
      enumerable: false,
    });

    if (obj instanceof Array) {
      // 创建数组观察对象
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
}

// export class WatcherClass {
//     constructor() {
//         return makeProxy(this);
//     }
// }
// export function watchObject<T extends {}>(obj: T): T {
//     return makeProxy(obj)
// }

export const workerObserver = new (class WorkerObserver {
  /**
   * 创建一个可观测对象,在对象的属性发生变化时,通知依赖的对象处理变更
   * @param target
   * @param prop
   */
  observe(target: { [k: string]: any }) {}

  // 生成代理对象
  makeProxy(obj: any) {
    const _this = this;
    if (Reflect.getOwnPropertyDescriptor(obj, SymObjectObserver)) return obj;
    Reflect.defineProperty(obj, SymObjectObserver, {
      value: {
        // 依赖的Set集合，即当自身发生变化时,可能会影响到的其他对象
        deps: new Set<string>(),
      },
    });
    console.log('makeProxy', obj);
    return new Proxy(obj, {
      get(target, prop) {
        const value = target[prop];
        if (typeof value !== 'object' || value === null || Reflect.getOwnPropertyDescriptor(value, SymObjectObserver)) {
          return value;
        }
        target[prop] = _this.makeProxy(value);
        return target[prop];
      },
      set(target, prop, value) {
        if (target[prop] === value) return true;
        if (typeof value !== 'object' || value === null || Reflect.getOwnPropertyDescriptor(value, SymObjectObserver)) {
          target[prop] = value;
          return true;
        }
        target[prop] = _this.makeProxy(value);
        return true;
      },
    });
  }
})();

// const globalScope = new WorkerScope('globalScope',{},undefined)
