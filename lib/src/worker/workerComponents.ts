import { WorkerMessage } from 'message';
import { IElemJson, JsUtils, NetUtils } from '../common';
import { Logger } from '../logger';
import { workerMeta } from './workerMeta';
import { WorkerScope } from './workerScope';

// Worker 线程加载Components
const log = Logger('WOO:WorkerComponent');

const SelfClosedTagSet = new Set([
  'img',
  'input',
  'br',
  'hr',
  'meta',
  'link',
  'base',
  'area',
  'col',
  'command',
  'embed',
  'keygen',
  'param',
  'source',
  'track',
  'wbr',
]);

interface ITplDescriptor {
  rootElem: IElemJson;
  relUrl: string;
}
const tplRegistry = new (class TplRegistry {
  private _tplRegistry = new Map<string, ITplDescriptor>();

  async get(tag: string): Promise<ITplDescriptor> {
    if (!this._tplRegistry.has(tag)) {
      let relPrefix = workerMeta.tagPathPrefix(tag);
      let tplUrl = relPrefix + '.html';
      let html = await NetUtils.httpGetText(tplUrl);
      let result = await WorkerMessage.templateParse.send({ text: html });
      
      this._tplRegistry.set(tag, {
        rootElem: result.tpl,
        relUrl: relPrefix,
      });
    }
    return this._tplRegistry.get(tag)!;
  }
})();

// cid => WorkerComponent Map
export const workerComponentRegistry = new Map<string, WorkerComponent>();

type IScope = { [k: string]: any };

/**
 * 属性处理的计算模式:
 * $attr: 值绑定,内容为计算表达式的结果
 * :attr: 模板绑定,内容为模板字符串,在CSS中支持"$" 和 ':' 表示的计算模式
 * attr.type: 类型绑定,值为自动转换字符串的结果,支持:int,float,bool,object,array,obj,str,string等
 * attr: 默认为静态字符串绑定
 */
class WAttr {
  name = '';
  private _dirty = true;
  private _value = '' as any;
  private _computeFunc?: Function;
  constructor(private _elem: WElem, private _tplName: string, private _tplValue: string) {
    try {
      if (_tplName.startsWith('$')) {
        // 值绑定
        this._computeFunc = new Function('$scope', '$el', `with($scope){return ${_tplValue}}`);
      } else if (_tplName.startsWith(':')) {
        // 模板绑定
        this._computeFunc = new Function('$scope', '$el', `with($scope){return \`${_tplValue}\`;}`);
      } else if (_tplName.startsWith('@')) {
        this._computeFunc = new Function('$scope', '$el', '$ev', `with($scope){${_tplValue};}`);
      }
    } catch (e: any) {
      log.warn('Error create compute function:', _tplName, _tplValue, e.message);
    }

    this.name = this._computeFunc ? this._tplName.slice(1) : _tplName;
    this._value = this._tplValue;
    this._dirty = this._computeFunc ? true : false;
  }
  // 计算属性值
  private _computeValue() {
    if (this._computeFunc) {
      try {
        let rt = this._computeFunc(this._elem.scope);
        this._value = rt;
      } catch (e: any) {
        log.error('Error compute attr:', this._elem.tag, this._tplName, this._tplValue, e.message);
        log.error('Function:', this._computeFunc.toString());
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
  setValue(v: any) {
    log.warn('==>>>???? setValue: ', v);
    this._value = v;
  }

  invalidate() {
    this._dirty = true;
  }
}
class WTextNode {
  private _value = '' as any;
  private _computeFunc?: Function;

  /**
   * @param _tplText 模板字符串
   * @param calcMode 计算模式,取值 "$"或':',代表值绑定或者模板绑定
   */
  constructor(private _elem: WElem, private _tplText: string, calcMode?: string) {

    try {
        if (calcMode == '$') {
          // 值绑定
          this._computeFunc = new Function('$scope', '$el', `with($scope){return ${_tplText}}`);
        } else if (calcMode == ':') {
          // 模板绑定
          this._computeFunc = new Function('$scope', '$el', `with($scope){return \`${_tplText}\`;}`);
        } else{
            this._value = _tplText;
        }
      } catch (e: any) {
        log.warn('Error create compute function:', _tplText, e.message);
      }

  }

  get value() {
    if (this._computeFunc) {
      try {
        let rt = this._computeFunc(this._elem.scope);
        this._value = rt;
      } catch (e: any) {
        log.error('Error compute text:', this._elem.tag, this._tplText, e.message);
        log.error('Function:', this._computeFunc.toString());
      }
    }
    return this._value;
  }

}

class WEvent {
  constructor(private _elem: WElem, private _eventName: string, private _tplEvent: string) {}
}

// 一次性将变动内容和需要变动的组件和组件内部数据全部计算,一次性更新
/**
 * WebComponent元素,处理WebComponent元素的加载和渲染
 * 跟踪元素作用域的变化依赖,并计算依赖属性的变化,更新元素的属性和内容
 */
class WElem {
  private _tag: string;
  private _attrs: { [k: string]: WAttr } = {};
  private _events: WEvent[] = [];
  private _children: (WElem | WTextNode)[] = [];
  // 创建作用域对象,每个元素的scope中保存元素的动态属性,不包括静态属性

  private _loadPromises: Promise<void>[] = [];
  private _contentCalcMode = '';

  private _scope: WorkerScope & { [k: string]: any };

  // 从ElemJson构造WElem
  constructor(private _componentRoot: WorkerComponent, private _parentElem: WElem | undefined, tplElem: IElemJson) {
    this._tag = tplElem.tag;

    // 初始化scope
    this._scope = Object.create(_parentElem?.scope || _componentRoot.workScope.rootScope);

    // 解析和处理属性
    this._initAttrs(tplElem);

    // 处理子元素
    this._initChildContent(tplElem);

    // 加载自定义组件
    if (this._tag.includes('-')) {
      // 检测当前自定义的组件是否已经注册
      this._loadPromises.push(this._loadWebComponentElem());
    }
  }

  private _initAttrs(tplElem: IElemJson) {
    JsUtils.objectForEach(tplElem.attrs, (v, k) => {
      // 检测元素内容计算模式
      if (k == '$' || k == ':') {
        // 内容计算模式
        this._contentCalcMode = k;
        return;
      }
      let att = new WAttr(this, k, v);
      if (att.name) {
        this._attrs[att.name] = att;
        if (att.isDynamic) {
          // 动态属性,为作用域添加get属性
          this._scope[att.name] = att.value;
        }
      }
    });

    // 根元素不设置eid,因为根元素的eid由外部组件分配
    if (this._parentElem) this._attrs['_eid'] = new WAttr(this, '_eid', this._componentRoot.newEid(this).toString());
  }

  private _initChildContent(tplElem: IElemJson) {
    tplElem.children.forEach((child) => {
      if (typeof child === 'string') {
        // 文本节点
        this._children.push(new WTextNode(this, child, this._contentCalcMode));
      } else {
        let elem = new WElem(this._componentRoot, this, child);
        this._children.push(elem);
        if (elem.tag.includes('-')) this._loadPromises.push(elem.waitLoad());
      }
    });
  }

  private async _loadWebComponentElem() {
    // 检测是否符合组件自定义标签规范
    // 首先查找是否已经注册
    // 如果未注册则请求主线程确定是否自定义组件已经注册(可能第三方已经注册),并注册和加载组件
    let result = await WorkerMessage.registerComponent.send({
  
      relUrl: this._componentRoot.relUrl,
      tag: this._tag,
      attrs: JsUtils.objectMap(this._attrs, (v, k) => {
        return v.value;
      }),
    });
    // 如果返回，则代表自定义标签已经完成注册和创建
    if (result.elem) {
      this._tag = result.elem.tag;
      // 更新属性
      JsUtils.objectForEach(result.elem.attrs, (v, k) => {
        if (this._attrs[k]) {
          this._attrs[k].setValue(v);
        } else {
          // 加载子组件可能会产生新属性,此属性不在模板属性中,保存为标准静态模板属性
          this._attrs[k] = new WAttr(this, k, v);
        }
      });
    }
  }

  get tag() {
    return this._tag;
  }

  get scope() {
    return this._scope;
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
  renderOuterHtml(outStringBuilder: string[], includeChilds: boolean = true) {
    outStringBuilder.push(
      `<${this._tag} `,
      ...JsUtils.objectMapToArray(this._attrs, (attr) => {
        return `${attr.name}="${attr.value}" `;
      }),
      '>'
    );
    if (includeChilds) this.renderInnerHtml(outStringBuilder);
    outStringBuilder.push(`</${this._tag}>`);
  }
  // 生成所有子元素的HTML
  renderInnerHtml(outStringBuilder: string[]) {
    this._children.forEach((child) => {
      if (child instanceof WTextNode) {
        outStringBuilder.push(child.value);
      } else {
        child.renderOuterHtml(outStringBuilder);
      }
    });
  }
  // get scope() {
  //     return this._workScope
  // }
  get indentify() {
    return `${this._componentRoot.indentify}|<${this._tag} eid=${this._attrs['_eid']}>`;
  }
}

export class WorkerComponent {
  private _eidMap = new Map<string, WElem>();
  private _cid = '';
  private _eidCounter = 0;

  // WebComponent内部根元素
  private _interRootElem?: WElem;
  private _relUrl = '';
  // 根作用域
  private _workScope = new WorkerScope(this.indentify, {});

  constructor(public rootTag: string, private _attrs: { [k: string]: string }) {
    this._cid = _attrs['_cid'];
    if (!this._cid) throw new Error('WorkerComponent must have _cid attribute');
    workerComponentRegistry.set(this._cid, this);
  }
  get workScope() {
    return this._workScope;
  }
  newEid(elem: WElem) {
    let eid = `${this._cid}:${this._eidCounter++}`;
    this._eidMap.set(eid, elem);
    return eid;
  }
  get indentify() {
    return `<${this.rootTag} cid="${this._cid}">`;
  }

  // 加载组件
  async load() {
    // 加载组件
    let tpl = await tplRegistry.get(this.rootTag);
    this._relUrl = tpl.relUrl;

    if (tpl.rootElem.tag != 'template') {
      log.error('load component:', this.rootTag, '"root element must be <template>"');
      return;
    }
    this._interRootElem = new WElem(this, undefined, tpl.rootElem);
    return this._interRootElem.waitLoad();
  }
  get relUrl() {
    return this._relUrl;
  }

  // 获取根元素的属性
  rootAttrs() {
    let rootAttrs = this._interRootElem?.attrsValue() || {};
    // 如果组件传入属性不在rootElem中,则添加到rootElem中
    JsUtils.objectForEach(this._attrs, (v, k) => {
      if (!rootAttrs[k]) {
        rootAttrs[k] = v;
      }
    });

    return rootAttrs;
  }
  renderContentHtml(outStringBuilder: string[]) {
    // 渲染内容
    this._interRootElem?.renderInnerHtml(outStringBuilder);
  }
}
