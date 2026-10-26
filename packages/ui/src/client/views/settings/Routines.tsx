import { useState } from 'react'
import { PAGE_KIND_LABELS, WATCH_MAX_INTERVAL, WATCH_MIN_INTERVAL, dailyCron, weeklyCron, type Bot, type Page, type Routine, type RoomSummary } from 'pod-domain'
import { api } from '../../api/endpoints.ts'
import { errorText } from '../../api/http.ts'
import { pageApi } from '../../api/pages.ts'
import { Avatar, Button, Empty, Field, IconButton, RelativeTime, Segmented, Switch } from '../../components/common.tsx'
import { BotPicker } from '../../components/GroupMark.tsx'
import { Icon } from '../../components/Icon.tsx'
import { MenuItem, MenuPanel, useMenu } from '../../components/Menu.tsx'
import { useApp } from '../../state/app.ts'
import { useResource } from '../../state/resource.ts'

const WEEKDAYS = ['一', '二', '三', '四', '五', '六', '日']

export type RoutineView = Routine & { readonly description: string }

function when(time: number | null): string {
  if (time === null) return '不再运行'
  return new Date(time).toLocaleString('zh-CN', { month: 'numeric', day: 'numeric', hour: '2-digit', minute: '2-digit' })
}

type Schedule = 'daily' | 'weekly' | 'once' | 'cron'

/** datetime-local 输入框要的「YYYY-MM-DDTHH:MM」（浏览器本地时间）。 */
function localInput(time: number): string {
  const date = new Date(time)
  const pad = (value: number): string => String(value).padStart(2, '0')
  return `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())}T${pad(date.getHours())}:${pad(date.getMinutes())}`
}

/** 新建自动化：定时做一件事（每天、每周几、只跑一次或 cron，可以顺便更新一个页面），或者盯一个网页（网址、选择器、间隔）。 */
export function RoutineForm(props: {
  readonly bots: readonly Bot[]
  readonly rooms: readonly RoomSummary[]
  readonly pages: readonly Page[]
  readonly defaults?: { readonly botId?: string; readonly roomId?: string }
  readonly onDone: () => void
  readonly onCancel: () => void
}) {
  const [kind, setKind] = useState<'cron' | 'watch'>('cron')
  const [title, setTitle] = useState('')
  const [prompt, setPrompt] = useState('')
  const [botId, setBotId] = useState(props.defaults?.botId ?? props.bots[0]?.id ?? '')
  const [roomId, setRoomId] = useState(props.defaults?.roomId ?? '')
  const [schedule, setSchedule] = useState<Schedule>('daily')
  const [time, setTime] = useState('08:00')
  const [weekdays, setWeekdays] = useState<readonly number[]>([1, 2, 3, 4, 5])
  const [cron, setCron] = useState('')
  const [at, setAt] = useState(() => localInput(Date.now() + 3_600_000))
  const [url, setUrl] = useState('')
  const [selector, setSelector] = useState('')
  const [interval, setIntervalMinutes] = useState(60)
  const [pageId, setPageId] = useState('')
  const [problem, setProblem] = useState<string | undefined>(undefined)
  const [busy, setBusy] = useState(false)

  const expression = schedule === 'daily' ? dailyCron(time) : schedule === 'weekly' ? weeklyCron(time, weekdays) : cron
  const submit = (): void => {
    setBusy(true)
    setProblem(undefined)
    const base = { kind, title, prompt, botId, roomId: roomId === '' ? undefined : roomId }
    const when = schedule === 'once' ? { at } : { cron: expression }
    const input = kind === 'cron' ? { ...base, ...when, ...(pageId === '' ? {} : { pageId }) } : { ...base, url, selector, intervalMinutes: interval }
    api
      .createRoutine(input)
      .then(props.onDone)
      .catch((reason: unknown) => setProblem(errorText(reason)))
      .finally(() => setBusy(false))
  }
  const toggleDay = (day: number): void => setWeekdays((days) => (days.includes(day) ? days.filter((item) => item !== day) : [...days, day].sort((a, b) => a - b)))

  return (
    <div className="pod-card pod-stack">
      <Segmented
        value={kind}
        options={[
          ['cron', '定时做一件事'],
          ['watch', '盯一个网页'],
        ]}
        onChange={setKind}
        label="自动化的种类"
      />
      <Field label="名字">
        <input className="pod-input" value={title} maxLength={40} onChange={(event) => setTitle(event.target.value)} placeholder={kind === 'cron' ? '例如：早间资讯' : '例如：竞品价格页'} />
      </Field>
      <Field label={kind === 'cron' ? '每次做什么' : '关注什么变化'}>
        <textarea className="pod-input" rows={3} value={prompt} onChange={(event) => setPrompt(event.target.value)} placeholder={kind === 'cron' ? '例如：整理昨晚到今早的 AI 资讯，挑 5 条最重要的' : '例如：价格和套餐内容'} />
      </Field>
      {kind === 'cron' ? (
        <Field label="时间" hint="按设置里的时区">
          <div className="pod-row">
            <select className="pod-input" value={schedule} onChange={(event) => setSchedule(event.target.value as Schedule)}>
              <option value="daily">每天</option>
              <option value="weekly">每周几</option>
              <option value="once">只跑一次</option>
              <option value="cron">cron 表达式</option>
            </select>
            {schedule === 'cron' ? (
              <input className="pod-input" value={cron} onChange={(event) => setCron(event.target.value)} placeholder="分 时 日 月 周，例如 0 9 * * 1" />
            ) : schedule === 'once' ? (
              <input className="pod-input" type="datetime-local" value={at} onChange={(event) => setAt(event.target.value)} aria-label="什么时候跑" />
            ) : (
              <input className="pod-input pod-input-time" type="time" value={time} onChange={(event) => setTime(event.target.value)} />
            )}
          </div>
          {schedule === 'weekly' ? (
            <div className="pod-tabs pod-wrap">
              {WEEKDAYS.map((label, index) => (
                <button key={label} type="button" className={`pod-chip${weekdays.includes(index + 1) ? ' pod-chip-active' : ''}`} onClick={() => toggleDay(index + 1)}>
                  周{label}
                </button>
              ))}
            </div>
          ) : null}
        </Field>
      ) : (
        <>
          <Field label="网址" hint="只支持 http 和 https，内网地址会被拦下">
            <input className="pod-input" value={url} onChange={(event) => setUrl(event.target.value)} placeholder="https://" />
          </Field>
          <Field label="只看页面的这一部分" hint="CSS 选择器，可空">
            <input className="pod-input" value={selector} onChange={(event) => setSelector(event.target.value)} placeholder="例如 #pricing" />
          </Field>
          <Field label="多久看一次（分钟）" hint="内容没变不调用模型">
            <input className="pod-input pod-input-number" type="number" min={WATCH_MIN_INTERVAL} max={WATCH_MAX_INTERVAL} value={interval} onChange={(event) => setIntervalMinutes(Number(event.target.value))} />
          </Field>
        </>
      )}
      {kind === 'cron' && props.pages.length > 0 ? (
        <Field label="每次更新一个页面" hint="可选：比如每天收盘后刷新回测看板">
          <select className="pod-input" value={pageId} onChange={(event) => setPageId(event.target.value)}>
            <option value="">不更新页面，结果写在回复里</option>
            {props.pages.map((page) => (
              <option key={page.id} value={page.id}>
                {PAGE_KIND_LABELS[page.kind]}「{page.title}」
              </option>
            ))}
          </select>
        </Field>
      ) : null}
      <div className="pod-field">
        <span>谁来做</span>
        <BotPicker bots={props.bots} value={botId} onChange={setBotId} label="谁来做" />
      </div>
      <div className="pod-form-grid">
        <Field label="结果发到">
          <select className="pod-input" value={roomId} onChange={(event) => setRoomId(event.target.value)}>
            <option value="">这个 bot 的单聊</option>
            {props.rooms.map((room) => (
              <option key={room.id} value={room.id}>
                {room.title}
              </option>
            ))}
          </select>
        </Field>
      </div>
      {problem === undefined ? null : <p className="pod-form-error">{problem}</p>}
      <div className="pod-row">
        <Button kind="primary" disabled={busy || title.trim() === '' || prompt.trim() === '' || botId === ''} onClick={submit}>
          建好
        </Button>
        <Button kind="quiet" onClick={props.onCancel}>
          取消
        </Button>
      </div>
    </div>
  )
}

/** 一条自动化：谁来做（点名字可以换人）、什么时候跑、结果发到哪、上次结果；可以开关、立即运行、删除。 */
export function RoutineRow(props: { readonly routine: RoutineView; readonly bot: Bot | undefined; readonly bots: readonly Bot[]; readonly target: string; readonly onChanged: () => void }) {
  const { routine } = props
  const [problem, setProblem] = useState<string | undefined>(undefined)
  const owners = useMenu('start')
  const act = (work: Promise<unknown>): void => {
    setProblem(undefined)
    work.then(props.onChanged).catch((reason: unknown) => setProblem(errorText(reason)))
  }
  const failed = /失败|出错|打不开/.test(routine.lastStatus)
  // 只跑一次的跑过了（没交出去才会留着）：没有开关，只能立即再跑或者删掉。
  const finished = routine.runAt !== null && routine.nextRunAt === null
  return (
    <div className="pod-auto-row">
      <Avatar bot={props.bot} size={30} />
      <div className="pod-auto-main">
        <strong>{routine.title}</strong>
        <span className="pod-muted-inline">
          <button ref={owners.anchor} type="button" className="pod-link" title="换一个 bot 来做" aria-expanded={owners.open} onClick={owners.toggle}>
            {props.bot?.name ?? '已删除的 bot'}
          </button>{' '}
          · {routine.kind === 'watch' ? '盯网页，' : ''}
          {routine.description} · 发到{props.target}
        </span>
        <MenuPanel control={owners} label={`「${routine.title}」交给谁来做`}>
          {props.bots.map((bot) => (
            <MenuItem
              key={bot.id}
              label={bot.name}
              checked={bot.id === routine.botId}
              onClick={() => {
                owners.close()
                if (bot.id !== routine.botId) act(api.updateRoutine(routine.id, { botId: bot.id }))
              }}
            />
          ))}
        </MenuPanel>
        <span className={`pod-auto-status${failed ? ' pod-auto-failed' : ''}`}>
          {failed ? <Icon name="close" size={12} /> : null}
          {!routine.enabled ? '已暂停' : routine.lastStatus === '' ? `下次 ${when(routine.nextRunAt)}` : <>上次 <RelativeTime time={routine.lastRunAt} />：{routine.lastStatus}</>}
        </span>
        {problem === undefined ? null : <span className="pod-form-error">{problem}</span>}
      </div>
      {finished ? null : <Switch checked={routine.enabled} label={`${routine.enabled ? '暂停' : '打开'}「${routine.title}」`} onChange={(enabled) => act(api.updateRoutine(routine.id, { enabled }))} />}
      <IconButton icon="play" label="立即运行" onClick={() => act(api.runRoutine(routine.id))} />
      <IconButton
        icon="trash"
        label="删除"
        onClick={() => {
          if (window.confirm(`删除自动化「${routine.title}」？`)) act(api.deleteRoutine(routine.id))
        }}
      />
    </div>
  )
}

/** 自动化列表：bot 详情、群聊详情和设置里都用它，按条件筛出自己的那一部分。 */
export function Automations(props: { readonly match?: (routine: RoutineView) => boolean; readonly defaults?: { readonly botId?: string; readonly roomId?: string }; readonly empty?: string }) {
  const app = useApp()
  const { data: routines, reload } = useResource(app.cache, 'routines', () => api.routines())
  const { data: bots } = useResource(app.cache, 'bots', () => api.bots())
  const { data: rooms } = useResource(app.cache, 'rooms', () => api.rooms())
  const { data: pages } = useResource(app.cache, 'pages', () => pageApi.list())
  const [creating, setCreating] = useState(false)
  const active = (bots ?? []).filter((bot) => bot.archivedAt === null)
  const byId = new Map(active.map((bot) => [bot.id, bot]))
  const roomById = new Map((rooms ?? []).map((room) => [room.id, room]))
  // 发到负责的 bot 自己的单聊（主管建的例程会记成那个单聊房间）也写“单聊”，不写成「主管」这种房间名。
  const targetOf = (routine: RoutineView): string => {
    const room = routine.roomId === null ? undefined : roomById.get(routine.roomId)
    if (routine.roomId === null || (room?.kind === 'direct' && room.botId === routine.botId)) return '单聊'
    return `「${room?.title ?? '已删除的群聊'}」`
  }
  const list = (routines ?? []).filter((routine) => props.match === undefined || props.match(routine))
  return (
    <div className="pod-stack">
      {routines !== undefined && list.length === 0 && !creating ? <Empty title="还没有自动化">{props.empty ?? '也可以直接跟主管说“每天 8 点给我整理资讯”。'}</Empty> : null}
      {list.length === 0 ? null : (
        <div className="pod-auto-list">
          {list.map((routine) => (
            <RoutineRow
              key={routine.id}
              routine={routine}
              bot={byId.get(routine.botId)}
              bots={active}
              target={targetOf(routine)}
              onChanged={reload}
            />
          ))}
        </div>
      )}
      {creating ? (
        <RoutineForm
          bots={active}
          rooms={(rooms ?? []).filter((room) => room.kind !== 'direct')}
          pages={pages ?? []}
          defaults={props.defaults}
          onDone={() => {
            setCreating(false)
            reload()
          }}
          onCancel={() => setCreating(false)}
        />
      ) : (
        <div>
          <Button icon="plus" onClick={() => setCreating(true)}>
            新建自动化
          </Button>
        </div>
      )}
    </div>
  )
}
