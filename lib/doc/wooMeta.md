
## WOO 支持的 <meta> 字段

### HTML 主入口


### woo-load-event
```html
<meta name="woo-load-event" content="DOMContentLoaded">
```
- 说明： 指定触发WOO加载页面的事件，默认为DOMContentLoaded
当与第三方组件库共同使用时，需保证第三方组件库的初始化在WOO之前完成。
此时可以通过修改此字段来调整WOO的初始化时机，在第三方组件库初始化完成后再初始化WOO。

