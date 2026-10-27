import { useState } from 'react'
import { POD, t, type RoomMessage } from 'pod-domain'
import { api } from '../../api/endpoints.ts'
import { errorText } from '../../api/http.ts'
import { copyText } from '../../components/clipboard.ts'
import { Button } from '../../components/common.tsx'
import { MenuDivider, MenuItem, MenuPanel, type MenuControl } from '../../components/Menu.tsx'
import { useApp } from '../../state/app.ts'
import { useRating } from './Rating.tsx'

/** 长按面板的两页：操作列表，和踩的时候写原因。 */
export type SheetView = 'main' | 'down'

/** 能重新回答、能打分的消息：bot 自己说的话。X 监控推来的动态不是模型的回答。 */
export function answerable(message: RoomMessage, owner: boolean): boolean {
  return message.author !== POD && message.kind === 'text' && !owner && message.data.xEvent === undefined
}

export interface MessageSheetProps {
  readonly control: MenuControl
  readonly view: SheetView
  readonly onView: (view: SheetView) => void
  readonly message: RoomMessage
  readonly owner: boolean
  readonly onReply: (message: RoomMessage) => void
  readonly onPinned: (message: RoomMessage) => void
  /** 打开能自己选一段的原文。 */
  readonly onSelect: () => void
}

/** 踩的原因：可以不写，直接提交。 */
function DownReason(props: { readonly onSubmit: (reason: string) => void; readonly onBack: () => void }) {
  const [reason, setReason] = useState('')
  return (
    <div className="pod-menu-form">
      <input
        className="pod-input"
        autoFocus
        value={reason}
        placeholder={t('哪里不好？可以不写')}
        aria-label={t('踩的原因')}
        onChange={(event) => setReason(event.target.value)}
        onKeyDown={(event) => {
          if (event.key === 'Enter' && !event.nativeEvent.isComposing) props.onSubmit(reason)
        }}
      />
      <div className="pod-row">
        <Button small kind="primary" onClick={() => props.onSubmit(reason)}>
          {t('提交')}
        </Button>
        <Button small kind="quiet" onClick={props.onBack}>
          {t('返回')}
        </Button>
      </div>
    </div>
  )
}

/**
 * 触屏上长按一条消息弹出的操作（手机上从底下升起）：复制、选择文字、引用回复；
 * bot 的回答还有重新回答、赞、踩；最后是置顶和在 dsh 里查看过程。
 */
export function MessageSheet(props: MessageSheetProps) {
  const app = useApp()
  const { control, message } = props
  const rating = useRating(message.roomId, message.id)
  const answer = answerable(message, props.owner)
  const sessionId = message.sessionId
  const act = (work: () => void): void => {
    control.close()
    work()
  }
  return (
    <MenuPanel control={control} label={props.owner ? t('你的消息') : t('这条消息')}>
      {props.view === 'down' ? (
        <DownReason
          onSubmit={(reason) => {
            control.close()
            rating.rate(-1, reason)
          }}
          onBack={() => props.onView('main')}
        />
      ) : (
        <>
          <MenuItem icon="copy" label={t('复制')} onClick={() => act(() => void copyText(message.body))} />
          <MenuItem icon="select" label={t('选择文字')} hint={t('选一段再复制')} onClick={() => act(props.onSelect)} />
          <MenuItem icon="reply" label={t('引用回复')} onClick={() => act(() => props.onReply(message))} />
          {answer ? (
            <>
              <MenuItem icon="refresh" label={t('重新回答')} onClick={() => act(() => void api.regenerate(message.id).catch((reason: unknown) => window.alert(errorText(reason))))} />
              <MenuItem icon="up" label={rating.current === 1 ? t('取消赞') : t('赞')} onClick={() => act(() => rating.rate(rating.current === 1 ? 0 : 1))} />
              <MenuItem
                icon="down"
                label={rating.current === -1 ? t('取消踩') : t('踩')}
                hint={rating.current === -1 ? undefined : t('可以写一句原因')}
                onClick={() => (rating.current === -1 ? act(() => rating.rate(0)) : props.onView('down'))}
              />
            </>
          ) : null}
          <MenuDivider />
          <MenuItem icon={message.pinned ? 'unpin' : 'pin'} label={message.pinned ? t('取消置顶') : t('置顶这条消息')} onClick={() => act(() => void api.pinMessage(message.id, !message.pinned).then(props.onPinned))} />
          {sessionId === null ? null : <MenuItem icon="open" label={t('在 dsh 里查看过程')} onClick={() => act(() => app.host.openSession(sessionId))} />}
        </>
      )}
    </MenuPanel>
  )
}
