import { useState } from 'react'
import { isOpenWait, t, type Wait } from 'pod-domain'
import { api } from '../api/endpoints.ts'
import { errorText } from '../api/http.ts'
import { useApp } from '../state/app.ts'

/** 等你那件事怎么处理的：事项自己的状态和答复，运行时也记在带着它卡片的消息上（data.settled）。 */
export interface Settled {
  readonly status: string
  readonly answer: string | null
}

export function readSettled(value: unknown): Settled | undefined {
  if (typeof value !== 'object' || value === null) return undefined
  const entry = value as Readonly<Record<string, unknown>>
  return typeof entry.status === 'string' ? { status: entry.status, answer: typeof entry.answer === 'string' ? entry.answer : null } : undefined
}

/** 卡片上按钮收起后写的处理结果：你批准了、你没批准、你答：……。 */
export function settledText(settled: Settled): string {
  const answer = (settled.answer ?? '').trim()
  if (settled.status === 'closed') return t('你说不用管')
  if (settled.status === 'suspended') return t('任务停了，这件事先放着')
  if (answer === t('批准') || answer === t('允许')) return answer === t('批准') ? t('你批准了') : t('你允许了一次')
  if (answer.startsWith(t('不批准')) || answer.startsWith(t('不允许'))) return answer.startsWith(t('不批准')) ? t('你没批准') : t('你没允许')
  if (answer === '' || answer === t('已处理')) return t('你处理好了')
  return t('你答：{answer}', { answer: answer.length > 60 ? `${answer.slice(0, 60)}…` : answer })
}

/**
 * 卡片上问题下面的说明。bot 汇报时写给你的那段（data.summary）直接写出来；别的事项的说明本来也是写给你的，
 * 只是以前的汇报把给 Super-agent 和组长看的 report 也拼在里面，所以收进“详情”。和问题一样的不再写。
 */
export function waitNote(wait: Wait): { readonly text: string; readonly folded: boolean } {
  const summary = wait.data.summary
  const text = typeof summary === 'string' ? summary : wait.detail
  return { text: text.trim() === wait.title.trim() ? '' : text, folded: typeof summary !== 'string' }
}

/** 卡片在哪段对话的哪条消息上：在问题卡片上答的，回答也作为你的一句话留在那里。 */
export interface CardPlace {
  readonly roomId: string
  readonly messageId: string
}

export interface WaitActions {
  readonly busy: boolean
  readonly problem: string | undefined
  /** 处理过没有、怎么处理的；还开着是 undefined。 */
  readonly settled: Settled | undefined
  readonly answer: (text: string) => void
  readonly dismiss: () => void
}

/** 卡片上的答复、不用管：点完马上按处理过的画（页面刷新前用这边记下的），失败了写原因。 */
export function useWaitActions(wait: Wait, place: CardPlace): WaitActions {
  const app = useApp()
  const [busy, setBusy] = useState(false)
  const [problem, setProblem] = useState<string | undefined>(undefined)
  const [done, setDone] = useState<Settled | undefined>(undefined)
  const run = (work: () => Promise<unknown>, settled: Settled): void => {
    if (busy) return
    setBusy(true)
    setProblem(undefined)
    work()
      .then(() => {
        setDone(settled)
        app.cache.invalidate('waits')
      })
      .catch((reason: unknown) => setProblem(errorText(reason)))
      .finally(() => setBusy(false))
  }
  return {
    busy,
    problem,
    settled: done ?? (isOpenWait(wait) ? undefined : { status: wait.status, answer: wait.answer }),
    answer: (text) => run(() => api.answerWait(wait.id, text, place), { status: 'resolved', answer: text }),
    dismiss: () => run(() => api.dismissWait(wait.id), { status: 'closed', answer: null }),
  }
}
