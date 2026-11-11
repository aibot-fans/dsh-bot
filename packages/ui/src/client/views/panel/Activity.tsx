import { useEffect, useId, useState, type ReactNode } from 'react'
import { t, type Activity, type ActivityGroup, type ActivityRequest, type ActivityStep } from 'pod-domain'
import { api } from '../../api/endpoints.ts'
import { errorText } from '../../api/http.ts'
import { useNow } from '../../components/common.tsx'
import { sameDay, timeText } from '../../components/time.ts'
import { useApp } from '../../state/app.ts'
import { useResource } from '../../state/resource.ts'
import { ActivityGlyph, type GlyphName } from './ActivityGlyph.tsx'

/**
 * 动态，照 Comma 的做法：一组开头一行（建了群、创建了任务、你说的一句、循环运行），
 * 下面缩进着这一组里干活的 bot 做成的几步。点开头那行收起、展开这一组；点一步跳到对话里它交的那一句。
 * 一行只在和上一行不是同一天时带日期（第一行不是今天就带）。还在干的那一组最后一行是“正在处理…”。
 * 组多了只留最早的一组和最近的两组，一组里步多了只留头两步和最近三步，中间各折成一行，点了全看。
 */

const GROUP_FOLD = { above: 4, head: 1, tail: 2 }
const STEP_FOLD = { above: 8, head: 2, tail: 3 }

interface Fold<T> {
  readonly head: readonly T[]
  readonly hidden: number
  readonly tail: readonly T[]
}

/** 多于 above 行时：留头 head 行、尾 tail 行，中间藏几行。 */
function folded<T>(items: readonly T[], rule: { readonly above: number; readonly head: number; readonly tail: number }): Fold<T> | undefined {
  if (items.length <= rule.above) return undefined
  return { head: items.slice(0, rule.head), hidden: items.length - rule.head - rule.tail, tail: items.slice(items.length - rule.tail) }
}

/** 一组里露出来的一行：做成的一步、折起来的几步、正在处理。 */
type StepRow = { readonly kind: 'step'; readonly key: string; readonly step: ActivityStep } | { readonly kind: 'fold'; readonly hidden: number; readonly next: string } | { readonly kind: 'live' }

/** 动态里露出来的一行：一组，或者折起来的几组。 */
type GroupRow =
  | { readonly kind: 'group'; readonly group: ActivityGroup; readonly collapsible: boolean; readonly collapsed: boolean; readonly steps: readonly StepRow[] }
  | { readonly kind: 'fold'; readonly hidden: number; readonly count: number; readonly next: string }

const REQUEST_GLYPH: Readonly<Record<ActivityRequest['kind'], GlyphName>> = { group: 'created', task: 'created', said: 'said', run: 'run' }

function requestLabel(request: ActivityRequest): string {
  if (request.kind === 'group') return t('建了群')
  if (request.kind === 'task') return t('创建了任务')
  if (request.kind === 'run') return t('循环运行')
  return request.text
}

const stepKey = (group: ActivityGroup, index: number): string => `${group.key}#${index}`

function stepRows(group: ActivityGroup, open: boolean): readonly StepRow[] {
  const all = group.steps.map((step, index): StepRow => ({ kind: 'step', key: stepKey(group, index), step }))
  const fold = open ? undefined : folded(all, STEP_FOLD)
  const steps = fold === undefined ? all : [...fold.head, { kind: 'fold', hidden: fold.hidden, next: stepKey(group, fold.head.length) } as const, ...fold.tail]
  return group.live ? [...steps, { kind: 'live' }] : steps
}

/** 露出来的几行，从上往下。 */
function rowsOf(groups: readonly ActivityGroup[], all: boolean, open: ReadonlySet<string>, collapsed: ReadonlySet<string>): readonly GroupRow[] {
  const row = (group: ActivityGroup): GroupRow => {
    const collapsible = group.steps.length > 0 || group.live
    const shut = collapsible && collapsed.has(group.key)
    return { kind: 'group', group, collapsible, collapsed: shut, steps: shut ? [] : stepRows(group, open.has(group.key)) }
  }
  const fold = all ? undefined : folded(groups, GROUP_FOLD)
  if (fold === undefined) return groups.map(row)
  const middle = groups.slice(fold.head.length, groups.length - fold.tail.length)
  const count = middle.reduce((sum, group) => sum + group.steps.length, 0)
  return [...fold.head.map(row), { kind: 'fold', hidden: fold.hidden, count, next: middle[0]?.key ?? '' }, ...fold.tail.map(row)]
}

/** 哪几行带日期：和上一行（露出来的、有时刻的）不是同一天；第一行不是今天。 */
function datedKeys(rows: readonly GroupRow[], now: number): ReadonlySet<string> {
  const timed = rows.flatMap((row) =>
    row.kind === 'fold' ? [] : [{ key: row.group.key, at: row.group.request.at }, ...row.steps.flatMap((step) => (step.kind === 'step' ? [{ key: step.key, at: step.step.at }] : []))],
  )
  return new Set(timed.filter((row, index) => !sameDay(row.at, timed[index - 1]?.at ?? now)).map((row) => row.key))
}

/** 跳到对话里的一句：先问它在哪段对话、第几条。 */
function useJump(onProblem: (text: string) => void): (messageId: string) => void {
  const app = useApp()
  return (messageId) => {
    api
      .message(messageId)
      .then((message) => app.focusMessage(message.roomId, message.seq, message.id))
      .catch((reason: unknown) => onProblem(errorText(reason)))
  }
}

/** 点开折起来的几行后，焦点落到露出来的第一行上。 */
function focusOnMount(node: HTMLElement | null): void {
  node?.focus()
}

function Line(props: { readonly glyph: GlyphName; readonly done?: boolean; readonly children: ReactNode }) {
  return (
    <>
      <span className="pod-act-icon" data-done={props.done === true ? 'true' : undefined} aria-hidden>
        <ActivityGlyph name={props.glyph} />
      </span>
      {props.children}
    </>
  )
}

export function ActivityList(props: { readonly activity: Activity; readonly empty: string }) {
  const now = useNow()
  const listId = useId()
  const [all, setAll] = useState(false)
  const [open, setOpen] = useState<ReadonlySet<string>>(() => new Set())
  const [collapsed, setCollapsed] = useState<ReadonlySet<string>>(() => new Set())
  const [focusKey, setFocusKey] = useState<string | undefined>(undefined)
  const [problem, setProblem] = useState<string | undefined>(undefined)
  const jump = useJump(setProblem)
  useEffect(() => {
    if (focusKey !== undefined) setFocusKey(undefined)
  }, [focusKey])

  const { groups } = props.activity
  if (groups.length === 0) return <p className="pod-act-empty">{props.empty}</p>
  const rows = rowsOf(groups, all, open, collapsed)
  const dated = datedKeys(rows, now)
  const focusRef = (key: string) => (key === focusKey ? focusOnMount : undefined)
  const when = (key: string, at: number) => <time className="pod-act-time" dateTime={new Date(at).toISOString()}>{timeText(at, { now, date: dated.has(key) })}</time>
  const toggle = (key: string) =>
    setCollapsed((current) => {
      const next = new Set(current)
      if (!next.delete(key)) next.add(key)
      return next
    })

  const stepItem = (group: ActivityGroup, row: StepRow) => {
    if (row.kind === 'live')
      return (
        <li key="live" className="pod-act-item" data-live="true">
          <div className="pod-act-row">
            <Line glyph="live">
              <span className="pod-act-text">{t('正在处理…')}</span>
            </Line>
          </div>
        </li>
      )
    if (row.kind === 'fold')
      return (
        <li key="fold" className="pod-act-item" data-fold="true">
          <button
            type="button"
            className="pod-act-row"
            onClick={() => {
              setOpen((current) => new Set(current).add(group.key))
              setFocusKey(row.next)
            }}
          >
            <Line glyph="more">
              <span className="pod-act-text">{t('还有 {count} 项', { count: row.hidden })}</span>
            </Line>
          </button>
        </li>
      )
    const { step, key } = row
    const content = (
      <Line glyph="done" done>
        <span className="pod-act-text">
          <span className="pod-act-title">{step.title}</span>
          {when(key, step.at)}
        </span>
      </Line>
    )
    return (
      <li key={key} className="pod-act-item">
        {step.messageId === null ? (
          <div className="pod-act-row" ref={focusRef(key)} tabIndex={key === focusKey ? -1 : undefined}>
            {content}
          </div>
        ) : (
          <button type="button" className="pod-act-row" ref={focusRef(key)} onClick={() => jump(step.messageId ?? '')}>
            {content}
          </button>
        )}
      </li>
    )
  }

  const groupItem = (row: Extract<GroupRow, { kind: 'group' }>) => {
    const { group } = row
    const id = `${listId}-${group.key}`
    const content = (
      <Line glyph={REQUEST_GLYPH[group.request.kind]}>
        <span className="pod-act-text" data-kind="request">
          <span className="pod-act-title">{requestLabel(group.request)}</span>
          {when(group.key, group.request.at)}
        </span>
      </Line>
    )
    return (
      <li key={group.key} className="pod-act-group">
        {row.collapsible ? (
          <button type="button" className="pod-act-row" aria-expanded={!row.collapsed} aria-controls={row.collapsed ? undefined : id} ref={focusRef(group.key)} onClick={() => toggle(group.key)}>
            {content}
          </button>
        ) : (
          <div className="pod-act-row" ref={focusRef(group.key)} tabIndex={group.key === focusKey ? -1 : undefined}>
            {content}
          </div>
        )}
        {row.steps.length === 0 ? null : (
          <ol className="pod-act-steps" id={id}>
            {row.steps.map((step) => stepItem(group, step))}
          </ol>
        )}
      </li>
    )
  }

  return (
    <>
      <ol className="pod-act">
        {rows.map((row) =>
          row.kind === 'group' ? (
            groupItem(row)
          ) : (
            <li key="fold" className="pod-act-group" data-fold="true">
              <button
                type="button"
                className="pod-act-row"
                onClick={() => {
                  setAll(true)
                  setFocusKey(row.next)
                }}
              >
                <Line glyph="more">
                  <span className="pod-act-text">
                    {t('更早的 {count} 组', { count: row.hidden })}
                    <span className="pod-act-time">{t('{count} 项', { count: row.count })}</span>
                  </span>
                </Line>
              </button>
            </li>
          ),
        )}
      </ol>
      {problem === undefined ? null : <p className="pod-form-error">{problem}</p>}
    </>
  )
}

function ActivityBox(props: { readonly activity: Activity | undefined; readonly error: string | undefined; readonly empty: string }) {
  return (
    <section className="pod-box">
      <div className="pod-box-head">
        <strong>{t('动态')}</strong>
      </div>
      <div className="pod-act-body">{props.activity === undefined ? <p className="pod-act-empty">{props.error ?? t('正在读取…')}</p> : <ActivityList activity={props.activity} empty={props.empty} />}</div>
    </section>
  )
}

/** 群、单聊详情里的「动态」：在这段对话里交代的每件事。 */
export function RoomActivityBox(props: { readonly roomId: string; readonly empty: string }) {
  const app = useApp()
  const { data, error } = useResource(app.cache, `room-activity:${props.roomId}`, () => api.roomActivity(props.roomId))
  return <ActivityBox activity={data} error={error} empty={props.empty} />
}

/** 任务详情里的「动态」：创建了任务，之后每次接着说、每一轮。 */
export function TaskActivityBox(props: { readonly taskId: string; readonly rootId: string }) {
  const app = useApp()
  const { data, error } = useResource(app.cache, `task-activity:${props.rootId}`, () => api.taskActivity(props.taskId))
  return <ActivityBox activity={data} error={error} empty={t('干活的 bot 做成一步会记在这里')} />
}
