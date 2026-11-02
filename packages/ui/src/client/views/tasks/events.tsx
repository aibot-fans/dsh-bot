import { t, tc, type Bot } from 'pod-domain'
import type { TaskEvent } from '../../api/endpoints.ts'
import { BotName } from '../../components/GroupMark.tsx'

/** 决策链里看门狗的结论。 */
export const VERDICT_WORDS: Readonly<Record<string, string>> = { continue: '继续', remind: '提醒', blocked: '受阻' }

export const EVENT_LABELS: Readonly<Record<string, string>> = {
  planned: '提交团队计划',
  approved: '确认计划',
  started: '开工',
  submitted: '提交子任务',
  reviewed: '验收',
  reassigned: '改派给',
  revised: '出新版计划',
  delivered: '交付',
  'change-proposed': '转达需求变更',
  delegated: '派给',
  checked: '勾选验收项',
  completed: '提交结果',
  relayed: '转达',
  'owner-talk': '你直接对任务说',
  stalled: '停滞',
  lesson: '记下经验',
  task_opened: '开了任务',
  task_ended: '任务结束',
  task_reopened: '重新打开',
  run_queued: '排队执行',
  run_started: '开始执行',
  run_ended: '执行结束',
  report_recorded: '汇报',
  reply_sent: '发了消息',
  subtask_opened: '开了子任务',
  team_room: '开了任务群',
  watchdog: '看门狗报警',
  watchdog_verdict: '判断',
  'control.pause': '暂停',
  'control.resume': '继续',
  'control.stop': '停止',
  'control.cancel': '取消',
  trigger_set: '挂了触发器',
  trigger_changed: '改了触发器',
  trigger_removed: '删了触发器',
  trigger_fired: '触发器叫醒了任务',
}

/** 决策链一行里做事的人：你、Pod，或者带图标的 bot。 */
export function Actor(props: { readonly actor: string; readonly bots: ReadonlyMap<string, Bot> }) {
  if (props.actor === 'owner') return <>{t('你')}</>
  if (props.actor === 'pod') return <>dsh-bot</>
  if (props.actor === 'watchdog') return <>{t('看门狗')}</>
  return <BotName bot={props.bots.get(props.actor)} fallback={props.actor} size={14} />
}

/** 决策链一行里做事的人后面的那部分。 */
export function eventLine(event: TaskEvent, bots: ReadonlyMap<string, Bot>): string {
  const label = tc(EVENT_LABELS[event.kind] ?? event.kind, '事件')
  const judged = event.kind === 'watchdog_verdict' && typeof event.data.verdict === 'string' ? t('（{verdict}）', { verdict: tc(VERDICT_WORDS[event.data.verdict] ?? event.data.verdict, '看门狗') }) : ''
  const to = typeof event.data.to === 'string' ? ` ${bots.get(event.data.to)?.name ?? event.data.to}` : ''
  const reason = typeof event.data.reason === 'string' && event.data.reason !== '' ? t('：{reason}', { reason: event.data.reason }) : ''
  const items = Array.isArray(event.data.items) ? t('：{items}', { items: (event.data.items as unknown[]).join(t('、')) }) : ''
  const quote = typeof event.data.quote === 'string' ? t('：「{quote}」', { quote: event.data.quote }) : typeof event.data.text === 'string' && event.kind === 'owner-talk' ? t('：「{quote}」', { quote: event.data.text }) : ''
  const verdict = event.kind === 'reviewed' ? (event.data.pass === true ? t('：通过') : t('：打回（{String}）', { String: String(event.data.feedback ?? '') })) : ''
  const version = event.kind === 'revised' ? t('：第 {String} 版，{String2}', { String: String(event.data.version ?? ''), String2: String(event.data.reason ?? '') }) : ''
  const trigger = event.kind.startsWith('trigger_') && typeof event.data.text === 'string' ? t('：{text}', { text: event.data.text }) : ''
  return `${label}${judged}${to}${reason}${items}${quote}${verdict}${version}${trigger}`
}
