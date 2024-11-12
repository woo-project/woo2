// 定义woo使用的各种元数据

export const WooMeta = {
  // 定义woo加载事件的名称,默认为DOMContentLoaded
  loadEvent: {
    name: 'woo-load-event',
    content: 'DOMContentLoaded',
  },
  // 加载Dom元素时自动隐藏,对首页和所有元素生效
  loadCloak: {
    name: 'woo-load-cloak',
    content: '1',
  },
  // 加载进度条,是否显示元素加载的进度条，对所有
  loadProgress:{
    name:'woo-load-progress',
    content:'woojs-woo.progress', // 默认进度条标签名称
    delay:'1000', // 设置显示进度条的超时时间
  }
};
