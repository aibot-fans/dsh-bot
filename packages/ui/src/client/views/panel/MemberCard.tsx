import { useState } from 'react'
import { api } from '../../api/endpoints.ts'
import { errorText } from '../../api/http.ts'
import { Button, Empty, HeroAvatar } from '../../components/common.tsx'
import { Icon } from '../../components/Icon.tsx'
import { useApp, useNav } from '../../state/app.ts'
import { useResource } from '../../state/resource.ts'

/**
 * 群里的成员卡片：从群聊详情点成员时打开，左上角能返回群聊详情。
 * 只放和这个群有关的：它是谁、负责什么，单聊、@ 它、移出群；它自己的资料库、自动化和浏览器在“完整资料”里。
 */
export function MemberCard(props: { readonly botId: string; readonly roomId: string }) {
  const app = useApp()
  const nav = useNav()
  const { data: bots } = useResource(app.cache, 'bots', () => api.bots())
  const { data: rooms } = useResource(app.cache, 'rooms', () => api.rooms())
  const [problem, setProblem] = useState<string | undefined>(undefined)
  const bot = bots?.find((item) => item.id === props.botId)
  const room = rooms?.find((item) => item.id === props.roomId)
  const back = (): void => app.showGroup(props.roomId)
  const card = bot === undefined ? [] : ([['负责', bot.card.duties], ['擅长', bot.card.strengths], ['不负责', bot.card.notResponsible]] as const).filter(([, value]) => value !== '')
  return (
    <aside className="pod-panel" aria-label={bot === undefined ? '成员' : `成员：${bot.name}`}>
      <div className="pod-panel-top pod-panel-top-back">
        <button type="button" className="pod-back" onClick={back}>
          <Icon name="back" size={16} />
          <span className="pod-ellipsis">{room?.title ?? '群聊详情'}</span>
        </button>
        <button type="button" className="pod-round" aria-label="关闭详情" title="关闭" onClick={() => app.closePanel()}>
          <Icon name="close" size={18} />
        </button>
      </div>
      {bot === undefined ? (
        <Empty title={bots === undefined ? '正在读取…' : '这个 bot 已经删除了'} />
      ) : (
        <div className="pod-panel-scroll">
          <div className="pod-panel-hero">
            <HeroAvatar bot={bot} />
            <strong className="pod-hero-plain">{bot.name}</strong>
            {bot.title === '' || bot.title === bot.name ? null : <span className="pod-muted">{bot.title}</span>}
            {bot.capabilities.length === 0 ? null : (
              <div className="pod-tags pod-center" aria-label="能力标签">
                {bot.capabilities.map((item) => (
                  <span key={item} className="pod-tag">
                    {item}
                  </span>
                ))}
              </div>
            )}
          </div>
          <div className="pod-member-actions">
            <Button kind="primary" icon="chat" onClick={() => app.openBot(bot.id)}>
              单聊
            </Button>
            {nav.roomId === props.roomId ? (
              <Button icon="at" onClick={() => app.insertText(props.roomId, `@${bot.name} `)}>
                在群里 @ 它
              </Button>
            ) : null}
            {bot.role === 'lead' ? null : (
              <Button
                kind="quiet"
                onClick={() => {
                  if (!window.confirm(`把「${bot.name}」移出「${room?.title ?? '这个群'}」？`)) return
                  api
                    .removeMember(props.roomId, bot.id)
                    .then(() => {
                      app.cache.invalidate('rooms')
                      back()
                    })
                    .catch((reason: unknown) => setProblem(errorText(reason)))
                }}
              >
                移出群聊
              </Button>
            )}
          </div>
          {problem === undefined ? null : <p className="pod-form-error">{problem}</p>}
          {card.length === 0 ? null : (
            <section className="pod-box">
              {card.map(([label, value]) => (
                <div key={label} className="pod-kv">
                  <span>{label}</span>
                  <span>{value}</span>
                </div>
              ))}
            </section>
          )}
          {bot.role === 'lead' ? <p className="pod-muted pod-center">主管在每个群里：没 @ 谁的话由它来接，也负责分工和验收。</p> : null}
          <section className="pod-box">
            <button type="button" className="pod-box-entry" onClick={() => app.showProfile(bot.id, 'details', props.roomId)}>
              <span>完整资料</span>
              <span className="pod-muted-inline">设定、记忆、资料库、自动化、浏览器</span>
              <Icon name="forward" size={14} />
            </button>
          </section>
        </div>
      )}
    </aside>
  )
}
