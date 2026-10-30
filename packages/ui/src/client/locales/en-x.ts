/** 设置里的 X 账号和 X 写操作审批卡的英文译文，键是代码里的中文原文。 */
export const UI_EN_X: Readonly<Record<string, string>> = {
  'X 账号': 'X account',
  '未登录': 'Signed out',
  '账号受限': 'Restricted',
  '检查出错': 'Check failed',
  '登录': 'Sign in',
  '检查': 'Check',
  '（{name}）': ' ({name})',
  'bot 用这个账号读写 X、读私信和加密聊天{name}': 'Bots read and write on X, and read DMs and encrypted chats, as this account{name}',
  'dsh-bot 的浏览器里没登录 X：点“登录”在浏览器里登录，登录好回来点“检查”': "Not signed in to X in dsh-bot's browser: click “Sign in” to sign in there, then come back and click “Check”",
  'bot 读写 X、读私信和加密聊天用 dsh-bot 浏览器里登录的 X 账号；点“检查”看看登录的是谁': "Bots read and write on X, and read DMs and encrypted chats, as the X account signed in to dsh-bot's browser; click “Check” to see which one",
  'X 写操作': 'X write actions',
  'bot 用 X 账号做改东西的事时（发推、删推、点赞、关注……）；和浏览器站点规则里的 x.com 是同一条。免审批只管发推、点赞、关注这类常用操作，别的照样先给你看；dsh web 对外开放时一律不做':
    "When bots change things with the X account (post, delete, like, follow…). This is the same setting as x.com in the browser's site rules. No approval only covers common actions such as posting, liking and following; anything else is still shown to you first. Never done while dsh web is exposed",
  'X 账号：@{handle}': 'X account: @{handle}',
  '批准后 dsh-bot 用浏览器里登录的 X 账号按原样执行，结果发回给 bot。': "Once approved, dsh-bot does exactly this with the X account signed in to its browser and sends the result to the bot.",
}
