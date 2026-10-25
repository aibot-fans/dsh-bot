import { useRef, useState, type CSSProperties } from 'react'
import { BOT_ICONS, BOT_NAME_MAX, BOT_TITLE_MAX, CAPABILITY_MAX, MEMBER_ICONS, botColorBatch, botColorHex, iconAvatar, isAvatarImage, type Bot } from 'pod-domain'
import { api } from '../../api/endpoints.ts'
import { errorText } from '../../api/http.ts'
import { IconChoices, iconOf } from '../../components/BotIcon.tsx'
import { Button, Empty, HeroAvatar, IconButton, nameColor } from '../../components/common.tsx'
import { Icon } from '../../components/Icon.tsx'
import { useApp, type BotTab } from '../../state/app.ts'
import { useResource } from '../../state/resource.ts'
import { ScopedPages } from '../pages/ScopedPages.tsx'
import { Automations } from '../settings/Routines.tsx'
import { BotDetails } from './BotDetails.tsx'
import { TabList } from './BrowserTabs.tsx'
import { Library } from './Library.tsx'
import { MemberCard } from './MemberCard.tsx'

const TABS: readonly (readonly [BotTab, string])[] = [
  ['details', '详情'],
  ['pages', '页面'],
  ['library', '资料库'],
  ['automations', '自动化'],
  ['browser', '浏览器'],
]

function readBase64(file: File): Promise<string> {
  return new Promise((resolve, reject) => {
    const reader = new FileReader()
    reader.onload = () => {
      const result = String(reader.result ?? '')
      resolve(result.slice(result.indexOf(',') + 1))
    }
    reader.onerror = () => reject(reader.error ?? new Error('读不了这张图片'))
    reader.readAsDataURL(file)
  })
}

/** 一次给多少种颜色挑（加上现在的一共 24 个）。 */
const COLOR_BATCH = 23

/** 名字颜色：第一个是现在的，后面是一批随机的、深浅色背景上都看得清的颜色，点一个就换；不满意换一批。 */
function ColorChoices(props: { readonly bot: Bot; readonly onPick: (color: string) => void }) {
  const current = botColorHex(props.bot)
  const [batch, setBatch] = useState(() => botColorBatch(COLOR_BATCH))
  return (
    <div className="pod-color-picker">
      <div className="pod-color-grid" role="radiogroup" aria-label="名字颜色">
        {[current, ...batch].map((color, index) => (
          <button
            key={`${index}${color}`}
            type="button"
            role="radio"
            aria-checked={index === 0}
            aria-label={index === 0 ? `现在的颜色 ${color}` : color}
            title={index === 0 ? '现在的颜色' : color}
            className={`pod-color-swatch${index === 0 ? ' pod-color-swatch-on' : ''}`}
            style={{ '--pod-bot-color': color } as CSSProperties}
            onClick={() => (index === 0 ? undefined : props.onPick(color))}
          />
        ))}
      </div>
      <Button small kind="quiet" icon="refresh" onClick={() => setBatch(botColorBatch(COLOR_BATCH))}>
        换一批
      </Button>
    </div>
  )
}

/** 头部：大头像（点开换小图标或上传图片）、名字和角色（铅笔改）、名字颜色（色点改）、能力标签（可加可删）。 */
function BotHead(props: { readonly bot: Bot }) {
  const app = useApp()
  const { bot } = props
  const [picking, setPicking] = useState(false)
  const [coloring, setColoring] = useState(false)
  const [editing, setEditing] = useState(false)
  const [name, setName] = useState(bot.name)
  const [title, setTitle] = useState(bot.title)
  const [tag, setTag] = useState('')
  const [addingTag, setAddingTag] = useState(false)
  const [problem, setProblem] = useState<string | undefined>(undefined)
  const fileInput = useRef<HTMLInputElement>(null)
  const save = (patch: Readonly<Record<string, unknown>>, done?: () => void): void => {
    setProblem(undefined)
    api
      .updateBot(bot.id, patch)
      .then(() => {
        app.cache.invalidate('bots')
        app.cache.invalidate('rooms')
        done?.()
      })
      .catch((reason: unknown) => setProblem(errorText(reason)))
  }
  const upload = (file: File | undefined): void => {
    if (file === undefined) return
    setProblem(undefined)
    readBase64(file)
      .then((data) => api.uploadAvatar(bot.id, file.name, data))
      .then(() => {
        app.cache.invalidate('bots')
        setPicking(false)
      })
      .catch((reason: unknown) => setProblem(errorText(reason)))
      .finally(() => {
        if (fileInput.current !== null) fileInput.current.value = ''
      })
  }
  return (
    <div className="pod-panel-hero">
      <input ref={fileInput} type="file" accept="image/png,image/jpeg,image/webp,image/gif" hidden onChange={(event) => upload(event.target.files?.[0])} />
      <button type="button" className="pod-hero-avatar" onClick={() => setPicking((open) => !open)} aria-label="换图标" aria-expanded={picking} title="换图标">
        <HeroAvatar bot={bot} />
        <span className="pod-hero-avatar-edit" aria-hidden>
          <Icon name="edit" size={13} />
        </span>
      </button>
      {picking ? (
        <div className="pod-icon-picker" role="group" aria-label="选一个图标">
          <IconChoices
            kinds={bot.role === 'lead' ? BOT_ICONS : MEMBER_ICONS}
            current={isAvatarImage(bot.avatar) ? undefined : iconOf(bot)}
            onPick={(kind) => save({ avatar: iconAvatar(kind) }, () => setPicking(false))}
          />
          <button type="button" className="pod-icon-pick pod-icon-pick-upload" title="上传图片" onClick={() => fileInput.current?.click()}>
            <span className="pod-icon-pick-blank" aria-hidden>
              <Icon name="upload" size={18} />
            </span>
            <span className="pod-icon-pick-label">上传图片</span>
          </button>
        </div>
      ) : null}
      {editing ? (
        <div className="pod-stack pod-hero-form">
          <label className="pod-field">
            <span>名字</span>
            <input className="pod-input" value={name} maxLength={BOT_NAME_MAX} onChange={(event) => setName(event.target.value)} />
          </label>
          <label className="pod-field">
            <span>角色</span>
            <input className="pod-input" value={title} maxLength={BOT_TITLE_MAX} placeholder="例如：研究员" onChange={(event) => setTitle(event.target.value)} />
          </label>
          <div className="pod-row pod-center">
            <Button small kind="primary" onClick={() => save({ name: name.trim(), title: title.trim() }, () => setEditing(false))}>
              保存
            </Button>
            <Button small kind="quiet" onClick={() => setEditing(false)}>
              取消
            </Button>
          </div>
        </div>
      ) : (
        <>
          <div className="pod-hero-name">
            <button type="button" className="pod-color-dot" style={nameColor(bot)} aria-label="换名字颜色" aria-expanded={coloring} title="换名字颜色" onClick={() => setColoring((open) => !open)} />
            <strong className="pod-bot-name" style={nameColor(bot)}>
              {bot.name}
            </strong>
            <IconButton
              icon="edit"
              label="改名字和角色"
              onClick={() => {
                setName(bot.name)
                setTitle(bot.title)
                setEditing(true)
              }}
            />
          </div>
          {coloring ? <ColorChoices bot={bot} onPick={(color) => save({ color }, () => setColoring(false))} /> : null}
          {bot.title === '' || bot.title === bot.name ? null : <span className="pod-muted">{bot.title}</span>}
        </>
      )}
      <div className="pod-tags pod-center" aria-label="能力标签">
        {bot.capabilities.map((item) => (
          <span key={item} className="pod-tag pod-tag-removable">
            {item}
            <button type="button" aria-label={`去掉标签 ${item}`} onClick={() => save({ capabilities: bot.capabilities.filter((other) => other !== item) })}>
              <Icon name="close" size={10} />
            </button>
          </span>
        ))}
        {addingTag ? (
          <input
            className="pod-input pod-tag-input"
            autoFocus
            value={tag}
            maxLength={CAPABILITY_MAX}
            placeholder="新标签"
            onChange={(event) => setTag(event.target.value)}
            onBlur={() => setAddingTag(false)}
            onKeyDown={(event) => {
              if (event.key === 'Enter' && !event.nativeEvent.isComposing && tag.trim() !== '') {
                save({ capabilities: [...bot.capabilities, tag.trim()] }, () => {
                  setTag('')
                  setAddingTag(false)
                })
              }
              if (event.key === 'Escape') setAddingTag(false)
            }}
          />
        ) : (
          <button type="button" className="pod-tag pod-tag-add" onClick={() => setAddingTag(true)}>
            + 标签
          </button>
        )}
      </div>
      {problem === undefined ? null : <p className="pod-form-error">{problem}</p>}
    </div>
  )
}

/** “浏览器”页：这个 bot 现在打开的网页，带缩略图；点开查看，或者直接接管。 */
function BotBrowser(props: { readonly bot: Bot }) {
  const app = useApp()
  const { data, error } = useResource(app.cache, 'browser', () => api.browser())
  const tabs = (data?.tabs ?? []).filter((tab) => tab.botId === props.bot.id)
  if (error !== undefined) return <p className="pod-form-error">{error}</p>
  if (data !== undefined && !data.status.available) return <Empty title="没找到本机的 Chrome">共用浏览器用本机的 Chrome。请安装 Chrome，或者在设置的浏览器页填 Chrome 的位置。</Empty>
  if (tabs.length === 0) return <Empty title={`${props.bot.name}现在没有打开网页`}>它用浏览器时，画面会出现在这里，也会在对话里放一张卡片。</Empty>
  return <TabList tabs={tabs} onOpen={(tab) => app.openBrowserTab(tab.id, props.bot.id)} />
}

/** 每一页顶上一句话，说清这一页放的是什么。 */
const TAB_HINTS: Readonly<Record<Exclude<BotTab, 'details'>, string>> = {
  pages: '它做的报告、看板、跟踪表、幻灯片这些页面：点开查看，在页面里接着让它改。',
  library: '和它的单聊、它负责的任务里产出的文档、截图和网页存档。',
  automations: '它到点自动做的事，比如每天的简报、盯一个网页。',
  browser: '它现在打开的网页：可以看实时画面，也可以接管。',
}

/**
 * Bot 详情：从右侧滑出，分详情、页面、资料库、自动化、浏览器五页；在群里点进来时是成员卡片。
 * 从成员卡片点“完整资料”进来时（back 是群的 id），左上角能返回成员卡片，换页也保留返回。
 */
export function BotPanel(props: { readonly botId: string; readonly tab: BotTab; readonly from?: string; readonly back?: string }) {
  const app = useApp()
  const { data: bots } = useResource(app.cache, 'bots', () => api.bots())
  const bot = bots?.find((item) => item.id === props.botId)
  const back = props.back
  if (props.from !== undefined) return <MemberCard botId={props.botId} roomId={props.from} />
  return (
    <aside className="pod-panel" aria-label={bot === undefined ? 'Bot 详情' : `${bot.name}的详情`}>
      <div className={`pod-panel-top${back === undefined ? '' : ' pod-panel-top-back'}`}>
        {back === undefined ? null : (
          <button type="button" className="pod-back" onClick={() => app.showBot(props.botId, 'details', back)}>
            <Icon name="back" size={16} />
            <span className="pod-ellipsis">返回</span>
          </button>
        )}
        <button type="button" className="pod-round" aria-label="关闭详情" title="关闭" onClick={() => app.closePanel()}>
          <Icon name="close" size={18} />
        </button>
      </div>
      {bot === undefined ? (
        <Empty title={bots === undefined ? '正在读取…' : '这个 bot 已经删除了'} />
      ) : (
        <div className="pod-panel-scroll">
          <BotHead key={bot.id} bot={bot} />
          <div className="pod-panel-tabs" role="tablist">
            {TABS.map(([tab, label]) => (
              <button key={tab} type="button" role="tab" aria-selected={tab === props.tab} className={tab === props.tab ? 'pod-panel-tab-on' : undefined} onClick={() => app.showProfile(bot.id, tab, back)}>
                {label}
              </button>
            ))}
          </div>
          {props.tab === 'details' ? null : <p className="pod-tab-hint">{TAB_HINTS[props.tab]}</p>}
          {props.tab === 'details' ? <BotDetails key={bot.id} bot={bot} /> : null}
          {props.tab === 'pages' ? <ScopedPages match={(page) => page.botId === bot.id} empty={`跟${bot.name}说“把结果做成看板”或“做一页报告”，做好的页面都在这里。`} /> : null}
          {props.tab === 'library' ? <Library botId={bot.id} /> : null}
          {props.tab === 'automations' ? <Automations match={(routine) => routine.botId === bot.id} defaults={{ botId: bot.id }} empty={`也可以跟${bot.name}说“每天 9 点帮我……”`} /> : null}
          {props.tab === 'browser' ? <BotBrowser bot={bot} /> : null}
        </div>
      )}
    </aside>
  )
}
