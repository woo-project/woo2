import { Logger } from "./logger";

const log = Logger("WOO:Utils")


export const PromiseExt = {
  /**
   * 超时Promise
   * @param promise
   * @param timeoutMs
   * @returns
   */
  timeout(promise: Promise<any>, timeoutMs: number) {
    return Promise.race([
      promise,
      new Promise((res, rej) => {
        setTimeout(() => {
          rej("timeout");
        }, timeoutMs);
      }),
    ]);
  },

  wait(timeoutMs: number) {
    return new Promise(res => {
      setTimeout(res, timeoutMs);
    });
  }
};


/**
 * Defer 异步 Promise 
 */
export class Defer<T = any> {
  private _res: (value: T) => void = () => { };
  private _rej: (reason: any) => void = () => { };
  private _promise

  constructor(public name?: string, private _timeoutMs = -1) {
    let p = new Promise<T>((res, rej) => {
      this._res = res;
      this._rej = rej;
    })
    this._promise = _timeoutMs > 0 ? PromiseExt.timeout(p, _timeoutMs) : p

  }
  async result(timeout: number = -1) {
    if (timeout > 0) {
      return PromiseExt.timeout(this._promise, timeout)
    }
    return this._promise;
  }
  reslove(result: any) {
    // log.info('Defer.reslove', this._name, result)
    this._res(result);
  }
  reject(reason: any) {
    // log.error('Defer.reject', this._name, reason)
    this._rej(reason);
  }
}

export const NetUtils = {
  async httpGetText(url: string) {
    return fetch(url).then(res => {
      if (res.ok) {
        return res.text()
      } else {
        throw new Error(`${res.status} ${res.statusText}: ${url}`)
      }
    })
  },
  async httpGetJson(url: string) {
    return JSON.parse(await this.httpGetText(url))
  }
}



export const isWorker = !self.window

export interface IElemJson {
  tag: string
  attrs: { [k: string]: string }
  children: (IElemJson | string)[]
}

export const JsUtils = {

  /**
   * 对象映射,过滤undefined
   * @param obj 
   * @param fn 
   * @returns 
   */
  objectMap<T extends { [k: string]: any }, R> (obj: T, fn: (v: T[string], k: string) => R): { [k in keyof T]:NonNullable<R> } {
    let newObj = {} as any
    for (let k of Object.keys(obj)) {
      let v = fn(obj[k], k)
      if (v !== undefined) newObj[k] = v
    }
    return newObj
  },

  objectMapToArray<T extends { [k: string]: any }, R>(obj: T, fn: (v: T[string], k: string) => R): NonNullable<R>[] {
    let arr = [] as any[]
    for (let k of Object.keys(obj)) {
      let v = fn(obj[k], k)
      if (v !== undefined) arr.push(v)
    }
    return arr 
  },
  objectForEach<T extends { [k: string]: any }>(obj: T, fn: (v: T[string], k: string) => void) {
    for (let k of Object.keys(obj)) {
      fn(obj[k], k)
    }
  },
  isClass(obj: any):boolean {
    if(!(typeof obj === 'function')) return false
    try{
      let tmp = class extends obj{}
      return true
    }catch(e){
      return false
    }
  },




}

