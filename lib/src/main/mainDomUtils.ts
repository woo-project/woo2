import { IElemJson } from '../common';

export const DomUtils = {
  isUnregisterWebComponentTag(tag: string) {
    return tag.includes('-') && !customElements.get(tag);
  },

  deepChildElement(parent: HTMLElement, callback: (el: HTMLElement) => void | Promise<void>) {
    const promises = [] as Promise<void>[];
    for (let i = 0; i < parent.children.length; i++) {
      const el = parent.children[i] as HTMLElement;
      const rt = callback(el);
      if (rt) promises.push(rt);
      this.deepChildElement(el, callback);
    }
    return Promise.all(promises);
  },
  elemAttrs(el: Element) {
    let attrs = {} as any;
    for (let i = 0; i < el.attributes.length; i++) {
      const attr = el.attributes[i];
      attrs[attr.name] = attr.value;
    }
    return attrs;
  },
  elToJson(el: Element, filter?: (el: Element) => boolean): IElemJson {
    return {
      tag: el.tagName.toLowerCase(),
      attrs: this.elemAttrs(el),
      children: (el instanceof HTMLTemplateElement ? Array.from(el.content.childNodes) : Array.from(el.childNodes))
        .map((node) => {
          if (node instanceof Text && node.nodeValue!.trim().length > 0) {
            return node.nodeValue?.trim();
          } else if (node instanceof Element) {
            if (filter && !filter(node)) return null;
            return this.elToJson(node, filter);
          }
        })
        .filter((v) => v != null) as IElemJson[],
    };
  },
  renameElemTag(el: Element, newTag: string) {
    const newEl = document.createElement(newTag);
    for (let i = 0; i < el.attributes.length; i++) {
      const attr = el.attributes[i];
      newEl.setAttribute(attr.name, attr.value);
    }
    Array.from(el.childNodes).forEach((node) => newEl.appendChild(node));
    el.replaceWith(newEl);
    return newEl;
  },
};
