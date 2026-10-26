import { useMemo, useState } from 'react'
import { ROOM_TITLE_MAX, type Bot, type NotifyLevel, type RoomSummary } from 'pod-domain'
import { api } from '../../api/endpoints.ts'
import { errorText } from '../../api/http.ts'
import { Avatar, Button, Empty, Modal, Segmented } from '../../components/common.tsx'
import { GroupMark } from '../../components/GroupMark.tsx'
import { Icon } from '../../components/Icon.tsx'
import { PanelClose } from '../../components/PanelClose.tsx'
import { RenameInput } from '../../components/RenameInput.tsx'
import { useApp, type GroupTab } from '../../state/app.ts'
import { useResource } from '../../state/resource.ts'
import { ScopedPages } from '../pages/ScopedPages.tsx'
import { Automations } from '../settings/Routines.tsx'
import { TaskTile } from '../tasks/TasksView.tsx'
import { GroupBrowser } from './BrowserTabs.tsx'
import { Library } from './Library.tsx'

const TABS: readonly (readonly [GroupTab, string])[] = [
  ['details', '详情'],
  ['pages', '页面'],
  ['library', '资料库'],
  ['automations', '自动化'],
  ['tasks', '任务'],
  ['browser', '浏览器'],
]

/** 每一页顶上一句话，说清这一页放的是什么。 */
const TAB_HINTS: Readonly<Record<Exclude<GroupTab, 'details'>, string>> = {
  pages: '群里做的报告、看板、跟踪表、幻灯片这些页面：点开查看，在页面里接着让 bot 改。',
  library: '群里产出的文档、截图和网页存档。',
  automations: '到点自动跑、结果发到这个群的事，比如每天的简报、盯一个网页。',
  tasks: '交给 bot 的一件件事：有分工、进度和验收，做完交付成果。',
  browser: '群里的 bot 打开的网页，和你在这里开的网页：可以看实时画面，也可以接管。',
}

const NOTIFY: readonly (readonly [NotifyLevel, string])[] = [
  ['all', '全部'],
  ['waits', '需要你时'],
  ['off', '不提醒'],
]

/** 群约定：群里所有成员都遵守的几句话（存成这个群的核心记忆，每段对话开始时带上）。 */
function Conventions(props: { readonly roomId: string }) {
  const app = useApp()
  const key = `memory:core:room:${props.roomId}`
  const { data: core } = useResource(app.cache, key, () => api.core('room', props.roomId))
  const [draft, setDraft] = useState<string | undefined>(undefined)
  const [problem, setProblem] = useState<string | undefined>(undefined)
  if (draft !== undefined) {
    return (
      <div className="pod-stack pod-box-pad">
        <textarea className="pod-textarea" rows={4} value={draft} onChange={(event) => setDraft(event.target.value)} placeholder="例如：文章用中文，标题不超过 20 个字；改代码先说原因再动手" />
        <div className="pod-row">
          <Button
            small
            kind="primary"
            onClick={() => {
              api
                .setCore('room', props.roomId, draft)
                .then(() => {
                  setDraft(undefined)
                  app.cache.invalidate(key)
                })
                .catch((reason: unknown) => setProblem(errorText(reason)))
            }}
          >
            保存
          </Button>
          <Button small kind="quiet" onClick={() => setDraft(undefined)}>
            取消
          </Button>
        </div>
        {problem === undefined ? null : <p className="pod-form-error">{problem}</p>}
      </div>
    )
  }
  return (
    <div className="pod-box-pad pod-stack-tight">
      {core === undefined || core.text === '' ? <span className="pod-muted-inline">还没有约定</span> : <p className="pod-persona-text">{core.text}</p>}
      <div>
        <Button small kind="quiet" icon="edit" onClick={() => setDraft(core?.text ?? '')}>
          编辑
        </Button>
      </div>
    </div>
  )
}

/** 添加成员：一次勾选几个，没进群的 bot 都列出来，带图标、名字和职责。 */
function AddMembers(props: { readonly room: RoomSummary; readonly others: readonly Bot[]; readonly onClose: () => void }) {
  const app = useApp()
  const [picked, setPicked] = useState<readonly string[]>([])
  const [query, setQuery] = useState('')
  const [busy, setBusy] = useState(false)
  const [problem, setProblem] = useState<string | undefined>(undefined)
  const shown = props.others.filter((bot) => query.trim() === '' || `${bot.name}${bot.title}${bot.capabilities.join('')}`.includes(query.trim()))
  const toggle = (id: string): void => setPicked((current) => (current.includes(id) ? current.filter((item) => item !== id) : [...current, id]))
  const add = (): void => {
    setBusy(true)
    setProblem(undefined)
    picked
      .reduce<Promise<unknown>>((chain, botId) => chain.then(() => api.addMember(props.room.id, botId)), Promise.resolve())
      .then(() => {
        app.cache.invalidate('rooms')
        app.cache.invalidate(`members:${props.room.id}`)
        props.onClose()
      })
      .catch((reason: unknown) => setProblem(errorText(reason)))
      .finally(() => setBusy(false))
  }
  return (
    <Modal title={`添加成员到「${props.room.title}」`} onClose={props.onClose}>
      <div className="pod-stack">
        {props.others.length > 6 ? <input className="pod-input" autoFocus value={query} placeholder="按名字或能力找" onChange={(event) => setQuery(event.target.value)} aria-label="找 bot" /> : null}
        {props.others.length === 0 ? (
          <Empty title="所有 bot 都在群里了">
            <button
              type="button"
              className="pod-link"
              onClick={() => {
                props.onClose()
                app.openDrawer({ kind: 'new-bot' })
              }}
            >
              新建一个 bot
            </button>
          </Empty>
        ) : null}
        <div className="pod-pick-list" role="group" aria-label="选要加进来的 bot">
          {shown.map((bot) => (
            <label key={bot.id} className={`pod-pick${picked.includes(bot.id) ? ' pod-pick-on' : ''}`}>
              <input type="checkbox" checked={picked.includes(bot.id)} onChange={() => toggle(bot.id)} />
              <Avatar bot={bot} size={30} />
              <span className="pod-pick-main">
                <strong>{bot.name}</strong>
                <span className="pod-muted-inline pod-ellipsis">{bot.card.duties || bot.title || '没写职责'}</span>
              </span>
            </label>
          ))}
        </div>
        {problem === undefined ? null : <p className="pod-form-error">{problem}</p>}
        <div className="pod-form-actions">
          <Button kind="quiet" onClick={props.onClose}>
            取消
          </Button>
          <Button kind="primary" disabled={busy || picked.length === 0} onClick={add}>
            {picked.length === 0 ? '添加' : `添加 ${picked.length} 位`}
          </Button>
        </div>
      </div>
    </Modal>
  )
}

/** 成员：图标加完整名字排成一格一格，最后一格是“添加”；点成员打开成员卡片（能返回这里）。 */
function Members(props: { readonly room: RoomSummary; readonly members: readonly Bot[]; readonly bots: readonly Bot[] }) {
  const app = useApp()
  const [adding, setAdding] = useState(false)
  const others = props.bots.filter((bot) => !props.room.memberIds.includes(bot.id))
  return (
    <section className="pod-box">
      <div className="pod-box-head">
        <strong>成员</strong>
        <span className="pod-muted-inline">点成员看它是谁、单聊或移出</span>
      </div>
      <div className="pod-member-grid">
        {props.members.map((bot) => (
          <button key={bot.id} type="button" className="pod-member-tile" onClick={() => app.showBot(bot.id, 'details', props.room.id)} title={bot.card.duties || bot.title}>
            <Avatar bot={bot} size={44} />
            <span className="pod-member-name">{bot.name}</span>
            {bot.role === 'lead' && bot.name !== '主管' ? <span className="pod-member-role">主管</span> : null}
          </button>
        ))}
        <button type="button" className="pod-member-tile pod-member-add" onClick={() => setAdding(true)}>
          <span className="pod-member-plus">
            <Icon name="plus" size={18} />
          </span>
          <span className="pod-member-name">添加</span>
        </button>
      </div>
      {adding ? <AddMembers room={props.room} others={others} onClose={() => setAdding(false)} /> : null}
    </section>
  )
}

function GroupTasks(props: { readonly room: RoomSummary; readonly bots: readonly Bot[] }) {
  const app = useApp()
  const { data: tasks, error } = useResource(app.cache, 'tasks', () => api.tasks())
  const byId = useMemo(() => new Map(props.bots.map((bot) => [bot.id, bot])), [props.bots])
  const mine = (tasks ?? []).filter((snapshot) => snapshot.task.roomId === props.room.id || (props.room.taskId !== null && snapshot.task.id === props.room.taskId))
  const running = mine.filter((snapshot) => !['done', 'failed', 'cancelled'].includes(snapshot.task.status))
  const finished = mine.filter((snapshot) => ['done', 'failed', 'cancelled'].includes(snapshot.task.status))
  if (error !== undefined) return <p className="pod-form-error">{error}</p>
  if (tasks !== undefined && mine.length === 0) return <Empty title="这个群还没有任务">在群里交代一件事，主管会安排。</Empty>
  return (
    <div className="pod-stack">
      {running.length === 0 ? null : <div className="pod-section-title">进行中</div>}
      {running.map((snapshot) => (
        <TaskTile key={snapshot.task.id} snapshot={snapshot} bots={byId} onOpen={() => app.openTask(snapshot.task.id)} />
      ))}
      {finished.length === 0 ? null : <div className="pod-section-title">已结束</div>}
      {finished.map((snapshot) => (
        <TaskTile key={snapshot.task.id} snapshot={snapshot} bots={byId} onOpen={() => app.openTask(snapshot.task.id)} />
      ))}
    </div>
  )
}

/**
 * 群聊详情：从右侧滑出，顶上左边是群图标、右边是群名和成员；
 * 分详情（成员、群约定、群记忆、提醒、删除）、页面、资料库、自动化、任务、浏览器六页。
 */
export function GroupPanel(props: { readonly roomId: string; readonly tab: GroupTab }) {
  const app = useApp()
  const { data: rooms } = useResource(app.cache, 'rooms', () => api.rooms())
  const { data: bots } = useResource(app.cache, 'bots', () => api.bots())
  const room = rooms?.find((item) => item.id === props.roomId)
  const [renaming, setRenaming] = useState(false)
  const [problem, setProblem] = useState<string | undefined>(undefined)
  const active = (bots ?? []).filter((bot) => bot.archivedAt === null)
  const members = (room?.memberIds ?? []).flatMap((id) => active.find((bot) => bot.id === id) ?? [])
  const update = (patch: Readonly<Record<string, unknown>>, done?: () => void): void => {
    setProblem(undefined)
    api
      .updateRoom(props.roomId, patch)
      .then(() => {
        app.cache.invalidate('rooms')
        done?.()
      })
      .catch((reason: unknown) => setProblem(errorText(reason)))
  }
  return (
    <aside className="pod-panel" aria-label="群聊详情">
      <div className="pod-panel-top">
        <PanelClose label="关闭详情" onClose={() => app.closePanel()} />
      </div>
      {room === undefined ? (
        <Empty title={rooms === undefined ? '正在读取…' : '这个群聊已经删除了'} />
      ) : (
        <div className="pod-panel-scroll">
          <div className="pod-group-hero">
            <GroupMark members={members} size={64} />
            <div className="pod-group-hero-main">
            {renaming ? (
              <RenameInput
                value={room.title}
                max={ROOM_TITLE_MAX}
                label="群名"
                className="pod-hero-rename"
                onSave={(title) => update({ title }, () => setRenaming(false))}
                onCancel={() => setRenaming(false)}
              />
            ) : (
              <button type="button" className="pod-hero-title" onClick={() => setRenaming(true)} title="点一下改群名">
                <strong>{room.title}</strong>
                <Icon name="edit" size={14} />
              </button>
            )}
            <span className="pod-hero-sub">{members.map((bot) => bot.name).join('、')}</span>
            {problem === undefined ? null : <p className="pod-form-error">{problem}</p>}
            </div>
          </div>
          <div className="pod-panel-tabs" role="tablist">
            {TABS.map(([tab, label]) => (
              <button key={tab} type="button" role="tab" aria-selected={tab === props.tab} className={tab === props.tab ? 'pod-panel-tab-on' : undefined} onClick={() => app.showGroup(room.id, tab)}>
                {label}
              </button>
            ))}
          </div>
          {props.tab === 'details' ? null : <p className="pod-tab-hint">{TAB_HINTS[props.tab]}</p>}
          {props.tab === 'details' ? (
            <div className="pod-stack">
              <Members room={room} members={members} bots={active} />
              <section className="pod-box">
                <div className="pod-box-head">
                  <strong>群约定</strong>
                  <span className="pod-muted-inline">每段对话开始时带上</span>
                </div>
                <Conventions roomId={room.id} />
              </section>
              <section className="pod-box">
                <button type="button" className="pod-box-entry" onClick={() => app.openDrawer({ kind: 'memory', scope: 'room', scopeId: room.id, label: `${room.title}的群记忆` })}>
                  <span>群记忆</span>
                  <span className="pod-muted-inline">群里值得记下的事</span>
                  <Icon name="forward" size={14} />
                </button>
                <div className="pod-kv">
                  <span>消息提醒</span>
                  <Segmented value={room.notifyLevel} options={NOTIFY} onChange={(notifyLevel) => update({ notifyLevel })} label="消息提醒" />
                </div>
              </section>
              <div className="pod-row pod-center">
                <Button
                  kind="danger"
                  small
                  onClick={() => {
                    if (window.confirm(`删除群聊「${room.title}」？30 天内可以在“设置 → 回收站”里恢复。`)) update({ archived: true }, () => app.navigate({ panel: null, roomId: null }))
                  }}
                >
                  删除群聊
                </Button>
              </div>
            </div>
          ) : null}
          {props.tab === 'pages' ? <ScopedPages match={(page) => page.roomId === room.id} empty="在群里说“把这周的数据做成看板”，做好的页面都在这里。" /> : null}
          {props.tab === 'library' ? <Library roomId={room.id} /> : null}
          {props.tab === 'automations' ? <Automations match={(routine) => routine.roomId === room.id} defaults={{ roomId: room.id }} empty="结果发到这个群的自动化会出现在这里。" /> : null}
          {props.tab === 'tasks' ? <GroupTasks room={room} bots={bots ?? []} /> : null}
          {props.tab === 'browser' ? <GroupBrowser room={room} /> : null}
        </div>
      )}
    </aside>
  )
}
