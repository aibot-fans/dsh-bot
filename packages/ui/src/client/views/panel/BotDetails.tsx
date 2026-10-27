import { useState, type ReactNode } from 'react'
import { BOT_PERSONA_MAX, CARD_FIELD_MAX, TOOL_PROFILE_LABELS, botThreads, inputLimit, t, type Bot, type BotCard, type ModelChoice, type NotifyLevel, type ToolProfile } from 'pod-domain'
import { api } from '../../api/endpoints.ts'
import { errorText } from '../../api/http.ts'
import { Button, Segmented, Switch } from '../../components/common.tsx'
import { Icon } from '../../components/Icon.tsx'
import { useApp } from '../../state/app.ts'
import { useResource } from '../../state/resource.ts'

const PROFILE_HINTS: Readonly<Record<ToolProfile, string>> = {
  talk: '只聊天、读记忆、搜聊天记录',
  research: '再加上网搜索、浏览器只看不动、读写工作区文件',
  exec: '再加终端和浏览器操作；浏览器里的写操作会先问你',
}

const CARD_FIELDS: readonly (readonly [keyof BotCard, string, string])[] = [
  ['duties', '职责', '负责什么'],
  ['strengths', '擅长', '最拿手的事'],
  ['notResponsible', '不负责', '这类事别找它'],
  ['askWho', '拿不准', '拿不准时问谁'],
]

const NOTIFY: readonly (readonly [NotifyLevel, string])[] = [
  ['all', '全部'],
  ['waits', '需要你时'],
  ['off', '不提醒'],
]

const PERSONA_SOURCE: Readonly<Record<Bot['personaSource'], string>> = {
  seed: '默认人设',
  user: '这段是你写的，自我优化不会改它',
  auto: '自我优化调整过',
}

function Section(props: { readonly title: string; readonly hint?: string; readonly action?: ReactNode; readonly children: ReactNode }) {
  return (
    <section className="pod-box">
      <div className="pod-box-head">
        <strong>{props.title}</strong>
        {props.hint === undefined ? null : <span className="pod-muted-inline">{props.hint}</span>}
        {props.action === undefined ? null : <span className="pod-box-action">{props.action}</span>}
      </div>
      {props.children}
    </section>
  )
}

function Entry(props: { readonly label: string; readonly value: string; readonly onClick: () => void }) {
  return (
    <button type="button" className="pod-box-entry" onClick={props.onClick}>
      <span>{props.label}</span>
      <span className="pod-muted-inline">{props.value}</span>
      <Icon name="forward" size={14} />
    </button>
  )
}

function modelKey(model: ModelChoice | null): string {
  return model === null ? '' : `${model.provider}::${model.model}`
}

/** Bot 详情的“详情”页：现在的全部设定，都能直接改；记忆、技能、成长记录和历史版本从这里点进去。 */
export function BotDetails(props: { readonly bot: Bot }) {
  const app = useApp()
  const { bot } = props
  const [problem, setProblem] = useState<string | undefined>(undefined)
  const [editingCard, setEditingCard] = useState(false)
  const [card, setCard] = useState<BotCard>(bot.card)
  const [editingPersona, setEditingPersona] = useState(false)
  const [persona, setPersona] = useState(bot.persona)
  const { data: catalog } = useResource(app.cache, 'models', () => api.models())
  const { data: memories } = useResource(app.cache, `memory:list:bot:${bot.id}`, () => api.memories('bot', bot.id))
  const { data: skills } = useResource(app.cache, 'skills', () => api.skills())
  const { data: evolution } = useResource(app.cache, 'evolution', () => api.evolution())
  const { data: rooms } = useResource(app.cache, 'rooms', () => api.rooms())
  const lead = bot.role === 'lead'

  const save = (patch: Readonly<Record<string, unknown>>, done?: () => void): void => {
    setProblem(undefined)
    api
      .updateBot(bot.id, patch)
      .then(() => {
        app.cache.invalidate('bots')
        done?.()
      })
      .catch((reason: unknown) => setProblem(errorText(reason)))
  }

  const models = (catalog?.groups ?? []).flatMap((group) => group.models.map((model) => ({ provider: group.id, group: group.name, model })))
  const current = bot.model === null ? undefined : models.find((item) => item.provider === bot.model?.provider && item.model.id === bot.model?.model)
  const efforts = current?.model.reasoning?.efforts ?? []
  const groups = (rooms ?? []).filter((room) => room.kind !== 'direct' && room.memberIds.includes(bot.id))
  // 和它的每一段单聊：提醒和删除聊天记录对所有段一起生效。
  const threads = botThreads(bot.id, rooms ?? [])
  const direct = threads[0]
  const eachThread = (work: (roomId: string) => Promise<unknown>): void => {
    Promise.all(threads.map((room) => work(room.id)))
      .then(() => app.cache.invalidate('rooms'))
      .catch((reason: unknown) => setProblem(errorText(reason)))
  }
  const ownSkills = (skills ?? []).filter((skill) => skill.scopeKind === 'bot' && skill.scopeId === bot.id)
  const changes = (evolution ?? []).filter((entry) => entry.botId === bot.id)

  return (
    <div className="pod-stack">
      {problem === undefined ? null : <p className="pod-form-error">{problem}</p>}
      <Section
        title={t('角色卡')}
        hint={t('别的 bot 靠它判断什么事找{name}', { name: bot.name })}
        action={
          editingCard ? null : (
            <Button small kind="quiet" icon="edit" onClick={() => setEditingCard(true)}>
              {t('编辑')}
            </Button>
          )
        }
      >
        {editingCard ? (
          <div className="pod-stack pod-box-pad">
            {CARD_FIELDS.map(([key, label, placeholder]) => (
              <label key={key} className="pod-field">
                <span>{t(label)}</span>
                <input className="pod-input" value={card[key]} maxLength={inputLimit(CARD_FIELD_MAX)} placeholder={t(placeholder)} onChange={(event) => setCard({ ...card, [key]: event.target.value })} />
              </label>
            ))}
            <div className="pod-row">
              <Button small kind="primary" onClick={() => save({ card }, () => setEditingCard(false))}>
                {t('保存')}
              </Button>
              <Button
                small
                kind="quiet"
                onClick={() => {
                  setCard(bot.card)
                  setEditingCard(false)
                }}
              >
                {t('取消')}
              </Button>
            </div>
          </div>
        ) : (
          CARD_FIELDS.map(([key, label]) => (
            <div key={key} className="pod-kv">
              <span>{t(label)}</span>
              <span>{bot.card[key] === '' ? <span className="pod-muted-inline">{t('没写')}</span> : bot.card[key]}</span>
            </div>
          ))
        )}
      </Section>
      <Section
        title={t('人设')}
        action={
          editingPersona ? null : (
            <Button small kind="quiet" icon="edit" onClick={() => setEditingPersona(true)}>
              {t('编辑')}
            </Button>
          )
        }
      >
        {editingPersona ? (
          <div className="pod-stack pod-box-pad">
            <textarea className="pod-textarea" rows={8} value={persona} maxLength={inputLimit(BOT_PERSONA_MAX)} onChange={(event) => setPersona(event.target.value)} />
            <div className="pod-row">
              <Button small kind="primary" onClick={() => save({ persona }, () => setEditingPersona(false))}>
                {t('保存')}
              </Button>
              <Button
                small
                kind="quiet"
                onClick={() => {
                  setPersona(bot.persona)
                  setEditingPersona(false)
                }}
              >
                {t('取消')}
              </Button>
              <span className="pod-muted-inline">{t('从下一段对话开始生效')}</span>
            </div>
          </div>
        ) : (
          <div className="pod-box-pad">
            <p className="pod-persona-text">{bot.persona}</p>
            <span className="pod-muted-inline">{t(PERSONA_SOURCE[bot.personaSource])}</span>
          </div>
        )}
      </Section>
      <Section title={t('怎么干活')}>
        <div className="pod-kv">
          <span>{t('模型')}</span>
          <select
            className="pod-input"
            aria-label={t('模型')}
            value={modelKey(bot.model)}
            onChange={(event) => {
              const [provider, model] = event.target.value.split('::')
              save({ model: provider === undefined || model === undefined || event.target.value === '' ? null : { provider, model } })
            }}
          >
            <option value="">{t('跟随默认{value}', { value: catalog === undefined ? '' : t('（{model}）', { model: catalog.default.model }) })}</option>
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
        </div>
        <div className="pod-kv">
          <span>{t('思考')}</span>
          {bot.model === null || efforts.length < 2 ? (
            <span className="pod-muted-inline">{bot.model === null ? t('跟随默认模型；自我优化会按效果调') : t('这个模型不分思考强度')}</span>
          ) : (
            <Segmented
              value={bot.model.reasoningEffort ?? ''}
              options={[['', t('跟随模型')] as const, ...efforts.map((effort) => [effort.id, effort.label ?? effort.name ?? effort.id] as const)]}
              onChange={(effort) => save({ model: { provider: bot.model?.provider, model: bot.model?.model, ...(effort === '' ? {} : { reasoningEffort: effort }) } })}
              label={t('思考强度')}
            />
          )}
        </div>
        <div className="pod-kv pod-kv-top">
          <span>{t('工具')}</span>
          <span className="pod-stack-tight">
            <Segmented
              value={bot.toolProfile}
              options={(Object.keys(TOOL_PROFILE_LABELS) as ToolProfile[]).map((profile) => [profile, t(TOOL_PROFILE_LABELS[profile])] as const)}
              onChange={(toolProfile) => save({ toolProfile })}
              label={t('工具档案')}
            />
            <span className="pod-muted-inline">{PROFILE_HINTS[bot.toolProfile]}</span>
          </span>
        </div>
        {lead ? null : (
          <div className="pod-kv">
            <span>{t('临时')}</span>
            <span className="pod-row">
              <span className="pod-muted-inline pod-grow">{t('打开后，任务结束就自动删除（30 天内可以恢复）')}</span>
              <Switch checked={bot.temporary} label={t('临时 bot')} onChange={(temporary) => save({ temporary })} />
            </span>
          </div>
        )}
      </Section>
      <section className="pod-box">
        <Entry label={t('记忆')} value={memories === undefined ? '' : t('{length} 条', { length: memories.filter((entry) => entry.status !== 'archived').length })} onClick={() => app.openDrawer({ kind: 'memory', scope: 'bot', scopeId: bot.id, label: t('{name}的记忆', { name: bot.name }) })} />
        <Entry label={t('技能')} value={t('{length} 个', { length: ownSkills.length })} onClick={() => app.openDrawer({ kind: 'skills', botId: bot.id })} />
        <Entry label={t('成长记录')} value={changes.length === 0 ? t('还没有调整') : t('{length} 次调整，可撤回', { length: changes.length })} onClick={() => app.openDrawer({ kind: 'growth', botId: bot.id })} />
        <Entry label={t('历史版本')} value={t('每次改设定都留一版')} onClick={() => app.openDrawer({ kind: 'versions', botId: bot.id })} />
        {groups.map((room) => (
          <Entry key={room.id} label={t('所在群聊')} value={room.title} onClick={() => app.openRoom(room.id)} />
        ))}
      </section>
      {direct === undefined ? null : (
        <Section title={t('单聊')}>
          <div className="pod-kv">
            <span>{t('消息提醒')}</span>
            <Segmented value={direct.notifyLevel} options={NOTIFY.map(([value, label]) => [value, t(label)] as const)} onChange={(notifyLevel) => eachThread((roomId) => api.updateRoom(roomId, { notifyLevel }))} label={t('单聊的消息提醒')} />
          </div>
          <div className="pod-kv">
            <span>{t('聊天记录')}</span>
            <span className="pod-row">
              <span className="pod-muted-inline pod-grow">{t('{value}删掉消息，{name}和它的记忆保留', { value: threads.length > 1 ? t('{length} 段对话，', { length: threads.length }) : '', name: bot.name })}</span>
              <Button
                small
                kind="quiet"
                onClick={() => {
                  if (!window.confirm(t('删除和「{name}」的聊天记录？{value}消息会全部删掉，{name} 本身和它的记忆保留。', { name: bot.name, value: threads.length > 1 ? t('{length} 段对话的', { length: threads.length }) : '' }))) return
                  eachThread((roomId) => api.clearRoom(roomId))
                }}
              >
                {t('删除聊天记录')}
              </Button>
            </span>
          </div>
        </Section>
      )}
      {lead ? null : (
        <div className="pod-row pod-center">
          <Button
            kind="danger"
            small
            onClick={() => {
              if (!window.confirm(t('删除「{name}」？它的设定、记忆和聊天记录先放进回收站，30 天内可以在设置里恢复。', { name: bot.name }))) return
              api
                .archiveBot(bot.id)
                .then(() => {
                  app.cache.invalidate('bots')
                  app.closePanel()
                })
                .catch((reason: unknown) => setProblem(errorText(reason)))
            }}
          >
            {t('删除这个 bot')}
          </Button>
          <span className="pod-muted-inline">{t('30 天内可以在回收站恢复')}</span>
        </div>
      )}
    </div>
  )
}
