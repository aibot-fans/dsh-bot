import { WAIT_KIND_LABELS, t, type Bot, type TaskSnapshot, type Wait } from 'pod-domain'
import { api } from '../../api/endpoints.ts'
import { Avatar, RelativeTime } from '../../components/common.tsx'
import { GroupMark } from '../../components/GroupMark.tsx'
import { Markdown } from '../../components/Markdown.tsx'
import { TaskDecision } from '../../components/TaskDecision.tsx'
import { TaskStateIcon, bucketLabel, isMoving, type TaskBucket } from '../../components/TaskEntry.tsx'
import { Undelivered } from '../../components/taskParts.tsx'
import { WaitAsk } from '../../components/WaitAsk.tsx'
import { useApp } from '../../state/app.ts'
import { useResource } from '../../state/resource.ts'

/** 这件事里有谁：开了群的是群成员，没开群的是做事的 bot。 */
function useMembers(snapshot: TaskSnapshot, bots: ReadonlyMap<string, Bot>): readonly Bot[] {
  const app = useApp()
  const { data: rooms } = useResource(app.cache, 'rooms', () => api.rooms())
  const group = snapshot.groupRoomId === null ? undefined : rooms?.find((room) => room.id === snapshot.groupRoomId)
  const ids = group?.memberIds ?? (snapshot.task.ownerBotId === null ? [] : [snapshot.task.ownerBotId])
  return ids.map((id) => bots.get(id)).filter((bot): bot is Bot => bot !== undefined)
}

function Members(props: { readonly members: readonly Bot[] }) {
  const [first] = props.members
  if (first === undefined) return null
  return props.members.length > 1 ? <GroupMark members={props.members} size={20} /> : <Avatar bot={first} size={20} />
}

/** 要你定的那句话和后面的按钮：问你的事就是那个问题；交上来的是摘要加收下、再改改；受阻、没做成的是原因加重试、不做了。 */
function Ask(props: { readonly snapshot: TaskSnapshot; readonly onRevise: () => void }) {
  const { snapshot } = props
  if (snapshot.question !== null) return <WaitAsk wait={snapshot.question} />
  if (snapshot.stage === 'undelivered') return <Undelivered snapshot={snapshot} />
  const summary = snapshot.lastReport?.summary ?? ''
  return (
    <div className="pod-ask">
      {summary === '' ? null : <Markdown text={summary} />}
      <TaskDecision taskId={snapshot.task.id} onRevise={props.onRevise} />
    </div>
  )
}

/**
 * 概览里的一件事：状态图标、标题、成员头像、多久前有动静；等你的下面是那句话和两个按钮。
 * 点标题进这件事的群，没开群的打开「过程」；再改改是去那个对话里引用结果说要改哪里。
 */
export function TaskRow(props: { readonly snapshot: TaskSnapshot; readonly bucket: TaskBucket; readonly bots: ReadonlyMap<string, Bot> }) {
  const app = useApp()
  const { snapshot, bucket } = props
  const { task } = snapshot
  const members = useMembers(snapshot, props.bots)
  const room = snapshot.groupRoomId ?? task.roomId
  const label = bucketLabel(snapshot, bucket)
  // 等到点、等新消息、你停掉的：图标看不出来，后面写一句。
  const note = (bucket === 'working' && !isMoving(snapshot)) || bucket === 'ended' ? label : null
  return (
    <li className="pod-otask">
      <div className="pod-otask-row">
        <TaskStateIcon snapshot={snapshot} />
        <button type="button" className="pod-otask-title" title={label} onClick={() => (snapshot.groupRoomId === null ? app.openTask(task.id) : app.openRoom(snapshot.groupRoomId))}>
          <span className="pod-ellipsis">{task.title}</span>
        </button>
        {note === null ? null : <span className="pod-muted-inline">{note}</span>}
        <span className="pod-grow" />
        <Members members={members} />
        <span className="pod-otask-time">
          <RelativeTime time={task.updatedAt} />
        </span>
      </div>
      {bucket === 'attention' ? (
        <div className="pod-otask-ask">
          <Ask
            snapshot={snapshot}
            onRevise={() => {
              if (room !== null) app.openRoom(room)
            }}
          />
        </div>
      ) : null}
    </li>
  )
}

/** 不属于哪个任务的等你（对话里 bot 直接问你的）：问的是哪类事、谁问的，下面是那句话和按钮。 */
export function WaitRow(props: { readonly wait: Wait; readonly bot: Bot | undefined }) {
  const app = useApp()
  const { wait } = props
  const label = t(WAIT_KIND_LABELS[wait.kind])
  return (
    <li className="pod-otask">
      <div className="pod-otask-row">
        <span className="pod-state-icon pod-state-attention" aria-hidden />
        {wait.roomId === null ? (
          <span className="pod-otask-title pod-ellipsis">{label}</span>
        ) : (
          <button type="button" className="pod-otask-title" onClick={() => app.openRoom(wait.roomId ?? '')}>
            <span className="pod-ellipsis">{label}</span>
          </button>
        )}
        <span className="pod-grow" />
        {props.bot === undefined ? null : <Avatar bot={props.bot} size={20} />}
        <span className="pod-otask-time">
          <RelativeTime time={wait.createdAt} />
        </span>
      </div>
      <div className="pod-otask-ask">
        <WaitAsk wait={wait} />
      </div>
    </li>
  )
}
