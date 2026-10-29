import { useState } from 'react'
import { OWNER, POD, t, type Bot, type Room, type RoomMessage } from 'pod-domain'
import { api } from '../../api/endpoints.ts'
import { errorText } from '../../api/http.ts'
import { RelativeTime } from '../../components/common.tsx'
import { Icon } from '../../components/Icon.tsx'
import { MenuPanel, useMenu } from '../../components/Menu.tsx'
import { useApp } from '../../state/app.ts'
import { useResource } from '../../state/resource.ts'

function whoSaid(author: string, bots: ReadonlyMap<string, Bot>): string {
  if (author === OWNER) return t('你')
  if (author === POD) return 'dsh-bot'
  return bots.get(author)?.name ?? t('已删除的 bot')
}

/** 置顶消息在条上和列表里的那行字：去掉常见的 Markdown 记号（标题、列表、引用、粗体、代码、链接），压成一行。 */
function previewOf(message: RoomMessage): string {
  const text = message.body
    .replace(/```[^\n]*\n?/g, '')
    .replace(/!?\[([^\]]*)\]\([^)]*\)/g, '$1')
    .replace(/^\s{0,3}(?:#{1,6}\s+|>\s?|[-*+]\s+|\d+[.)]\s+)/gm, '')
    .replace(/\*\*|__|~~|`/g, '')
    .replace(/\s+/g, ' ')
    .trim()
  return text === '' ? t('（没有文字）') : text
}

/**
 * 对话顶上的置顶条：这个对话里有置顶的消息才出现。显示最新的一条（按消息先后），点它跳过去（加载前后的内容并高亮）；
 * 右边点开是全部置顶消息（列表样式和对话记录一样），每条能跳过去、能取消置顶。
 */
export function PinnedBar(props: { readonly room: Room; readonly bots: ReadonlyMap<string, Bot> }) {
  const app = useApp()
  const menu = useMenu()
  const { room, bots } = props
  const { data } = useResource(app.cache, `pins:${room.id}`, () => api.pinnedMessages(room.id))
  const [problem, setProblem] = useState<string | undefined>(undefined)
  const pins = data ?? []
  const latest = pins.at(-1)
  if (latest === undefined) return null
  const jump = (message: RoomMessage): void => {
    menu.close()
    app.focusMessage(room.id, message.seq, message.id)
  }
  const unpin = (message: RoomMessage): void => {
    setProblem(undefined)
    api
      .pinMessage(message.id, false)
      .then(() => app.cache.invalidate(`pins:${room.id}`))
      .catch((reason: unknown) => setProblem(errorText(reason)))
  }
  return (
    <div className="pod-pins">
      <Icon name="pin" size={14} />
      <button type="button" className="pod-pins-latest" title={t('跳到这条消息')} onClick={() => jump(latest)}>
        <span className="pod-pins-text pod-ellipsis">
          {whoSaid(latest.author, bots)}
          {t('：{body}', { body: previewOf(latest) })}
        </span>
      </button>
      <button ref={menu.anchor} type="button" className="pod-pins-more" aria-expanded={menu.open} aria-label={t('全部置顶消息')} title={t('全部置顶消息')} onClick={menu.toggle}>
        {pins.length > 1 ? t('{count} 条', { count: pins.length }) : null}
        <Icon name="expand" size={14} />
      </button>
      <MenuPanel control={menu} label={t('置顶消息')} wide>
        <div className="pod-history">
          <div className="pod-history-head">{t('置顶消息 · {count} 条', { count: pins.length })}</div>
          {problem === undefined ? null : <p className="pod-form-error">{problem}</p>}
          <div className="pod-history-list">
            {[...pins].reverse().map((message) => (
              <div key={message.id} className="pod-history-row">
                <button type="button" className="pod-history-open" onClick={() => jump(message)}>
                  <span className="pod-history-subject pod-pins-body">{previewOf(message)}</span>
                  <span className="pod-history-meta pod-ellipsis">
                    {whoSaid(message.author, bots)} · <RelativeTime time={message.createdAt} />
                  </span>
                </button>
                <button type="button" className="pod-icon-button pod-history-remove" aria-label={t('取消置顶')} title={t('取消置顶')} onClick={() => unpin(message)}>
                  <Icon name="unpin" size={14} />
                </button>
              </div>
            ))}
          </div>
        </div>
      </MenuPanel>
    </div>
  )
}
