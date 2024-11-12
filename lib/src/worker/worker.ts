import { MainMessage } from "message";
import { NetUtils } from "../common";
import { Logger } from "../logger";
import { WorkerComponent } from "./workerComponents";
import { workerMeta } from "./workerMeta";

const log = Logger("WOO:Worker")
log.debug("Worker init")


/**
 * 设置和解析全局Meta属性
 */
MainMessage.setGlobalMeta.on(async (data) => {
    if (data.htmlUrl) workerMeta.setHomeUrl(data.htmlUrl)
    workerMeta.setMeta(data.meta)
    return {}
})


/**
 * 加载元素
 */

MainMessage.loadComponent.on(async (data) => {
    let tag = workerMeta.normalizeTag(data.tag,data.relUrl)
    log.warn("==> start LoadElem:",data.tag, tag, data.attrs)

    
    // 创建Worker组件实例
    let htmlBuilder: string[] = []
    const comp = new WorkerComponent(tag, data.attrs)
    await comp.load()
    comp.renderContentHtml(htmlBuilder)

    let result =  { tag, attrs: comp.rootAttrs(), content: htmlBuilder.join('') }
    log.warn("==> end LoadElem:",result)
    

    return result;
})

// message.on("M:LoadComponent", async (data) => {
//     let tag = workerMeta.normalizeTag(data.tag,data.relUrl)
//     log.warn("==> start LoadElem:",data.tag, tag, data.attrs)

    
//     // 创建Worker组件实例
//     let htmlBuilder: string[] = []
//     const comp = new WorkerComponent(tag, data.attrs)
//     await comp.load()
//     comp.renderContentHtml(htmlBuilder)

//     let result =  { tag, attrs: comp.rootAttrs(), content: htmlBuilder.join('') }
//     log.warn("==> end LoadElem:",result)
    

//     return result;
// })

