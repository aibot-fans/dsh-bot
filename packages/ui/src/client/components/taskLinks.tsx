import { Fragment, type ReactNode } from 'react'
import type { RoomMessage } from 'pod-domain'

/** 一句话说到的任务：id 和当时的标题。 */
export interface TaskRef {
  readonly id: string
  readonly title: string
}

/** 消息里说到的任务：标题出现的地方画成任务链接（带状态图标，点一下打开任务对话）。 */
export interface TaskLinks {
  readonly pattern: RegExp
  readonly byTitle: ReadonlyMap<string, string>
  readonly render: (taskId: string, key: string) => ReactNode
}

/** 这句话说到的任务：前台说话时记下的几个；以前的消息只有一个任务 id，没有标题。 */
export function taskRefs(message: RoomMessage): readonly TaskRef[] {
  const listed: readonly unknown[] = Array.isArray(message.data.tasks) ? message.data.tasks : []
  const refs = listed.flatMap((item): TaskRef[] => {
    if (typeof item !== 'object' || item === null) return []
    const entry = item as Readonly<Record<string, unknown>>
    return typeof entry.id === 'string' ? [{ id: entry.id, title: typeof entry.title === 'string' ? entry.title.trim() : '' }] : []
  })
  if (refs.length > 0) return refs
  return typeof message.data.taskId === 'string' ? [{ id: message.data.taskId, title: '' }] : []
}

/** 句子里提到了这个任务的标题。 */
export function namedIn(body: string, ref: TaskRef): boolean {
  return ref.title !== '' && body.includes(ref.title)
}

/** 按标题认任务：长标题优先；「」括着的连括号一起换掉。 */
export function buildTaskLinks(refs: readonly TaskRef[], render: TaskLinks['render']): TaskLinks | undefined {
  const titles = [...new Set(refs.map((ref) => ref.title))].filter((title) => title !== '').sort((left, right) => right.length - left.length)
  if (titles.length === 0) return undefined
  const escaped = titles.map((title) => title.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')).join('|')
  return { pattern: new RegExp(`「(${escaped})」|(${escaped})`, 'g'), byTitle: new Map(refs.map((ref) => [ref.title, ref.id])), render }
}

/** 一段纯文字里的任务标题换成任务链接，其余的交给 rest（比如再认 @名字）。 */
export function withTaskLinks(text: string, key: string, links: TaskLinks | undefined, rest: (text: string, key: string) => ReactNode): ReactNode {
  if (links === undefined) return rest(text, key)
  const parts: ReactNode[] = []
  let last = 0
  let count = 0
  for (const match of text.matchAll(links.pattern)) {
    const taskId = links.byTitle.get(match[1] ?? match[2] ?? '')
    if (taskId === undefined) continue
    const start = match.index ?? 0
    if (start > last) parts.push(<Fragment key={`${key}-r${count}`}>{rest(text.slice(last, start), `${key}-r${count}`)}</Fragment>)
    parts.push(links.render(taskId, `${key}-t${count}`))
    count += 1
    last = start + match[0].length
  }
  if (count === 0) return rest(text, key)
  if (last < text.length) parts.push(<Fragment key={`${key}-r${count}`}>{rest(text.slice(last), `${key}-r${count}`)}</Fragment>)
  return parts
}
