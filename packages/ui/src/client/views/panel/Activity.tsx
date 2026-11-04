import { useState } from 'react'
import { t, type ActivityEntry, type ActivityItem, type ActivityJob, type ActivityMark, type Bot } from 'pod-domain'
import { api } from '../../api/endpoints.ts'
import { errorText } from '../../api/http.ts'
import { Avatar, clock, useNow } from '../../components/common.tsx'
import { stamp } from '../../components/duration.ts'
import { Icon } from '../../components/Icon.tsx'
import { StateIcon } from '../../components/TaskEntry.tsx'
import { useApp, type PanelState } from '../../state/app.ts'
import { useResource } from '../../state/resource.ts'

/** 最近几件活展开着，更早的折成一行。 */
const OPEN_JOBS = 3

/** 一件活先列最后几行，前面的点开再看。 */
const SHOWN_ENTRIES = 8

/** 今天的只写几点几分，别的天带上月日。 */
function whenText(time: number, now: number): string {
  return new Date(time).toDateString() === new Date(now).toDateString() ? clock(time) : stamp(time)
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

/** 一行：做成的一步打勾，交给成员的是箭头，最后一行是这件活现在的状态；连着对话里一句的点了跳过去。 */
function EntryRow(props: { readonly entry: ActivityEntry; readonly now: number; readonly jump: (messageId: string) => void }) {
  const { entry } = props
  const icon =
    entry.state !== null ? (
      <StateIcon state={entry.state} />
    ) : (
      <span className={entry.kind === 'handoff' ? 'pod-act-handoff' : 'pod-act-check'} aria-hidden>
        <Icon name={entry.kind === 'handoff' ? 'forward' : 'check'} size={12} />
      </span>
    )
  const tone = entry.kind !== 'end' ? '' : entry.state === 'failed' ? ' pod-act-bad' : entry.at === null ? ' pod-act-live' : ' pod-act-end'
  const body = (
    <>
      {icon}
      <span className="pod-act-text">{entry.text}</span>
      {entry.at === null ? null : <time className="pod-act-time">{whenText(entry.at, props.now)}</time>}
    </>
  )
  if (entry.messageId === null) return <div className={`pod-act-e${tone}`}>{body}</div>
  return (
    <button type="button" className={`pod-act-e pod-act-link${tone}`} title={t('跳到对话里这一句')} onClick={() => props.jump(entry.messageId ?? '')}>
      {body}
    </button>
  )
}

/** 一件活：状态、标题（点了看任务详情）、谁在干、你怎么说的，下面是它的几行。 */
function JobItem(props: { readonly job: ActivityJob; readonly bots: ReadonlyMap<string, Bot>; readonly back: PanelState; readonly current?: string; readonly now: number; readonly jump: (messageId: string) => void }) {
  const app = useApp()
  const [all, setAll] = useState(false)
  const { job } = props
  const hidden = all ? 0 : Math.max(0, job.entries.length - SHOWN_ENTRIES)
  const people = job.botIds.flatMap((id) => props.bots.get(id) ?? [])
  const said = job.said === null ? null : t('你说：{said}', { said: job.said })
  return (
    <li className="pod-act-g">
      <span className="pod-act-gi">
        <StateIcon state={job.state} />
      </span>
      <div className="pod-act-gh">
        {job.taskId === props.current ? (
          <span className="pod-act-title">{job.title}</span>
        ) : (
          <button type="button" className="pod-act-title pod-act-open" title={t('看这件事的详情')} onClick={() => app.showTask(job.taskId, props.back)}>
            {job.title}
          </button>
        )}
        <time className="pod-act-time">{whenText(job.at, props.now)}</time>
      </div>
      {people.length === 0 && said === null ? null : (
        <div className="pod-act-who">
          {people.map((bot) => (
            <span key={bot.id} className="pod-act-person">
              <Avatar bot={bot} size={15} />
              {bot.name}
            </span>
          ))}
          {said === null ? null : job.saidMessageId === null ? (
            <span className="pod-act-said">{said}</span>
          ) : (
            <button type="button" className="pod-act-said" title={t('跳到这句话')} onClick={() => props.jump(job.saidMessageId ?? '')}>
              {said}
            </button>
          )}
        </div>
      )}
      {hidden === 0 ? null : (
        <button type="button" className="pod-act-more" onClick={() => setAll(true)}>
          {t('前面还有 {count} 条', { count: hidden })}
        </button>
      )}
      {job.entries.slice(hidden).map((entry, index) => (
        <EntryRow key={`${String(entry.at)}:${index + hidden}`} entry={entry} now={props.now} jump={props.jump} />
      ))}
    </li>
  )
}

/** 一行里程碑：建群、谁进群出群。 */
function MarkItem(props: { readonly mark: ActivityMark; readonly now: number }) {
  return (
    <li className="pod-act-g">
      <span className="pod-act-gi">
        <span className="pod-act-mark" aria-hidden>
          <Icon name={props.mark.mark === 'created' ? 'plus' : 'team'} size={11} />
        </span>
      </span>
      <div className="pod-act-gh">
        <span className="pod-act-title pod-act-muted">{props.mark.text}</span>
        <time className="pod-act-time">{whenText(props.mark.at, props.now)}</time>
      </div>
    </li>
  )
}

/**
 * 动态：先的在上面。建群那一行总在最上面，最近 3 件活展开，更早的活和进出群折成一行，点开全看。
 * current 是正在看的任务（任务详情里）：它的标题不再能点。
 */
export function ActivityList(props: { readonly items: readonly ActivityItem[]; readonly back: PanelState; readonly empty: string; readonly current?: string }) {
  const app = useApp()
  const now = useNow()
  const [expanded, setExpanded] = useState(false)
  const [problem, setProblem] = useState<string | undefined>(undefined)
  const { data: bots } = useResource(app.cache, 'bots', () => api.bots())
  const byId = new Map((bots ?? []).map((bot) => [bot.id, bot]))
  const jump = useJump(setProblem)
  if (props.items.length === 0) return <p className="pod-act-empty">{props.empty}</p>
  const first = props.items[0]
  const head = first?.kind === 'mark' && first.mark === 'created' ? [first] : []
  const rest = props.items.slice(head.length)
  const jobs = rest.filter((item): item is ActivityJob => item.kind === 'job')
  const cut = expanded || jobs.length <= OPEN_JOBS ? undefined : jobs[jobs.length - OPEN_JOBS]
  const folded = cut === undefined ? [] : rest.filter((item) => item.at < cut.at)
  const shown = cut === undefined ? rest : rest.filter((item) => item.at >= cut.at)
  const count = folded.filter((item) => item.kind === 'job').length
  const item = (entry: ActivityItem) =>
    entry.kind === 'mark' ? (
      <MarkItem key={entry.key} mark={entry} now={now} />
    ) : (
      <JobItem key={entry.key} job={entry} bots={byId} back={props.back} now={now} jump={jump} {...(props.current === undefined ? {} : { current: props.current })} />
    )
  return (
    <>
      <ol className="pod-act">
        {head.map(item)}
        {folded.length === 0 ? null : (
          <li className="pod-act-g">
            <span className="pod-act-gi">
              <span className="pod-act-dots" aria-hidden>
                <i />
                <i />
                <i />
              </span>
            </span>
            <div className="pod-act-gh">
              <button type="button" className="pod-act-title pod-act-muted pod-act-open" onClick={() => setExpanded(true)}>
                {count > 0 ? t('更早的 {count} 件', { count }) : t('更早的进出群')}
              </button>
            </div>
          </li>
        )}
        {shown.map(item)}
      </ol>
      {problem === undefined ? null : <p className="pod-form-error">{problem}</p>}
    </>
  )
}

/** 群、单聊详情里的「动态」：这段对话里干过的活，点标题看任务详情（能返回这里）。 */
export function RoomActivityBox(props: { readonly roomId: string; readonly back: PanelState; readonly hint: string; readonly empty: string }) {
  const app = useApp()
  const { data, error } = useResource(app.cache, `room-activity:${props.roomId}`, () => api.roomActivity(props.roomId))
  return (
    <section className="pod-box">
      <div className="pod-box-head">
        <strong>{t('动态')}</strong>
        <span className="pod-muted-inline">{props.hint}</span>
      </div>
      <div className="pod-act-body">{data === undefined ? <p className="pod-act-empty">{error ?? t('正在读取…')}</p> : <ActivityList items={data.items} back={props.back} empty={props.empty} />}</div>
    </section>
  )
}

/** 任务详情里的「动态」：有任务对话的按交代和每次接着说分组，没有的就是它那一组。 */
export function TaskActivityBox(props: { readonly taskId: string; readonly rootId: string; readonly back: PanelState }) {
  const app = useApp()
  const { data, error } = useResource(app.cache, `task-activity:${props.rootId}`, () => api.taskActivity(props.taskId))
  return (
    <section className="pod-box">
      <div className="pod-box-head">
        <strong>{t('动态')}</strong>
      </div>
      <div className="pod-act-body">
        {data === undefined ? <p className="pod-act-empty">{error ?? t('正在读取…')}</p> : <ActivityList items={data} back={props.back} current={props.rootId} empty={t('干活的 bot 做成一步会记在这里')} />}
      </div>
    </section>
  )
}
