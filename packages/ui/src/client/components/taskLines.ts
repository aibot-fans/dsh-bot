import { END_REASON_LABELS, t, type Bot, type TaskActivity, type TaskSnapshot } from 'pod-domain'
import { bucketLabel, bucketOf } from './TaskEntry.tsx'

/** 主对话右边任务栏的三组：进行中（等你的也在这里，卡片上写它在问什么）、完成、没做成（失败的、你停掉的、看过不用做的）。 */
export type RailGroup = 'working' | 'done' | 'failed'

export function railGroup(snapshot: TaskSnapshot): RailGroup {
  const bucket = bucketOf(snapshot)
  if (bucket === 'done') return 'done'
  if (bucket === 'ended' || snapshot.stage === 'failed') return 'failed'
  return 'working'
}

/** 这一步在做什么：干活的 bot 报的那句进展；还没报过，写它手上正在做的动作。 */
function stepOf(note: string, activity: TaskActivity | null | undefined): string {
  if (note !== '') return note
  return activity?.current ?? activity?.actions.at(-1) ?? ''
}

/**
 * 在做的时候卡片上那行：谁 · 这一步在做什么。负责的 bot 开完子任务在等它们时，写正在干活的那个成员。
 * 什么都还没报的写阶段（排队中、进行中、等新消息）。
 */
export function workLine(snapshot: TaskSnapshot, bots: ReadonlyMap<string, Bot>): string {
  const { task } = snapshot
  if (snapshot.activity?.running !== true) {
    for (const child of snapshot.children) {
      const activity = snapshot.childActivity[child.id]
      if (child.endedAt !== null || activity?.running !== true) continue
      const name = bots.get(child.ownerBotId ?? '')?.name
      const step = stepOf(child.note, activity)
      if (name !== undefined && step !== '') return t('{name} · {step}', { name, step })
    }
  }
  const step = stepOf(task.note, snapshot.activity)
  const what = step === '' ? bucketLabel(snapshot, bucketOf(snapshot)) : step
  return snapshot.ownerName === null ? what : t('{name} · {step}', { name: snapshot.ownerName, step: what })
}

/** 任务栏卡片上的那行话：要你定的（红字）、在做的（蓝字）、做完和没做成的（灰字）。 */
export interface RailLine {
  readonly tone: 'ask' | 'work' | 'quiet'
  readonly text: string
}

export function railLine(snapshot: TaskSnapshot, bots: ReadonlyMap<string, Bot>): RailLine {
  const { task, stage } = snapshot
  const name = snapshot.ownerName ?? t('干活的 bot')
  const bucket = bucketOf(snapshot)
  if (bucket === 'done') return { tone: 'quiet', text: snapshot.lastReport?.summary || task.note }
  if (bucket === 'ended') {
    const reason = task.endReason === null ? bucketLabel(snapshot, bucket) : t(END_REASON_LABELS[task.endReason])
    return { tone: 'quiet', text: task.note === '' ? reason : t('{reason}：{note}', { reason, note: task.note }) }
  }
  if (stage === 'failed') return { tone: 'quiet', text: task.note === '' ? t('{name}没做成', { name }) : t('{name}没做成：{note}', { name, note: task.note }) }
  if (snapshot.question !== null) return { tone: 'ask', text: t('{name}在问：{question}', { name, question: snapshot.question.title }) }
  if (stage === 'review') return { tone: 'ask', text: t('{name}交上来了，有没核实的地方，等你收下', { name }) }
  if (stage === 'blocked') return { tone: 'ask', text: task.note === '' ? t('{name}卡住了', { name }) : t('{name}卡住了：{note}', { name, note: task.note }) }
  if (stage === 'undelivered') return { tone: 'ask', text: t('消息没送到{name}那里', { name }) }
  return { tone: 'work', text: workLine(snapshot, bots) }
}
