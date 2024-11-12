
// 实现一个简单的defer, 并可以测量函数执行时间
export class Defer<T> {
  private _resolve: Function;
  private _reject: Function;
  private _state: 'pending' | 'resolved' | 'rejected' = 'pending';
  private _promise: Promise<T>;
    private _start: number;
    private _end: number;
    private _duration: number;
    constructor() {
        this._promise = new Promise((resolve, reject) => {
            this._resolve = resolve;
            this._reject = reject;
            this._start = Date.now();
        });
    }

    resolve(value: T) {
        if(this._state !== 'pending') throw new Error(`Defer has already been ${this._state}!`);
        this._state = 'resolved';
        this._end = Date.now();
        this._duration = this._end - this._start;
        this._resolve(value);
    }
    reject(reason: any) {
        if(this._state !== 'pending') throw new Error(`Defer has already been ${this._state}!`);
        this._state = 'rejected';
        this._end = Date.now();
        this._duration = this._end - this._start;
        this._reject(reason);
    }
    get state() {
        return this._state;
    }
    get promise() {
        return this._promise;
    }
    get duration() {
        return this._duration;
    }
}