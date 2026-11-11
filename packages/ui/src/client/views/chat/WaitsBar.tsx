import { useState } from 'react'
import { WAIT_KIND_LABELS, t, type Room, type Wait } from 'pod-domain'
import { api } from '../../api/endpoints.ts'
import { errorText } from '../../api/http.ts'
import { RelativeTime } from '../../components/common.tsx'
import { Icon } from '../../components/Icon.tsx'
import { MenuPanel, useMenu } from '../../components/Menu.tsx'
import { useApp } from '../../state/app.ts'
import { useResource } from '../../state/resource.ts'

/** 要你拿主意的问题是“跳过”（让干活的 bot 自己定），别的是“不用管”（按能做到的继续）。 */
function skipLabel(wait: Wait): string {
  return wait.kind === 'ambiguity' || wait.kind === 'unknown-state' ? t('跳过') : t('不用管')
}

/**
 * 对话顶上的“需要你”条：这段对话里还有开着的等你事项才出现，和侧栏的“需要你”一个口径。
 * 写着最新的一件，点它跳到对话里那张卡片（卡片可能在很早以前）；“不用管”当场关掉它。
 * 不止一件时右边点开列出全部，每件都能跳过去、能不用管。
 */
export function WaitsBar(props: { readonly room: Room }) {
  const app = useApp()
  const menu = useMenu()
  const { data } = useResource(app.cache, 'waits', () => api.waits())
  const [busy, setBusy] = useState<string | undefined>(undefined)
  const [problem, setProblem] = useState<string | undefined>(undefined)
  // 列表按问的先后倒着排，第一件是最新的。
  const waits = (data ?? []).filter((wait) => wait.roomId === props.room.id)
  const latest = waits[0]
  if (latest === undefined) return null
  const jump = (wait: Wait): void => {
    menu.close()
    setProblem(undefined)
    // 卡片的内容先读上：跳过去时卡片已经画好，才能滚到它那里。
    void app.cache.load(`waits:${wait.id}`, () => api.wait(wait.id))
    api
      .waitCard(wait.id)
      .then((message) => {
        if (message === null) setProblem(t('这件事的卡片找不到了'))
        else app.focusMessage(message.roomId, message.seq, message.id)
      })
      .catch((reason: unknown) => setProblem(errorText(reason)))
  }
  const dismiss = (wait: Wait): void => {
    setBusy(wait.id)
    setProblem(undefined)
    api
      .dismissWait(wait.id)
      .then(() => app.cache.invalidate('waits'))
      .catch((reason: unknown) => setProblem(errorText(reason)))
      .finally(() => setBusy(undefined))
  }
  const skip = (wait: Wait) => (
    <button type="button" className="pod-waitbar-skip" disabled={busy === wait.id} title={t('关掉这件事，干活的 bot 按能做到的继续')} onClick={() => dismiss(wait)}>
      {skipLabel(wait)}
    </button>
  )
  return (
    <div className="pod-waitbar">
      <Icon name="alert" size={14} />
      <button type="button" className="pod-waitbar-latest" title={t('跳到对话里这张卡片')} onClick={() => jump(latest)}>
        <span className="pod-waitbar-text pod-ellipsis">{t('需要你：{title}', { title: latest.title })}</span>
      </button>
      {problem === undefined ? null : <span className="pod-waitbar-problem">{problem}</span>}
      {skip(latest)}
      {waits.length < 2 ? null : (
        <>
          <button ref={menu.anchor} type="button" className="pod-pins-more" aria-expanded={menu.open} title={t('全部要你处理的事')} onClick={menu.toggle}>
            {t('{count} 件', { count: waits.length })}
            <Icon name="expand" size={14} />
          </button>
          <MenuPanel control={menu} label={t('要你处理的事')} wide>
            <div className="pod-history">
              <div className="pod-history-head">{t('要你处理的事 · {count} 件', { count: waits.length })}</div>
              <div className="pod-history-list">
                {waits.map((wait) => (
                  <div key={wait.id} className="pod-history-row">
                    <button type="button" className="pod-history-open" onClick={() => jump(wait)}>
                      <span className="pod-history-subject pod-pins-body">{wait.title}</span>
                      <span className="pod-history-meta pod-ellipsis">
                        {t(WAIT_KIND_LABELS[wait.kind])} · <RelativeTime time={wait.createdAt} />
                      </span>
                    </button>
                    {skip(wait)}
                  </div>
                ))}
              </div>
            </div>
          </MenuPanel>
        </>
      )}
    </div>
  )
}
