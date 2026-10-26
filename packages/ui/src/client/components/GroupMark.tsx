import { iconAvatar } from 'pod-domain'
import type { IconBot } from './BotIcon.tsx'
import { Avatar, nameColor } from './common.tsx'

/** 还不知道成员时的群图标：领导加一个万能助手。 */
const PAIR: readonly IconBot[] = [
  { id: 'pair-lead', name: '主管', avatar: iconAvatar('lead'), role: 'lead' },
  { id: 'pair-member', name: '成员', avatar: iconAvatar('member') },
]

/** 群图标最多拼几格；成员更多时前几格放成员，最后一格写“+N”。 */
const MARK_CELLS = 4

/**
 * 群聊的图标：成员的小图标拼在一起，每一格垫着这个成员的颜色，拉人、踢人一眼看得出来。
 * 不超过 4 个全放上，主管排在最后；超过 4 个放前 3 个，第 4 格写“+N”。还不知道成员时用领导和万能助手两个。
 */
export function GroupMark(props: { readonly members?: readonly IconBot[]; readonly size?: number }) {
  const size = props.size ?? 26
  const all = props.members ?? []
  const ordered = [...all.filter((bot) => bot.role !== 'lead'), ...all.filter((bot) => bot.role === 'lead')]
  const known = ordered.length < 2 ? PAIR : ordered
  const shown = known.length <= MARK_CELLS ? known : known.slice(0, MARK_CELLS - 1)
  const more = known.length - shown.length
  const cells = shown.length + (more > 0 ? 1 : 0)
  const cell = Math.max(8, Math.floor((size - 1) / 2) - 1)
  return (
    <span className={`pod-group-mark pod-group-mark-${cells}`} style={{ width: size, height: size }} aria-hidden>
      {shown.map((bot) => (
        <span key={bot.id} className="pod-group-cell" style={nameColor(bot)}>
          <Avatar bot={bot} size={cell} />
        </span>
      ))}
      {more > 0 ? (
        <span className="pod-group-cell pod-group-more" style={{ fontSize: Math.max(8, Math.round(size * 0.3)) }}>
          +{more}
        </span>
      ) : null}
    </span>
  )
}

/** 选一个 bot：一排带图标的名字，点一下选中（代替只有文字的下拉框）。 */
export function BotPicker(props: { readonly bots: readonly IconBot[]; readonly value: string; readonly onChange: (id: string) => void; readonly label: string }) {
  return (
    <div className="pod-bot-picker" role="radiogroup" aria-label={props.label}>
      {props.bots.map((bot) => (
        <button key={bot.id} type="button" role="radio" aria-checked={bot.id === props.value} className={`pod-chip${bot.id === props.value ? ' pod-chip-active' : ''}`} onClick={() => props.onChange(bot.id)}>
          <Avatar bot={bot} size={18} />
          {bot.name}
        </button>
      ))}
    </div>
  )
}

/** bot 的图标加名字：列表、说明文字和表格里提到 bot 时都用它。 */
export function BotName(props: { readonly bot: IconBot | undefined; readonly fallback?: string; readonly size?: number }) {
  return (
    <span className="pod-botname">
      {props.bot === undefined ? null : <Avatar bot={props.bot} size={props.size ?? 16} />}
      <span className={`pod-botname-text${props.bot === undefined ? '' : ' pod-bot-name'}`} style={nameColor(props.bot)}>
        {props.bot?.name ?? props.fallback ?? '已删除的 bot'}
      </span>
    </span>
  )
}
