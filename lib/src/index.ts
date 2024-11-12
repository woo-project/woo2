import './message'
import { MainComponent, mainLoadDocument } from "./main/mainComponent";
import pkg from '../package.json'
import "./workerLoader"
import "./main/mainMessage"
import { Logger } from 'logger';
import { WooMeta } from 'wooMeta';

console.log('Power By ', pkg.name, pkg.version);
const log = Logger("woo:index")

// 为避免启动时的闪烁,html可通过 <style> 标签初始化隐藏body对象




mainLoadDocument()

// 开发模式处理HotReload
new EventSource('/esbuild').addEventListener('change', (ev) => {
    log.warn('esbuild ---> change', ev)
})
// 获取当前脚本的路径
export default {}

