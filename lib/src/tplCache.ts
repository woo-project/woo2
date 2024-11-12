// 缓存解析过的模板,保存在IndexedDB中

import { Logger } from "./logger";

const log = Logger('WOO:TplCache')

export class TplCache{
    db?:IDBDatabase;

    private _waitOpen:Promise<any> 

    constructor(){
        console.log('TplCache.constructor', this);
       this._waitOpen =  this.open();
    }
    async open(){
        if(this.db) return;
        
        return new Promise((res,rej)=>{
            const request = indexedDB.open('woo-tpl-cache',1);
            request.onerror = (e)=>{
                log.error('open tpl db', e);
                rej(e);
            }
            request.onsuccess = (e)=>{
                this.db = request.result;
                log.info('open tpl db', e.type);
                res(e);
            }
            request.onupgradeneeded = (e)=>{
                this.db = request.result;
                log.warn('create tpl db', e.type);
                if(!this.db.objectStoreNames.contains('tpl')){
                    this.db.createObjectStore('tpl',{keyPath:'src'});
                }
            }
        });
    }

    async set(src:string, tpl:any){
        await this._waitOpen;
        return new Promise((res,rej)=>{
            if(!this.db) {rej("db not open");return;};
            const transaction = this.db.transaction(["tpl"], "readwrite");
            const store = transaction.objectStore("tpl");
            const request = store.put({src, tpl});
            request.onsuccess = (e)=>{
                log.info('set tpl', src);
                res(e);
            }
            request.onerror = (e)=>{
                log.error('set tpl', src, e);
                rej(e);
            }
        })
    }

    async get(src:string){
        await this._waitOpen;
        return new Promise<string>((res,rej)=>{
            if(!this.db) {rej("db not open");return;};
            const transaction = this.db.transaction(["tpl"], "readonly");
            const store = transaction.objectStore("tpl");
            const request = store.get(src);
            request.onsuccess = (e)=>{
                log.info('get tpl', src);
                res(request.result);
            }
            request.onerror = (e)=>{
                log.error('get tpl', src, e);
                rej(e);
            }
        })
    }



}

export const tplCache = new TplCache();