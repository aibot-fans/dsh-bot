import { useState, type KeyboardEvent } from 'react'
import { BOT_NAME_MAX, BOT_PRESETS, CARD_FIELD_MAX, GROUP_NAME_MAX, MEMBER_ICONS, autoGroupName, iconAvatar, pickBotIcon, quickPersona, takenIcons, type Bot, type BotIconKind, type BotPreset } from 'pod-domain'
import { api } from '../../api/endpoints.ts'
import { errorText } from '../../api/http.ts'
import { IconChoices } from '../../components/BotIcon.tsx'
import { Avatar, Button, Drawer, Field, Modal } from '../../components/common.tsx'
import { Icon } from '../../components/Icon.tsx'
import { useApp } from '../../state/app.ts'
import { BotForm, type BotPrefill } from '../bots/BotForm.tsx'

function onEnter(action: () => void): (event: KeyboardEvent<HTMLInputElement>) => void {
  return (event) => {
    if (event.key === 'Enter' && !event.nativeEvent.isComposing) action()
  }
}

/** 预设：点一下按写好的人设、能力标签、角色卡和图标直接建好。 */
function Presets(props: { readonly busy: boolean; readonly onPick: (preset: BotPreset) => void }) {
  return (
    <div className="pod-presets">
      <span className="pod-hint">从预设开始</span>
      {BOT_PRESETS.map((preset) => (
        <button key={preset.id} type="button" className="pod-preset" disabled={props.busy} onClick={() => props.onPick(preset)}>
          <Avatar bot={{ id: preset.id, name: preset.name, avatar: preset.avatar }} size={34} />
          <span className="pod-preset-text">
            <strong>{preset.name}</strong>
            <span className="pod-muted-inline">{preset.description}</span>
          </span>
          <span className="pod-preset-go">直接新建</span>
        </button>
      ))}
    </div>
  )
}

/**
 * 新建 bot：只要名字和一句话职责，人设按这句话写好，图标自动选好；也可以从预设（比如设计师）直接建。
 * 要细调就点“更多设置”换成完整表单；也可以交给主管来建，它会把人设、能力标签和角色卡写完整。
 */
export function NewBotFlow(props: { readonly bots: readonly Bot[]; readonly onClose: () => void }) {
  const app = useApp()
  const [name, setName] = useState('')
  const [duty, setDuty] = useState('')
  const [icon, setIcon] = useState<BotIconKind | undefined>(undefined)
  const [temporary, setTemporary] = useState(false)
  const [advanced, setAdvanced] = useState<BotPrefill | undefined>(undefined)
  const [busy, setBusy] = useState(false)
  const [problem, setProblem] = useState<string | undefined>(undefined)
  const lead = props.bots.find((bot) => bot.role === 'lead')
  const chosen = icon ?? pickBotIcon({ role: 'member', name, card: { duties: duty, strengths: '' } }, takenIcons(props.bots))
  const ready = name.trim() !== '' && !busy

  const done = (saved?: Bot): void => {
    props.onClose()
    if (saved === undefined) return
    app.cache.invalidate('bots')
    app.openBot(saved.id)
  }
  if (advanced !== undefined) {
    return (
      <Drawer title="新建 bot" onClose={props.onClose} wide>
        <BotForm prefill={advanced} onDone={done} />
      </Drawer>
    )
  }
  const create = (): void => {
    if (!ready) return
    setBusy(true)
    setProblem(undefined)
    api
      .createBot({
        name: name.trim(),
        title: '',
        persona: quickPersona(name, duty),
        card: { duties: duty.trim(), strengths: '', notResponsible: '', askWho: '' },
        avatar: iconAvatar(chosen),
        temporary,
      })
      .then(done)
      .catch((reason: unknown) => setProblem(errorText(reason)))
      .finally(() => setBusy(false))
  }
  const fromPreset = (preset: BotPreset): void => {
    setBusy(true)
    setProblem(undefined)
    api
      .createBot({ name: preset.name, title: preset.title, persona: preset.persona, avatar: preset.avatar, capabilities: preset.capabilities, card: preset.card, temporary: false })
      .then(done)
      .catch((reason: unknown) => setProblem(errorText(reason)))
      .finally(() => setBusy(false))
  }
  const askLead = (): void => {
    if (lead === undefined || !ready) return
    const text = `帮我新建一个 bot：名字叫「${name.trim()}」${duty.trim() === '' ? '' : `，负责${duty.trim().replace(/[。.]$/, '')}`}。人设、能力标签和角色卡你来写，建好告诉我。`
    setBusy(true)
    api
      .openDirect(lead.id)
      .then((room) => api.send(room.id, text).then(() => room))
      .then((room) => {
        app.cache.invalidate('rooms')
        app.openRoom(room.id)
        props.onClose()
      })
      .catch((reason: unknown) => setProblem(errorText(reason)))
      .finally(() => setBusy(false))
  }
  return (
    <Modal title="新建 bot" onClose={props.onClose}>
      <div className="pod-stack">
        <Presets busy={busy} onPick={fromPreset} />
        <Field label="名字">
          <input className="pod-input" autoFocus value={name} maxLength={BOT_NAME_MAX} placeholder="例如：写手" onChange={(event) => setName(event.target.value)} onKeyDown={onEnter(create)} />
        </Field>
        <Field label="它负责什么" hint="一句话就行，人设会按这句话写好">
          <input className="pod-input" value={duty} maxLength={CARD_FIELD_MAX} placeholder="例如：写和改博客文章" onChange={(event) => setDuty(event.target.value)} onKeyDown={onEnter(create)} />
        </Field>
        <div className="pod-field">
          <span className="pod-field-row">
            <span>图标</span>
            <span className="pod-hint">按名字自动选好了，也可以点别的</span>
          </span>
          <div className="pod-icon-row" role="group" aria-label="选一个图标">
            <IconChoices kinds={MEMBER_ICONS} current={chosen} onPick={setIcon} />
          </div>
        </div>
        <label className="pod-check-row">
          <input type="checkbox" checked={temporary} onChange={(event) => setTemporary(event.target.checked)} />
          临时 bot：任务结束就自动删除（30 天内可以恢复）
        </label>
        {problem === undefined ? null : <p className="pod-form-error">{problem}</p>}
        <div className="pod-form-actions pod-form-split">
          <span className="pod-row">
            <button type="button" className="pod-link" onClick={() => setAdvanced({ name, duties: duty, avatar: iconAvatar(chosen), temporary })}>
              更多设置
            </button>
            {lead === undefined ? null : (
              <button type="button" className="pod-link" disabled={!ready} onClick={askLead} title="主管会把人设、能力标签和角色卡写完整">
                让主管来建
              </button>
            )}
          </span>
          <span className="pod-row">
            <Button kind="quiet" onClick={props.onClose}>
              取消
            </Button>
            <Button kind="primary" disabled={!ready} onClick={create}>
              新建
            </Button>
          </span>
        </div>
      </div>
    </Modal>
  )
}

/** 新建群聊：点选成员就行，主管自动在群里；群名可以不填，按成员起一个。 */
export function NewGroup(props: { readonly bots: readonly Bot[]; readonly onClose: () => void }) {
  const app = useApp()
  const [picked, setPicked] = useState<readonly string[]>([])
  const [name, setName] = useState('')
  const [busy, setBusy] = useState(false)
  const [problem, setProblem] = useState<string | undefined>(undefined)
  const candidates = props.bots.filter((bot) => bot.role !== 'lead')
  // 和 Pod 起名一样按点选的顺序，提示的群名就是建出来的群名。
  const names = picked.flatMap((id) => candidates.find((bot) => bot.id === id)?.name ?? [])
  const toggle = (id: string): void => setPicked((current) => (current.includes(id) ? current.filter((item) => item !== id) : [...current, id]))
  const create = (): void => {
    if (picked.length === 0 || busy) return
    setBusy(true)
    setProblem(undefined)
    api
      .createGroup(name.trim(), picked)
      .then((room) => {
        app.cache.invalidate('rooms')
        app.openRoom(room.id)
        props.onClose()
      })
      .catch((reason: unknown) => setProblem(errorText(reason)))
      .finally(() => setBusy(false))
  }
  return (
    <Modal title="新建群聊" onClose={props.onClose}>
      <div className="pod-stack">
        <p className="pod-muted">点选要拉进群的 bot。主管会自动在群里，负责分派和组织；没点名的话按分工交给对口的成员来接。</p>
        {candidates.length === 0 ? (
          <p className="pod-muted">
            还没有别的 bot。
            <button
              type="button"
              className="pod-link"
              onClick={() => {
                props.onClose()
                app.openDrawer({ kind: 'new-bot' })
              }}
            >
              先新建一个
            </button>
          </p>
        ) : null}
        <div className="pod-member-grid pod-member-grid-pick" role="group" aria-label="选成员">
          {candidates.map((bot) => {
            const on = picked.includes(bot.id)
            return (
              <button key={bot.id} type="button" className={`pod-member-tile${on ? ' pod-member-tile-on' : ''}`} aria-pressed={on} onClick={() => toggle(bot.id)} title={bot.card.duties || bot.title}>
                <Avatar bot={bot} size={44} />
                <span className="pod-member-name">{bot.name}</span>
                {on ? (
                  <span className="pod-member-check" aria-hidden>
                    <Icon name="check" size={12} />
                  </span>
                ) : null}
              </button>
            )
          })}
        </div>
        <Field label="群名" hint={`可以不填；最好不超过 ${GROUP_NAME_MAX} 个字`}>
          <input className="pod-input" value={name} maxLength={40} placeholder={picked.length === 0 ? '不填就按成员起名' : autoGroupName(names)} onChange={(event) => setName(event.target.value)} onKeyDown={onEnter(create)} />
        </Field>
        {problem === undefined ? null : <p className="pod-form-error">{problem}</p>}
        <div className="pod-form-actions">
          <Button kind="quiet" onClick={props.onClose}>
            取消
          </Button>
          <Button kind="primary" disabled={busy || picked.length === 0} onClick={create}>
            {picked.length === 0 ? '建群' : `建群（${picked.length + 1} 位）`}
          </Button>
        </div>
      </div>
    </Modal>
  )
}
