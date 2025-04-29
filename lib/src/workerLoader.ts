import { isWorker } from "./common";

export let worker = undefined as Worker | undefined;

if(!isWorker){
    const srcScript = (document.currentScript as HTMLScriptElement).src;
    let workerUrl = srcScript.replace(/index\.js$/, `worker/worker.js?__DEV=${localStorage.__DEV}`)
    console.log('MainWorkerLoader:',srcScript,workerUrl)
    worker =  new Worker(workerUrl,{name:"WooWorker"})
}
