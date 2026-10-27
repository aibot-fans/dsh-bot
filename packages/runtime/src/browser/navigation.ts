import { t } from 'pod-domain'
/** 打不开网页：网站或网络的问题，不是浏览器卡住了；接口直接把这句话给你看，不再加“浏览器没有响应”。 */
export class NavigationError extends Error {}

/** Chrome 常见的网络错误码，翻成一句能照着处理的话。 */
const NET_ERRORS: Readonly<Record<string, string>> = {
  'net::ERR_NAME_NOT_RESOLVED': '找不到这个网站（域名解析失败），检查一下网址',
  'net::ERR_NAME_RESOLUTION_FAILED': '找不到这个网站（域名解析失败），检查一下网址或网络',
  'net::ERR_INTERNET_DISCONNECTED': '现在没有网络',
  'net::ERR_NETWORK_CHANGED': '网络刚切换过，再试一次',
  'net::ERR_CONNECTION_REFUSED': '网站拒绝了连接',
  'net::ERR_CONNECTION_TIMED_OUT': '连接网站超时',
  'net::ERR_TIMED_OUT': '连接网站超时',
  'net::ERR_CONNECTION_RESET': '连接被网站或网络断开了',
  'net::ERR_CONNECTION_CLOSED': '连接被网站或网络断开了',
  'net::ERR_EMPTY_RESPONSE': '网站什么都没返回',
  'net::ERR_PROXY_CONNECTION_FAILED': '连不上代理，检查一下代理设置',
  'net::ERR_TUNNEL_CONNECTION_FAILED': '代理连不上这个网站',
  'net::ERR_TOO_MANY_REDIRECTS': '网站来回跳转太多次',
  'net::ERR_BLOCKED_BY_CLIENT': '这个网址指向本机或局域网，被 dsh-bot 拦下了；确实要访问的话加进设置里的白名单',
  'net::ERR_BLOCKED_BY_RESPONSE': '网站不允许在这里打开',
  'net::ERR_SSL_PROTOCOL_ERROR': '网站的安全连接出错',
  'net::ERR_HTTP2_PROTOCOL_ERROR': '网站返回的内容有问题，刷新试试',
  'net::ERR_ABORTED': '网页没有打开：网站没返回页面（比如只是个空响应），或者打开过程被别的跳转打断了',
}

export function describeNetError(code: string): string {
  if (code.startsWith('net::ERR_CERT_')) return t('网站的证书有问题，浏览器不信任它')
  return t(NET_ERRORS[code] ?? '打不开这个网页')
}
