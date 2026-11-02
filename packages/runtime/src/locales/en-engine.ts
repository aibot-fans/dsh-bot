/** V3 引擎、副作用队列、系统问题这一块的英文译文。 */
export const RUNTIME_EN_ENGINE: Readonly<Record<string, string>> = {
  '副作用队列出错': 'The effect queue had an error',
  '{what}连续失败：{error}': '{what} keeps failing: {error}',
  '开任务会话': 'Opening task sessions',
  '把消息交给会话': 'Handing messages to sessions',
  '转交消息': 'Relaying messages',
  '发通知': 'Sending notifications',
  '往聊天室发消息': 'Posting to chat rooms',
  '自动来源的判断': 'Judging automatic sources',
  '会话停了': 'The session was stopped',
  '会话已不在': 'The session no longer exists',
  '另一个 dsh-bot（进程 {pid}）正在用同一份数据，这里只读，免得两边同时写。关掉那一个以后重启 dsh web。':
    'Another dsh-bot (process {pid}) is using the same data, so this one is read-only to avoid two writers. Close the other one, then restart dsh web.',
}
