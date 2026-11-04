import { progressHealth, spoken, t, type Bot, type TaskSnapshot } from 'pod-domain'
import { Avatar, nameColor, useNow } from '../../components/common.tsx'
import { duration } from '../../components/duration.ts'
import type { LiveStatus, LiveStream } from '../../state/app.ts'
import { BubbleTail } from './BubbleTail.tsx'

/** 一步跑了这么久，后面带上用了多久。 */
const STEP_TIMED_MS = 5000

/** 正在回答的一个会话：有打字流的是在写回复，状态里是这一轮的进度；还在挑谁来接时 botId 是空串。 */
export interface Responding {
  readonly sessionId: string
  readonly botId: string
  readonly stream: LiveStream | undefined
  readonly status: LiveStatus | undefined
}

interface Line {
  readonly text: string
  /** 看着卡住了（一步跑太久、连着出错、连着做同一步）：跟在后面的一句提醒。 */
  readonly warn: string | null
}

/** 一个会话这一刻在做什么：调工具时是这一步（超过 5 秒带上用了多久），想的时候是思考的最后一句，写回复时是“输入中”。 */
function lineOf(reply: Responding, now: number): Line {
  const progress = reply.status?.progress ?? null
  const warn = progress === null ? null : (progressHealth(progress, now)?.text ?? null)
  const current = progress?.steps.findLast((step) => step.ok === null)
  if (current !== undefined) {
    const age = now - current.startedAt
    return { text: age >= STEP_TIMED_MS ? t('{label} · {spoken}', { label: current.label, spoken: spoken(age) }) : current.label, warn }
  }
  if (progress !== null && progress.thinking !== null && progress.thinking !== '') return { text: progress.thinking, warn }
  if (reply.stream !== undefined) return { text: t('输入中'), warn }
  const label = reply.status?.label ?? ''
  return { text: label === '' ? t('正在想') : t('正在{label}', { label }), warn }
}

/** 同一个 bot 在这里同时有几条会话（前台在回话，它自己做的任务也在跑）：留最能说明它在干什么的那条。 */
function oneEach(replies: readonly Responding[]): readonly Responding[] {
  const weight = (reply: Responding): number => {
    const progress = reply.status?.progress ?? null
    if (reply.stream !== undefined) return 3
    if (progress?.steps.some((step) => step.ok === null) === true) return 2
    return progress?.thinking == null ? 0 : 1
  }
  const best = replies.reduce((kept, reply) => {
    const other = kept.get(reply.botId)
    return other !== undefined && weight(other) >= weight(reply) ? kept : new Map([...kept, [reply.botId, reply]])
  }, new Map<string, Responding>())
  return [...best.values()]
}

function names(bots: readonly (Bot | undefined)[]): string {
  const shown = bots.map((bot) => bot?.name ?? 'bot')
  return shown.length <= 2 ? shown.join(t('和')) : t('{first}等 {count} 个', { first: shown.slice(0, 2).join(t('、')), count: shown.length })
}

/**
 * 回答过程：对话最底下一个灰气泡，只有一行字，跟着变——调工具时是这一步在做什么，想的时候是思考的最后一句，
 * 开始写回复时是“输入中”；看着卡住时后面跟一句提醒，要停用输入框的停止按钮。几个 bot 同时在回答也只有一行，
 * 写“A 和 B 正在处理”，气泡里是它们的小头像。主对话里没有 bot 在回答、交出去的任务还在做时，是“正在等「任务名」完成 · 已等 N 分钟”，
 * 气泡里是干活的 bot 的小头像。回答完这一行就没了，回复下面不挂别的。
 */
export function ActivityLine(props: {
  readonly replies: readonly Responding[]
  /** 从这个对话交出去、正在做的任务（主对话里才有）。 */
  readonly working: readonly TaskSnapshot[]
  readonly bots: ReadonlyMap<string, Bot>
  /** 几个人说话的对话：气泡上面写名字。 */
  readonly named: boolean
  readonly onOpenBot: (botId: string) => void
}) {
  const now = useNow(1000)
  const speaking = oneEach(props.replies.filter((reply) => reply.botId !== ''))
  const routing = props.replies.find((reply) => reply.botId === '')
  if (speaking.length === 1) {
    const reply = speaking[0] as Responding
    const bot = props.bots.get(reply.botId)
    const line = lineOf(reply, now)
    return (
      <Frame bot={bot} named={props.named} onOpenBot={() => props.onOpenBot(reply.botId)}>
        <Dots />
        <span className="pod-activity-text">{line.text}</span>
        {line.warn === null ? null : <span className="pod-activity-warn">{line.warn}</span>}
      </Frame>
    )
  }
  if (speaking.length > 1) {
    const bots = speaking.map((reply) => props.bots.get(reply.botId))
    const warn = speaking.map((reply) => lineOf(reply, now).warn).find((value) => value !== null) ?? null
    return (
      <Frame bot={undefined} named={false} onOpenBot={() => undefined}>
        <Minis bots={bots} />
        <span className="pod-activity-text">{t('{names}正在处理', { names: names(bots) })}</span>
        {warn === null ? null : <span className="pod-activity-warn">{warn}</span>}
      </Frame>
    )
  }
  if (routing !== undefined) {
    return (
      <Frame bot={undefined} named={false} onOpenBot={() => undefined}>
        <Dots />
        <span className="pod-activity-text">{lineOf(routing, now).text}</span>
      </Frame>
    )
  }
  const first = props.working[0]
  if (first === undefined) return null
  const owners = [...new Set(props.working.map((snapshot) => snapshot.task.ownerBotId).filter((id): id is string => id !== null))].map((id) => props.bots.get(id))
  // 等了多久：从最早的那个这次开工（交出去、接着做）算起，不到一分钟不写。
  const age = now - Math.min(...props.working.map((snapshot) => snapshot.run?.queuedAt ?? snapshot.task.createdAt))
  const values = { title: first.task.title, count: props.working.length, waited: duration(age) }
  const text =
    props.working.length === 1
      ? age < 60_000
        ? t('正在等「{title}」完成', values)
        : t('正在等「{title}」完成 · 已等 {waited}', values)
      : age < 60_000
        ? t('正在等「{title}」等 {count} 个任务完成', values)
        : t('正在等「{title}」等 {count} 个任务完成 · 已等 {waited}', values)
  return (
    <Frame bot={undefined} named={false} onOpenBot={() => undefined}>
      {owners.length === 0 ? <Dots /> : <Minis bots={owners} />}
      <span className="pod-activity-text">{text}</span>
    </Frame>
  )
}

/** 左边那一列是回答的 bot 的头像（几个 bot 一起时空着），右边一个带尾巴的灰气泡。 */
function Frame(props: { readonly bot: Bot | undefined; readonly named: boolean; readonly onOpenBot: () => void; readonly children: React.ReactNode }) {
  return (
    <div className="pod-activity" aria-live="polite">
      <div className="pod-msg-gutter">
        {props.bot === undefined ? null : (
          <button type="button" className="pod-msg-avatar" onClick={props.onOpenBot} aria-label={t('{value} 的详情', { value: props.bot.name })}>
            <Avatar bot={props.bot} size={28} />
          </button>
        )}
      </div>
      <div className="pod-activity-main">
        {props.named && props.bot !== undefined ? (
          <span className="pod-msg-label pod-bot-name" style={nameColor(props.bot)}>
            {props.bot.name}
          </span>
        ) : null}
        <div className="pod-activity-bubble">
          {props.children}
          <BubbleTail side="left" />
        </div>
      </div>
    </div>
  )
}

function Dots() {
  return (
    <span className="pod-activity-dots" aria-hidden>
      <i />
      <i />
      <i />
    </span>
  )
}

function Minis(props: { readonly bots: readonly (Bot | undefined)[] }) {
  return (
    <span className="pod-activity-minis" aria-hidden>
      {props.bots.slice(0, 3).map((bot, index) => (
        <Avatar key={bot?.id ?? index} bot={bot} size={18} />
      ))}
    </span>
  )
}
