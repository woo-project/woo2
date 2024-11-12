import { IElemJson } from "../common";

const _LOCAL_TAG_PREFIX = 'self'


export const workerMeta = new class WorkerMeta {
    npmUrl = '/node_modules/'
    homeUrl='/'
    constructor() {
    }

    normalizeTag(tag: string,relUrl:string) {
        if(tag.includes('.')) return tag
        // 为tag添加默认的前缀
        if( relUrl.match(/^https?:\/\//) != null){
                return _LOCAL_TAG_PREFIX+'.' + tag
        }
        else{
            // Npm包路径
            return relUrl.replace(/-/,'_').replace(/@/,'').replace(/\//g,'-') + '.' + tag
        }    
    }
    // 从标签名转换为组件路径前缀
    tagPathPrefix(tag: string) {
        let [s1,s2] = tag.split('.')
        // s2为标签名,替换'-'为'/',替换'_'后面字母为大写,如果最后一个字符为'-',则删除
        if(s2.endsWith('-')) s2 = s2.slice(0,-1)
        const path = s2.replace(/-/g, '/').replace(/_(\w)/g, (_, s) => s.toUpperCase())

        if(s1 == _LOCAL_TAG_PREFIX){
            // 去除pathname文件名，保留路径
            return this.homeUrl  + path;
            
        }else{
            // 以npm包为根目录,获取组件路径,'-'分割 @scope/package, '_'转换为原始文件名中的'-'
            let pkg = s1.replace(/-/g, '/').replace(/_/g,'-');
            if(pkg.includes('/')) pkg = '@'+pkg;

            return this.npmUrl + pkg + '/' + path
        }
    }
    setHomeUrl(url: string) {
        this.homeUrl = url.replace(/[^/]*$/, '');
    }

    setMeta(meta: IElemJson[]) {
    }
}