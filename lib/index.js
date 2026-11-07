// dsh-ref-autofill · Host 半边。
// 这个插件的能力全在浏览器半边（lib/client.js）：它自己挂载悬浮面板、拉取图库数据、
// 往 DSH 输入框填图和文字。Host 侧不需要注册服务、工具或路由，这里只提供一个空插件，
// 让 bundle 能在 dsh 的插件树里被加载，并把 dsh.client 声明的浏览器半边带进 web 端。
export const name = 'ref-autofill'

export function apply() {
  // 无需 Host 侧初始化。
}
