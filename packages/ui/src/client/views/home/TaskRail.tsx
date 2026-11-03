import { useEffect, useMemo, useRef, useState } from 'react'
import { t, type Bot, type TaskSnapshot } from 'pod-domain'
import { api } from '../../api/endpoints.ts'
import { Avatar, IconButton, listTime, useNow } from '../../components/common.tsx'
import { Icon } from '../../components/Icon.tsx'
import { TaskStateIcon, bucketOf, isMoving, openTaskConversation } from '../../components/TaskEntry.tsx'
import { railGroup, railLine, type RailGroup } from '../../components/taskLines.ts'
import { useSnapshot } from '../../components/taskParts.tsx'
import { useTaskPeople } from '../../components/TaskPeople.tsx'
import { useApp } from '../../state/app.ts'
import { useResource } from '../../state/resource.ts'

/** 收没收起来记在这台电脑上。 */
const COLLAPSED_KEY = 'pod-ui.task-rail.collapsed'

const GROUPS: readonly RailGroup[] = ['working', 'done', 'failed']
const GROUP_LABELS: Readonly<Record<RailGroup, string>> = { working: '进行中', done: '完成', failed: '没做成' }
const EMPTY_TEXT: Readonly<Record<RailGroup, string>> = { working: '现在没有在做的任务。', done: '还没有做完的任务。', failed: '没有失败或停掉的任务。' }

/** 完成和没做成的只列最近这么多件。 */
const ENDED_SHOWN = 30

function loadCollapsed(): boolean {
  try {
    return globalThis.localStorage?.getItem(COLLAPSED_KEY) === '1'
  } catch {
    return false
  }
}

function saveCollapsed(collapsed: boolean): void {
  try {
    globalThis.localStorage?.setItem(COLLAPSED_KEY, collapsed ? '1' : '0')
  } catch {
    // 隐私模式下 localStorage 不可用：这次照样收起，下次打开不记得。
  }
}

/** 进行中：要你定的在前，再是在动的，再按最近有动静的；完成和没做成按最近的在前。 */
function arrange(snapshots: readonly TaskSnapshot[]): Readonly<Record<RailGroup, readonly TaskSnapshot[]>> {
  const shown = snapshots.filter((snapshot) => snapshot.task.parentId === null && !snapshot.standing)
  const of = (group: RailGroup) => shown.filter((snapshot) => railGroup(snapshot) === group)
  const recent = (left: TaskSnapshot, right: TaskSnapshot): number => right.task.updatedAt - left.task.updatedAt
  const urgent = (snapshot: TaskSnapshot): number => (bucketOf(snapshot) === 'attention' ? 2 : isMoving(snapshot) ? 1 : 0)
  return {
    working: [...of('working')].sort((left, right) => urgent(right) - urgent(left) || recent(left, right)),
    done: [...of('done')].sort(recent).slice(0, ENDED_SHOWN),
    failed: [...of('failed')].sort(recent).slice(0, ENDED_SHOWN),
  }
}

/** 进行中的卡片跟着任务的实时进展刷新（这一步在做什么）；列表里那份只在任务有动静时才重拉。 */
function LiveRailCard(props: { readonly snapshot: TaskSnapshot; readonly bots: ReadonlyMap<string, Bot> }) {
  const { snapshot } = useSnapshot(props.snapshot.task.id)
  return <RailCard snapshot={snapshot ?? props.snapshot} bots={props.bots} />
}

/** 一张卡片：状态和任务名、干活的 bot、在问什么或这一步在做什么、更新时间。点一下打开全屏的任务对话。 */
function RailCard(props: { readonly snapshot: TaskSnapshot; readonly bots: ReadonlyMap<string, Bot> }) {
  const app = useApp()
  const now = useNow()
  const { snapshot } = props
  const people = useTaskPeople(snapshot)
  const line = railLine(snapshot, props.bots)
  return (
    <button type="button" className="pod-rail-card" onClick={() => openTaskConversation(app, snapshot)}>
      <span className="pod-rail-card-head">
        <TaskStateIcon snapshot={snapshot} />
        <strong className="pod-rail-card-title">{snapshot.task.title}</strong>
      </span>
      {people.length === 0 ? null : (
        <span className="pod-rail-people">
          {people.slice(0, 3).map((bot) => (
            <span key={bot.id} className="pod-rail-person">
              <Avatar bot={bot} size={16} />
              <span className="pod-ellipsis">{bot.name}</span>
            </span>
          ))}
        </span>
      )}
      {line.text === '' ? null : <span className={`pod-rail-line pod-rail-line-${line.tone}`}>{line.text}</span>}
      <span className="pod-rail-time">{t('更新于 {time}', { time: listTime(snapshot.task.updatedAt, now) })}</span>
    </button>
  )
}

/**
 * 主对话右边的任务栏（照 Comma 主页）：底下切换进行中、完成、没做成，一次看一组；来了新任务自己跳到它那一组。
 * 例程、盯网页这类常开任务不放这里。能从边上收起来，收起来时只留一个按钮，有在做的写个数。
 */
export function TaskRail() {
  const app = useApp()
  const { data: snapshots, error } = useResource(app.cache, 'tasks', () => api.tasks())
  const { data: botList } = useResource(app.cache, 'bots', () => api.bots())
  const bots = useMemo(() => new Map((botList ?? []).map((bot): [string, Bot] => [bot.id, bot])), [botList])
  const groups = useMemo(() => arrange(snapshots ?? []), [snapshots])
  const [collapsed, setCollapsed] = useState(loadCollapsed)
  const [group, setGroup] = useState<RailGroup>('working')
  // 认得的任务：第一次拉到的不算新来的。
  const known = useRef<ReadonlySet<string> | null>(null)
  useEffect(() => {
    if (snapshots === undefined) return
    const all = GROUPS.flatMap((key) => groups[key])
    const before = known.current
    known.current = new Set(all.map((snapshot) => snapshot.task.id))
    if (before === null) return
    const fresh = all.filter((snapshot) => !before.has(snapshot.task.id)).sort((left, right) => right.task.createdAt - left.task.createdAt)[0]
    if (fresh !== undefined) setGroup(railGroup(fresh))
  }, [snapshots, groups])
  const fold = (value: boolean): void => {
    setCollapsed(value)
    saveCollapsed(value)
  }
  if (collapsed) {
    const asking = groups.working.some((snapshot) => bucketOf(snapshot) === 'attention')
    return (
      <aside className="pod-rail pod-rail-collapsed" aria-label={t('任务')}>
        <button type="button" className="pod-rail-unfold" onClick={() => fold(false)} title={t('展开任务栏')} aria-label={t('展开任务栏')}>
          <Icon name="tasks" size={16} />
          {groups.working.length === 0 ? null : <span className={`pod-rail-count${asking ? ' pod-rail-count-ask' : ''}`}>{groups.working.length}</span>}
        </button>
      </aside>
    )
  }
  const list = groups[group]
  return (
    <aside className="pod-rail" aria-label={t('任务')}>
      <header className="pod-rail-head">
        <strong className="pod-grow">{t('任务')}</strong>
        <IconButton icon="sidebar" label={t('收起任务栏')} onClick={() => fold(true)} />
      </header>
      <div className="pod-rail-body">
        {snapshots === undefined ? (
          <p className="pod-rail-empty">{error ?? t('正在读取…')}</p>
        ) : list.length === 0 ? (
          <p className="pod-rail-empty">{t(EMPTY_TEXT[group])}</p>
        ) : (
          list.map((snapshot) => (group === 'working' ? <LiveRailCard key={snapshot.task.id} snapshot={snapshot} bots={bots} /> : <RailCard key={snapshot.task.id} snapshot={snapshot} bots={bots} />))
        )}
      </div>
      <footer className="pod-rail-foot" role="tablist" aria-label={t('任务分组')}>
        {GROUPS.map((key) => {
          const label = t('{label} {count}', { label: t(GROUP_LABELS[key]), count: groups[key].length })
          return key === group ? (
            <button key={key} type="button" role="tab" aria-selected className="pod-rail-tab">
              {label}
            </button>
          ) : (
            <button key={key} type="button" role="tab" aria-selected={false} className="pod-rail-dot" title={label} aria-label={label} onClick={() => setGroup(key)} />
          )
        })}
      </footer>
    </aside>
  )
}
