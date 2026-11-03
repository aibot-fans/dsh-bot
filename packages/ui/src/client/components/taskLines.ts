import { t, type Bot, type TaskActivity, type TaskSnapshot } from 'pod-domain'
import { bucketLabel, bucketOf } from './TaskEntry.tsx'

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
