import { useEffect, useState, type CSSProperties, type ReactNode } from 'react'
import { isAvatarImage, nameColors, type NameColors } from 'pod-domain'
import { mediaUrl } from '../api/http.ts'
import { BotFigure, BotIcon, iconOf, type IconBot } from './BotIcon.tsx'
import { Icon } from './Icon.tsx'
import { useNarrow } from './media.ts'

/** 头像：你上传的图片；没有图片时用内置的鲸鱼娘图标（没选时按角色配）。 */
export function Avatar(props: { readonly bot?: IconBot; readonly size?: number; readonly status?: 'busy' | 'waiting' | 'idle' }) {
  const size = props.size ?? 32
  const avatar = props.bot?.avatar ?? ''
  return (
    <span className="pod-avatar" style={{ width: size, height: size }} aria-hidden>
      {isAvatarImage(avatar) ? <img className="pod-avatar-image" src={mediaUrl('/avatar', { file: avatar.slice(4) })} alt="" /> : <BotIcon kind={iconOf(props.bot)} size={size} />}
      {props.status === undefined ? null : <span className={`pod-avatar-dot pod-avatar-dot-${props.status}`} />}
    </span>
  )
}

/** 同一种颜色只算一次：名字到处都是。 */
const NAME_COLORS = new Map<string, NameColors>()

/**
 * bot 名字的颜色：配合 .pod-bot-name（和色板、群图标）用。给出浅色、深色背景上各自的颜色，样式按 dsh 现在的深浅选一个（--pod-name）。
 * 你自己、Pod 和找不到的 bot 不上色。
 */
export function nameColor(bot: { readonly id: string; readonly color?: string } | undefined): CSSProperties | undefined {
  if (bot === undefined) return undefined
  const key = `${bot.color ?? ''}|${bot.color === undefined || bot.color === '' ? bot.id : ''}`
  const colors = NAME_COLORS.get(key) ?? nameColors(bot)
  if (!NAME_COLORS.has(key)) NAME_COLORS.set(key, colors)
  return { '--pod-name-light': colors.light, '--pod-name-dark': colors.dark } as CSSProperties
}

/** 详情页的大头像：上传的图片用圆形；内置图标用带底色的全身图，能看到它手里拿的东西。 */
export function HeroAvatar(props: { readonly bot: IconBot }) {
  return isAvatarImage(props.bot.avatar) ? <Avatar bot={props.bot} size={88} /> : <BotFigure kind={iconOf(props.bot)} size={112} tinted />
}

/** 弹窗和抽屉的标题栏：宽屏是标题加右边的关闭；手机上整页显示，换成左边的返回加标题。 */
function SheetHead(props: { readonly className: string; readonly title: string; readonly onClose: () => void }) {
  const narrow = useNarrow()
  return (
    <header className={props.className}>
      {narrow ? <IconButton icon="back" label="返回" onClick={props.onClose} /> : null}
      <h2>{props.title}</h2>
      {narrow ? null : <IconButton icon="close" label="关闭" onClick={props.onClose} />}
    </header>
  )
}

/** 弹窗：居中显示，点背景或按 Esc 关闭。手机上占满整屏。 */
export function Modal(props: { readonly title: string; readonly onClose: () => void; readonly children: ReactNode; readonly wide?: boolean }) {
  useEffect(() => {
    const onKey = (event: KeyboardEvent): void => {
      if (event.key === 'Escape') props.onClose()
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [props])
  return (
    <div className="pod-modal-backdrop" onClick={props.onClose}>
      <section className={`pod-modal${props.wide === true ? ' pod-modal-wide' : ''}`} role="dialog" aria-label={props.title} onClick={(event) => event.stopPropagation()}>
        <SheetHead className="pod-modal-head" title={props.title} onClose={props.onClose} />
        <div className="pod-modal-body">{props.children}</div>
      </section>
    </div>
  )
}

/** 一组互斥选项，像开关一样排在一起。 */
export function Segmented<T extends string>(props: { readonly value: T; readonly options: readonly (readonly [T, string])[]; readonly onChange: (value: T) => void; readonly label?: string }) {
  return (
    <span className="pod-segmented" role="group" aria-label={props.label}>
      {props.options.map(([value, label]) => (
        <button key={value} type="button" className={value === props.value ? 'pod-segmented-on' : undefined} aria-pressed={value === props.value} onClick={() => props.onChange(value)}>
          {label}
        </button>
      ))}
    </span>
  )
}

/** 开关。 */
export function Switch(props: { readonly checked: boolean; readonly onChange: (value: boolean) => void; readonly label: string }) {
  return (
    <button type="button" className={`pod-switch${props.checked ? ' pod-switch-on' : ''}`} role="switch" aria-checked={props.checked} aria-label={props.label} onClick={() => props.onChange(!props.checked)}>
      <span />
    </button>
  )
}

/** 美元金额：一分钱以下保留四位。 */
export function money(cost: number): string {
  if (cost === 0) return '$0'
  return cost < 0.01 ? `$${cost.toFixed(4)}` : `$${cost.toFixed(2)}`
}

/** token 数：1.9M、32.5K、2M（去掉多余的零）。 */
export function tokens(count: number): string {
  const trim = (value: string): string => value.replace(/\.0+$|(\.\d*?)0+$/, '$1')
  if (count < 1000) return String(Math.round(count))
  if (count < 1_000_000) return `${trim((count / 1000).toFixed(1))}K`
  return `${trim((count / 1_000_000).toFixed(count >= 10_000_000 ? 1 : 2))}M`
}

export function Button(props: {
  readonly children: ReactNode
  readonly onClick?: () => void
  readonly kind?: 'primary' | 'quiet' | 'danger' | 'default'
  readonly disabled?: boolean
  readonly icon?: string
  readonly title?: string
  readonly type?: 'button' | 'submit'
  readonly small?: boolean
}) {
  const kind = props.kind ?? 'default'
  return (
    <button
      type={props.type ?? 'button'}
      className={`pod-button pod-button-${kind}${props.small === true ? ' pod-button-small' : ''}`}
      onClick={props.onClick}
      disabled={props.disabled}
      title={props.title}
    >
      {props.icon === undefined ? null : <Icon name={props.icon} size={14} />}
      {props.children}
    </button>
  )
}

export function IconButton(props: { readonly icon: string; readonly label: string; readonly onClick: () => void; readonly disabled?: boolean }) {
  return (
    <button type="button" className="pod-icon-button" onClick={props.onClick} disabled={props.disabled} title={props.label} aria-label={props.label}>
      <Icon name={props.icon} size={15} />
    </button>
  )
}

function relative(time: number, now: number): string {
  const seconds = Math.round((now - time) / 1000)
  if (seconds < 45) return '刚刚'
  const minutes = Math.round(seconds / 60)
  if (minutes < 60) return `${minutes} 分钟前`
  const hours = Math.round(minutes / 60)
  if (hours < 24) return `${hours} 小时前`
  const date = new Date(time)
  return `${date.getMonth() + 1}月${date.getDate()}日`
}

/** 每 30 秒刷新一次的“几分钟前”。 */
export function useNow(intervalMs = 30_000): number {
  const [now, setNow] = useState(() => Date.now())
  useEffect(() => {
    const timer = setInterval(() => setNow(Date.now()), intervalMs)
    return () => clearInterval(timer)
  }, [intervalMs])
  return now
}

export function RelativeTime(props: { readonly time: number | null | undefined }) {
  const now = useNow()
  if (props.time === null || props.time === undefined) return null
  return <time dateTime={new Date(props.time).toISOString()} title={new Date(props.time).toLocaleString()}>{relative(props.time, now)}</time>
}

const WEEKDAYS = ['周日', '周一', '周二', '周三', '周四', '周五', '周六'] as const

/** 列表上的时间：今天写几点几分，昨天写“昨天”，一周内写星期几，再早写日期（不是今年的带上年份）。 */
export function listTime(time: number, now: number): string {
  const date = new Date(time)
  const today = new Date(now)
  const days = Math.round((new Date(today.getFullYear(), today.getMonth(), today.getDate()).getTime() - new Date(date.getFullYear(), date.getMonth(), date.getDate()).getTime()) / 86_400_000)
  if (days <= 0) return clock(time)
  if (days === 1) return '昨天'
  if (days < 7) return WEEKDAYS[date.getDay()] ?? ''
  const day = `${date.getMonth() + 1}/${date.getDate()}`
  return date.getFullYear() === today.getFullYear() ? day : `${date.getFullYear()}/${day}`
}

export function clock(time: number): string {
  const date = new Date(time)
  return `${String(date.getHours()).padStart(2, '0')}:${String(date.getMinutes()).padStart(2, '0')}`
}

export function Empty(props: { readonly title: string; readonly children?: ReactNode }) {
  return (
    <div className="pod-empty">
      <strong>{props.title}</strong>
      {props.children === undefined ? null : <div>{props.children}</div>}
    </div>
  )
}

export function ErrorBanner(props: { readonly message: string; readonly onClose?: () => void }) {
  return (
    <div className="pod-error" role="alert">
      <span>{props.message}</span>
      {props.onClose === undefined ? null : <IconButton icon="close" label="关闭" onClick={props.onClose} />}
    </div>
  )
}

export function Badge(props: { readonly children: ReactNode; readonly tone?: 'warn' | 'info' | 'ok' | 'muted' | 'danger' }) {
  return <span className={`pod-badge pod-badge-${props.tone ?? 'muted'}`}>{props.children}</span>
}

/** 抽屉：从右侧滑出，放详情和编辑表单。手机上占满整屏。 */
export function Drawer(props: { readonly title: string; readonly onClose: () => void; readonly children: ReactNode; readonly wide?: boolean }) {
  useEffect(() => {
    const onKey = (event: KeyboardEvent): void => {
      if (event.key === 'Escape') props.onClose()
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [props])
  return (
    <div className="pod-drawer-backdrop" onClick={props.onClose}>
      <aside className={`pod-drawer${props.wide === true ? ' pod-drawer-wide' : ''}`} onClick={(event) => event.stopPropagation()} aria-label={props.title}>
        <SheetHead className="pod-drawer-head" title={props.title} onClose={props.onClose} />
        <div className="pod-drawer-body">{props.children}</div>
      </aside>
    </div>
  )
}

export function Field(props: { readonly label: string; readonly hint?: string; readonly children: ReactNode }) {
  return (
    <label className="pod-field">
      <span className="pod-field-row">
        <span>{props.label}</span>
        {props.hint === undefined ? null : <span className="pod-hint">{props.hint}</span>}
      </span>
      {props.children}
    </label>
  )
}
