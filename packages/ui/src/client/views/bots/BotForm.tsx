import { useState, type FormEvent } from 'react'
import {
  BOT_NAME_MAX,
  BOT_PERSONA_MAX,
  BOT_TITLE_MAX,
  MEMBER_ICONS,
  TOOL_PROFILES,
  TOOL_PROFILE_LABELS,
  avatarIcon,
  iconAvatar,
  inputLimit,
  pickBotIcon,
  quickPersona,
  t,
  takenIcons,
  validateDraft,
  type Bot,
  type ModelChoice,
  type ToolProfile,
} from 'pod-domain'
import { api } from '../../api/endpoints.ts'
import { errorText } from '../../api/http.ts'
import { IconChoices } from '../../components/BotIcon.tsx'
import { Button, Field } from '../../components/common.tsx'
import { useApp } from '../../state/app.ts'
import { useResource } from '../../state/resource.ts'

/** 人设模板：角色、目标、专长、工作方法、输出格式、禁区。 */
const PERSONA_TEMPLATE: readonly string[] = ['角色：', '目标：', '专长：', '工作方法：', '输出格式：', '禁区：']

const PROFILE_HINTS: Readonly<Record<ToolProfile, string>> = {
  talk: '聊天、读记忆、搜聊天记录',
  research: '再加 web 搜索、工作区读写',
  exec: '再加沙箱 shell；浏览器写操作仍要审批',
}

interface FormState {
  readonly name: string
  readonly title: string
  readonly avatar: string
  readonly persona: string
  readonly capabilities: string
  readonly duties: string
  readonly strengths: string
  readonly notResponsible: string
  readonly askWho: string
  readonly toolProfile: ToolProfile
  readonly model: string
  readonly temporary: boolean
}

function modelKey(model: ModelChoice | null): string {
  return model === null ? '' : `${model.provider}::${model.model}`
}

function fromBot(bot: Bot | undefined): FormState {
  return {
    name: bot?.name ?? '',
    title: bot?.title ?? '',
    avatar: bot?.avatar ?? '',
    persona: bot?.persona ?? '',
    capabilities: (bot?.capabilities ?? []).join(t('、')),
    duties: bot?.card.duties ?? '',
    strengths: bot?.card.strengths ?? '',
    notResponsible: bot?.card.notResponsible ?? '',
    askWho: bot?.card.askWho ?? '',
    toolProfile: bot?.toolProfile ?? 'exec',
    model: modelKey(bot?.model ?? null),
    temporary: bot?.temporary ?? false,
  }
}

function tagsOf(state: FormState): readonly string[] {
  return state.capabilities.split(/[,，、\s]+/).filter(Boolean)
}

function toInput(state: FormState): Readonly<Record<string, unknown>> {
  const [provider, model] = state.model === '' ? [] : state.model.split('::')
  return {
    name: state.name,
    title: state.title,
    avatar: state.avatar,
    persona: state.persona,
    capabilities: tagsOf(state),
    card: { duties: state.duties, strengths: state.strengths, notResponsible: state.notResponsible, askWho: state.askWho },
    toolProfile: state.toolProfile,
    model: provider === undefined || model === undefined ? null : { provider, model },
    temporary: state.temporary,
  }
}

/** 新建时从简单表单带过来的内容：名字、职责、图标、临时。 */
export interface BotPrefill {
  readonly name: string
  readonly duties: string
  readonly avatar: string
  readonly temporary: boolean
}

function prefilled(prefill: BotPrefill): FormState {
  return { ...fromBot(undefined), name: prefill.name, duties: prefill.duties, avatar: prefill.avatar, temporary: prefill.temporary, persona: prefill.name === '' ? '' : quickPersona(prefill.name, prefill.duties) }
}

/** 新建或编辑 bot：人设、角色卡、能力标签、工具档案、模型（默认跟随 dsh）。 */
export function BotForm(props: { readonly bot?: Bot; readonly prefill?: BotPrefill; readonly onDone: (saved?: Bot) => void }) {
  const app = useApp()
  const [state, setState] = useState<FormState>(() => (props.prefill === undefined ? fromBot(props.bot) : prefilled(props.prefill)))
  const [error, setError] = useState<string | undefined>(undefined)
  const [busy, setBusy] = useState(false)
  const { data: catalog } = useResource(app.cache, 'models', () => api.models())
  const { data: bots } = useResource(app.cache, 'bots', () => api.bots())
  const set = <K extends keyof FormState>(key: K, value: FormState[K]): void => setState((current) => ({ ...current, [key]: value }))
  const isLead = props.bot?.role === 'lead'
  /** 没点过图标时跟着名字和角色变，尽量不和在用的 bot 撞。 */
  const icon =
    avatarIcon(state.avatar) ??
    pickBotIcon(
      { role: 'member', name: state.name, title: state.title, capabilities: tagsOf(state), card: { duties: state.duties, strengths: state.strengths } },
      takenIcons(bots ?? []),
    )

  const submit = (event: FormEvent): void => {
    event.preventDefault()
    const input = props.bot === undefined ? { ...toInput(state), avatar: iconAvatar(icon) } : toInput(state)
    const checked = validateDraft(input)
    if (!checked.ok) {
      setError(checked.error.message)
      return
    }
    setBusy(true)
    setError(undefined)
    const work = props.bot === undefined ? api.createBot(input) : api.updateBot(props.bot.id, input)
    work
      .then((saved) => {
        app.cache.invalidate('bots')
        props.onDone(saved)
      })
      .catch((reason: unknown) => setError(errorText(reason)))
      .finally(() => setBusy(false))
  }

  return (
    <form className="pod-form" onSubmit={submit}>
      <div className="pod-form-grid">
        <Field label={t('名字')} hint={t('最多 {BOT_NAME_MAX} 字', { BOT_NAME_MAX, letters: BOT_NAME_MAX * 2 })}>
          <input className="pod-input" value={state.name} onChange={(event) => set('name', event.target.value)} maxLength={inputLimit(BOT_NAME_MAX)} />
        </Field>
        <Field label={t('角色')} hint={t('最多 {BOT_TITLE_MAX} 字', { BOT_TITLE_MAX, letters: BOT_TITLE_MAX * 2 })}>
          <input className="pod-input" value={state.title} onChange={(event) => set('title', event.target.value)} placeholder={t('例如：研究员')} />
        </Field>
      </div>
      {props.bot === undefined ? (
        <div className="pod-field">
          <span className="pod-field-row">
            <span>{t('图标')}</span>
            <span className="pod-hint">{t('按名字和角色配好了，也可以点别的；建好后还能在详情里换成图片')}</span>
          </span>
          <div className="pod-icon-row" role="group" aria-label={t('选一个图标')}>
            <IconChoices kinds={MEMBER_ICONS} current={icon} onPick={(kind) => set('avatar', iconAvatar(kind))} />
          </div>
        </div>
      ) : null}
      <Field label={t('人设')} hint={t('最多 {BOT_PERSONA_MAX} 字', { BOT_PERSONA_MAX, letters: BOT_PERSONA_MAX * 2 })}>
        <textarea className="pod-textarea" value={state.persona} onChange={(event) => set('persona', event.target.value)} rows={8} />
      </Field>
      {state.persona === '' ? (
        <button type="button" className="pod-link" onClick={() => set('persona', PERSONA_TEMPLATE.map((line) => t(line)).join('\n'))}>
          {t('用模板：角色、目标、专长、工作方法、输出格式、禁区')}
        </button>
      ) : null}
      <Field label={t('能力标签')} hint={t('用顿号或逗号分开，分配任务时用来匹配')}>
        <input className="pod-input" value={state.capabilities} onChange={(event) => set('capabilities', event.target.value)} placeholder={t('调研、写作')} />
      </Field>
      <div className="pod-form-grid">
        <Field label={t('职责')}>
          <input className="pod-input" value={state.duties} onChange={(event) => set('duties', event.target.value)} />
        </Field>
        <Field label={t('擅长')}>
          <input className="pod-input" value={state.strengths} onChange={(event) => set('strengths', event.target.value)} />
        </Field>
        <Field label={t('不负责')}>
          <input className="pod-input" value={state.notResponsible} onChange={(event) => set('notResponsible', event.target.value)} />
        </Field>
        <Field label={t('别的问题找谁')}>
          <input className="pod-input" value={state.askWho} onChange={(event) => set('askWho', event.target.value)} />
        </Field>
      </div>
      <div className="pod-form-grid">
        <Field label={t('工具档案')} hint={t(PROFILE_HINTS[state.toolProfile])}>
          <select className="pod-input" value={state.toolProfile} onChange={(event) => set('toolProfile', event.target.value as ToolProfile)}>
            {TOOL_PROFILES.map((profile) => (
              <option key={profile} value={profile}>
                {t(TOOL_PROFILE_LABELS[profile])}
              </option>
            ))}
          </select>
        </Field>
        <Field label={t('模型')} hint={t('从下一段会话开始生效')}>
          <select className="pod-input" value={state.model} onChange={(event) => set('model', event.target.value)}>
            <option value="">{t('跟随 dsh-bot 默认（默认跟随 dsh）')}</option>
            {(catalog?.groups ?? []).map((group) => (
              <optgroup key={group.id} label={group.name}>
                {group.models.map((model) => (
                  <option key={model.id} value={`${group.id}::${model.id}`}>
                    {model.name}
                  </option>
                ))}
              </optgroup>
            ))}
          </select>
        </Field>
      </div>
      {isLead ? null : (
        <label className="pod-check-row">
          <input type="checkbox" checked={state.temporary} onChange={(event) => set('temporary', event.target.checked)} />
          {t('临时 bot：任务结束就自动删除（30 天内可以恢复）')}
        </label>
      )}
      {error === undefined ? null : <p className="pod-form-error">{error}</p>}
      <div className="pod-form-actions">
        <Button kind="quiet" onClick={() => props.onDone()}>
          {t('取消')}
        </Button>
        <Button kind="primary" type="submit" disabled={busy}>
          {props.bot === undefined ? t('新建') : t('保存')}
        </Button>
      </div>
    </form>
  )
}
