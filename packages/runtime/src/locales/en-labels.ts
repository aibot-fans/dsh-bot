/**
 * pod-runtime 里按常量查表再翻译的文字（例程状态、任务控制、页面里的固定标签、aibot 和网络报错）的英文译文。
 * 这些原文写在常量里，t() 拿到的是变量，扫描 t('…') 找不到，所以单独列在这里。
 */
export const RUNTIME_EN_LABELS: Readonly<Record<string, string>> = {
  // 分隔符
  '；': '; ',
  // 任务
  '任务已经完成': 'The task is already done',
  '「{title}」已暂停': '“{title}” paused',
  '「{title}」已继续': '“{title}” resumed',
  '「{title}」已停止': '“{title}” stopped',
  '「{title}」已取消': '“{title}” cancelled',
  // 例程状态
  '已运行': 'Ran',
  '没有变化': 'No change',
  '第一次读取，记下了当前内容': 'First read; saved the current content',
  '内容变了，已交给 bot 分析': 'Content changed; sent to the bot for analysis',
  '负责的 bot 已归档，没有运行': 'The assigned bot is archived; did not run',
  // 页面里的固定标签
  '提示': 'Note',
  '好消息': 'Good news',
  '注意': 'Caution',
  '警告': 'Warning',
  '已完成': 'Done',
  '未开始': 'Not started',
  '有风险': 'At risk',
  // aibot
  '正在开通 aibot': 'Setting up aibot',
  '这个网络今天开通的设备太多，明天再试': 'Too many devices on this network signed up today; try again tomorrow',
  '现在开通的人太多，稍后再试': 'Too many people are signing up right now; try again later',
  'aibot 暂时不能开通': 'aibot signup is temporarily unavailable',
  '今天的免费次数用完了，明早 8 点恢复': "Today's free calls are used up; they reset at 8:00 tomorrow (Beijing time)",
  '这个网络今天使用 aibot 免费额度的设备太多，明早 8 点恢复': "Too many devices on this network used aibot's free quota today; it resets at 8:00 tomorrow (Beijing time)",
  'aibot 今天的免费额度已经发完，明早 8 点恢复': "aibot's free quota for today is used up; it resets at 8:00 tomorrow (Beijing time)",
  'aibot 免费额度暂时不可用': "aibot's free quota is temporarily unavailable",
  '这台电脑上 dsh-bot 的 aibot 接入已被停用': "dsh-bot's aibot access has been disabled on this computer",
  '绑定账号还没开放': "Account linking isn't available yet",
  '这台电脑上的 dsh-bot 已经绑定过账号了': 'dsh-bot on this computer is already linked to an account',
  '申请太频繁了，过一小时再试': 'Too many requests; try again in an hour',
  '绑定失败：{message}': 'Linking failed: {message}',
  // 打开网页时的网络错误
  '找不到这个网站（域名解析失败），检查一下网址': "Couldn't find this site (DNS lookup failed). Check the URL",
  '找不到这个网站（域名解析失败），检查一下网址或网络': "Couldn't find this site (DNS lookup failed). Check the URL or your network",
  '现在没有网络': 'No internet connection',
  '网络刚切换过，再试一次': 'The network just changed; try again',
  '网站拒绝了连接': 'The site refused the connection',
  '连接网站超时': 'Connecting to the site timed out',
  '连接被网站或网络断开了': 'The connection was closed by the site or the network',
  '网站什么都没返回': 'The site returned nothing',
  '连不上代理，检查一下代理设置': "Can't reach the proxy. Check your proxy settings",
  '代理连不上这个网站': "The proxy can't reach this site",
  '网站来回跳转太多次': 'The site redirected too many times',
  '这个网址指向本机或局域网，被 dsh-bot 拦下了；确实要访问的话加进设置里的白名单':
    'This URL points to this computer or the local network, so dsh-bot blocked it. To allow it, add it to the allowlist in Settings',
  '网站不允许在这里打开': "The site doesn't allow being opened here",
  '网站的安全连接出错': "The site's secure connection failed",
  '网站返回的内容有问题，刷新试试': 'The site returned something invalid; try reloading',
  '网页没有打开：网站没返回页面（比如只是个空响应），或者打开过程被别的跳转打断了':
    "The page didn't open: the site returned no page (for example an empty response), or loading was interrupted by another redirect",
  '打不开这个网页': "Couldn't open this page",
  // 界面里也有的短句：宿主和页面各登记各的，这里再写一份
  '截图': 'Take a screenshot',
  '后退': 'Go back',
  '页面': 'Page',
  '新建': 'Created',
  '为什么要审批：{reason}': 'Why approval is needed: {reason}',
  '符合任务说明': 'matches the task',
  '可能不符合任务说明': 'may not match the task',
  '（{reason}）': ' ({reason})',
  '找不到这个对话': 'Chat not found',
  '新对话': 'New chat',
  '删除': 'Deleted',
  '备注': 'Notes',
  '返回': 'Back',
  '已处理：{title}': 'Handled: {title}',
  '第 {version} 版 · {time}{latest}': 'v{version} · {time}{latest}',
  '（最新是第 {version} 版）': ' (latest is v{version})',
}
