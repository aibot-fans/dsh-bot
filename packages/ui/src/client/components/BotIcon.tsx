import { BOT_ICON_LABELS, BOT_ICON_SET, avatarIcon, guessBotIcon, t, type Bot, type BotIconKind } from 'pod-domain'
import { mediaUrl } from '../api/http.ts'

/** 画图标要用到的 bot 字段；只给了名字和头像时也能猜个大概。 */
export type IconBot = Pick<Bot, 'id' | 'name' | 'avatar'> & Partial<Pick<Bot, 'role' | 'title' | 'capabilities' | 'card' | 'color'>>

/** 这个 bot 该显示哪个小图标：选好的就用选好的，没选时按角色猜。 */
export function iconOf(bot: IconBot | undefined): BotIconKind {
  if (bot === undefined) return 'member'
  return avatarIcon(bot.avatar) ?? guessBotIcon({ ...bot, role: bot.role ?? 'member' })
}

/** 每种图标圆底的色相：鲸鱼形象都一样，小尺寸时靠底色分辨；相近的角色用相近的颜色。 */
const HUE: Readonly<Record<BotIconKind, number>> = {
  lead: 222,
  ceo: 45,
  member: 205,
  coder: 152,
  engineer: 168,
  architect: 186,
  tester: 128,
  devops: 105,
  sysadmin: 196,
  researcher: 36,
  analyst: 262,
  data: 244,
  writer: 340,
  translator: 318,
  designer: 292,
  product: 18,
  project: 8,
  operations: 54,
  marketing: 0,
  sales: 28,
  support: 176,
  broadcast: 232,
  assistant: 276,
  secretary: 350,
  admin: 76,
  reception: 62,
  hr: 328,
  finance: 90,
  legal: 212,
  intern: 116,
}

/** 图标的底色：按色相调一个浅色，跟着 dsh 的深浅主题走。 */
function tintOf(kind: BotIconKind): string {
  return `color-mix(in srgb, hsl(${HUE[kind]} 85% 70%) 32%, var(--dsw-alias-bg-layer-1, #fff))`
}

/** 内置图标的图片：head 是圆形小头像用的头部特写，full 是全身图。 */
function iconUrl(kind: BotIconKind, size: 'head' | 'full'): string {
  return mediaUrl('/bot-icon', { kind, size, v: BOT_ICON_SET })
}

/** 小头像：浅色圆底上的鲸鱼头部特写。 */
export function BotIcon(props: { readonly kind: BotIconKind; readonly size?: number; readonly label?: string }) {
  const size = props.size ?? 32
  const a11y = props.label === undefined ? { 'aria-hidden': true } : { role: 'img', 'aria-label': props.label }
  return (
    <span className="pod-boticon" style={{ width: size, height: size, background: tintOf(props.kind) }} {...a11y}>
      <img src={iconUrl(props.kind, 'head')} alt="" draggable={false} decoding="async" />
    </span>
  )
}

/** 全身图：能看到它手里拿的东西。详情页的大头像带底色，选图标的格子里不带。 */
export function BotFigure(props: { readonly kind: BotIconKind; readonly size: number; readonly tinted?: boolean }) {
  const tinted = props.tinted === true
  return (
    <span className={`pod-botfigure${tinted ? ' pod-botfigure-tinted' : ''}`} style={{ width: props.size, height: props.size, background: tinted ? tintOf(props.kind) : undefined }} aria-hidden>
      <img src={iconUrl(props.kind, 'full')} alt="" draggable={false} loading={tinted ? undefined : 'lazy'} decoding="async" />
    </span>
  )
}

/** 一格一格可以点的全身图，下面写着角色；current 是现在用的那个，会圈出来。 */
export function IconChoices(props: { readonly kinds: readonly BotIconKind[]; readonly current: BotIconKind | undefined; readonly onPick: (kind: BotIconKind) => void }) {
  return (
    <>
      {props.kinds.map((kind) => {
        const on = kind === props.current
        return (
          <button
            key={kind}
            type="button"
            className={`pod-icon-pick${on ? ' pod-icon-pick-on' : ''}`}
            aria-pressed={on}
            aria-label={t('{label}图标{value}', { label: t(BOT_ICON_LABELS[kind]), value: on ? t('（当前）') : '' })}
            title={t(BOT_ICON_LABELS[kind])}
            onClick={() => props.onPick(kind)}
          >
            <BotFigure kind={kind} size={56} />
            <span className="pod-icon-pick-label">{t(BOT_ICON_LABELS[kind])}</span>
          </button>
        )
      })}
    </>
  )
}
