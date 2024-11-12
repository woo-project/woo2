/**
 * Logger 处理，开发模式，直接绑定console.log，显示源码
 * 运行模式：绑定函数，显示时间戳，搜集日志，发送到日志服务器
 * 通过 window.error 处理全局异常, 自动计算时间
 * @param exportsObj
 * @returns
 */


// const metaDebug = self.document?.head?.querySelector('meta[name=debug]');

let loggerlastTm = -1;

const enableDebug = !!(globalThis?.localStorage?.getItem('__DEV'));

/**
 *
 * @param mod 使用 this 指针或者字符串
 * @param pkg 包名
 * @returns log
 */
export function Logger(tag: string) {
  const h = Math.round(Math.random() * 360);
  const timeStyle = `color:hsl(${h},100%,40%);font-style: italic;`;
  const fileStyle = `color:hsl(${h},100%,40%);font-weight: 900;font-size:12px;`;

  let thislastTm = -1;
  // 默认显示warn以上级别
  // const DEBUG = (localStorage.getItem('DEBUG') || metaDebug || '').split(';');
  const logList = ['debug', 'log', 'info', 'warn', 'error'];
  function none() {}

  const con = function (...args: any[]) {
    (con as any).log.call(con, ...args);
  };
  Reflect.setPrototypeOf(
    con,
    new Proxy(console, {
      get(t: any, p: string) {
        // 计算时间
        let level = logList.indexOf(p);
        if (level < 0) return t[p]; // 不在LOG定义的方法，返回原始函数

        // debugger;
        if (level <= 2 && !enableDebug) {
           return none; // 低于level 不显示
        }

        let tm = new Date().getTime();
        let spanAll = loggerlastTm > 0 ? tm - loggerlastTm : 0;
        let spanThis = thislastTm > 0 ? tm - thislastTm : 0;
        loggerlastTm = tm;
        thislastTm = tm;
        return (console as any)[p].bind(
          console,
          `%c${p.substring(0, 1).toUpperCase()}|${spanAll}|${spanThis} %c${tag}`,
          timeStyle,
          fileStyle
        );
      },
    })
  );
  return con as any as Console;
}

// 定义全局log对象
(globalThis as any).Logger = Logger;
