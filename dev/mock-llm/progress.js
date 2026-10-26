/**
 * 执行进度和例程的剧本（开发时看进度块、改例程和数据拦截用；命令都是 sleep、seq、echo 这类无害的）：
 * - “慢慢查”：先想一会儿、用 todo_write 列计划，跑两条带说明的命令，边做边勾计划，最后回答；跑完回复下面留一行摘要。
 * - “绕圈”：连着三次跑同一条命令，进度块出“连着 3 次做同一步”。
 * - “连着出错”：三条命令都失败，出“连着 3 步出错”，再换个办法试一次。
 * - 中途收到“汇报一下进展”（进度块上的「让它汇报」）就说一段进展，结束这一轮。
 * - “每天早上 8 点”：建「早间资讯」（按这一轮判断，之前建过、删过都不影响）。
 * - “改成每半小时”：list_routines 找到「早间资讯」，用 update_routine 改成每 30 分钟。
 * - “半小时后”：建一个只跑一次的例程。
 * - “直接查库”：用命令去碰 pod.db，应该被 Pod 拦下。
 */

/** 这一轮（最后一条有意义的用户消息之后）调用过的工具名。 */
export function turnCalls(messages, isUser) {
  const start = messages.findLastIndex(isUser)
  return messages
    .slice(start + 1)
    .filter((message) => message.role === 'assistant')
    .flatMap((message) => (Array.isArray(message.content) ? message.content : []))
    .filter((block) => block && block.type === 'tool-call')
    .map((block) => block.name)
}

const PLAN = ['找到订单数据', '导出 10 月订单', '数行数并回答']

/** 计划：前 done 项做完，下一项正在做。 */
function plan(done) {
  return { tool: 'todo_write', args: { todos: PLAN.map((content, index) => ({ content, status: index < done ? 'completed' : index === done ? 'in_progress' : 'pending' })) } }
}

function slowQuery(turn) {
  const steps = [
    { ...plan(0), think: '先确认订单数据放在哪个文件里，再按月份导出。数据量不大，导出以后数一下行数就能回答。我先列个计划。' },
    { tool: 'bash', args: { command: 'sleep 4 && ls -la | head -5', description: '查找订单数据放在哪' } },
    plan(1),
    { tool: 'bash', args: { command: 'sleep 6 && seq 1 1200 | wc -l', description: '导出 10 月订单并数行数' }, think: '找到了。导出时要按北京时间切月份，不然月底那天会少算一截。' },
    plan(3),
    { text: '查完了：10 月一共 **1200** 条订单（测试数据）。', think: '行数是 1200，计划都做完了，可以回答了。' },
  ]
  return steps[Math.min(turn.length, steps.length - 1)]
}

function looping(turn) {
  if (turn.length < 3) return { tool: 'bash', args: { command: 'sleep 8 && echo 服务还没起来', description: '看服务起来没有' } }
  return { text: '服务一直没起来，先停在这，等你看一下。' }
}

function failing(turn) {
  if (turn.length < 3) return { tool: 'bash', args: { command: 'sleep 2; echo 连接被拒绝 >&2; exit 1', description: `第 ${turn.length + 1} 次连数据库` } }
  if (turn.length === 3) return { tool: 'bash', args: { command: 'sleep 10 && echo ok', description: '换个端口再试' } }
  return { text: '换了端口以后连上了。' }
}

/** 执行进度的剧本；对不上返回 undefined。 */
export function progressDecision({ userText, turn, tools }) {
  if (!tools.has('bash')) return undefined
  if (userText.includes('汇报一下进展')) return { text: '进展：服务连着三次都没起来，可能是端口被占了。接下来先看端口，再重启服务。' }
  if (userText.includes('慢慢查') && tools.has('todo_write')) return slowQuery(turn)
  if (userText.includes('绕圈')) return looping(turn)
  if (userText.includes('连着出错')) return failing(turn)
  return undefined
}

/** 例程和数据拦截的剧本；result 是上一个工具结果的文字。 */
export function routineDecision({ userText, turn, tools, result }) {
  if (/每天早上 8 点/.test(userText) && tools.has('create_routine')) {
    if (turn.length === 0) return { tool: 'create_routine', args: { title: '早间资讯', prompt: '整理昨晚到今早的资讯，挑 3 条', time: '08:00' } }
    return { text: `好的。${result}` }
  }
  if (/改成每半小时/.test(userText) && tools.has('update_routine')) {
    if (turn.length === 0) return { tool: 'list_routines', args: {} }
    if (turn.at(-1) === 'list_routines') {
      const id = /^- (\S+)「早间资讯」/m.exec(result)?.[1]
      return id === undefined ? { text: `没找到「早间资讯」：${result.slice(0, 80)}` } : { tool: 'update_routine', args: { routine: id, every_minutes: 30 } }
    }
    return { text: `好的。${result}` }
  }
  if (/半小时后/.test(userText) && tools.has('create_routine')) {
    if (turn.length === 0) return { tool: 'create_routine', args: { title: '看一眼早间资讯', prompt: '看一下早间资讯有没有按时触发，没触发就告诉用户', in_minutes: 30 } }
    return { text: `好的。${result}` }
  }
  if (/直接查库/.test(userText) && tools.has('bash')) {
    if (turn.length === 0) return { tool: 'bash', args: { command: 'sqlite3 "$DSH_HOME/pod/pod.db" "select count(*) from routines"', description: '直接查一下例程表' } }
    return { text: `命令被拦下了：${result.slice(0, 120)}` }
  }
  return undefined
}
