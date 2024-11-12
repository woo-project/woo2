// 主线程处理消息

import { DomUtils } from "./mainDomUtils";
import { Logger } from "../logger";
import { BaseComponent, MainComponent } from "./mainComponent";
import { WorkerMessage } from "message";
const log = Logger('WOO:MainMessage')

WorkerMessage.templateParse.on(async (data) => {
    // 使用模板解析器解析模板
    let tpl = document.createElement('template')
    tpl.innerHTML = data.text
    let elem = tpl.content.firstElementChild as HTMLElement
    if (!elem) throw new Error('TemplateParse: no element')
    
    return { tpl: DomUtils.elToJson(elem) }
})

// message.on('W:TemplateParse', async (data) => {

//     // 使用模板解析器解析模板
//     let tpl = document.createElement('template')
//     tpl.innerHTML = data.text
//     let elem = tpl.content.firstElementChild as HTMLElement
//     if (!elem) throw new Error('TemplateParse: no element')
    
//     return { tpl: DomUtils.elToJson(elem) }
// })

/**
 * 工作线程在解析模板时，如果发现新的tag,则发送此消息请求主线程预加载元素
 * 主线程检测此标签是否已经注册,如果未注册,则加载元素
 */
WorkerMessage.registerComponent.on(async (data) => {

    // 此元素已经注册,不做处理，也可能是第三方组件
    let cls = customElements.get(data.tag)
    if(cls && !(cls instanceof BaseComponent)){
        log.debug('skip third party component:',data.tag)
        return {}
    }

    let comp = new MainComponent(data)
    await comp.waitLoad()
    log.warn("=============>>>>",comp.tag,comp.attrs)

    return {
        elem:{
            tag:comp.tag,
            attrs:comp.attrs
        }
    }
})

// message.on('W:RegisterComponent', async (data) => {
//     // 此元素已经注册,不做处理，也可能是第三方组件
//     let cls = customElements.get(data.tag)
//     if(cls && !(cls instanceof BaseComponent)){
//         log.debug('skip third party component:',data.tag)
//         return {}
//     }

//     let comp = new MainComponent(data)
//     await comp.waitLoad()
//     log.warn("=============>>>>",comp.tag,comp.attrs)

//     return {
//         elem:{
//             tag:comp.tag,
//             attrs:comp.attrs
//         }
//     }
// })