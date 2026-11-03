import { useEffect, useRef, useState } from 'react'
import { t, type ComputerStatus, type ComputerUser } from 'pod-domain'
import { computerApi } from '../../api/computer.ts'
import { errorText } from '../../api/http.ts'
import { Badge, Button } from '../../components/common.tsx'
import { MenuPanel, useMenu } from '../../components/Menu.tsx'
import { useApp } from '../../state/app.ts'

/** 接管、交还的请求：成功后直接换上新的状态，失败交给 onError。 */
export function useComputerRun(onError: (message: string) => void): (work: Promise<ComputerStatus>, after?: () => void) => void {
  const app = useApp()
  return (work, after) => {
    work
      .then((next) => {
        app.cache.update<ComputerStatus>('computer', () => next)
        after?.()
      })
      .catch((reason: unknown) => onError(errorText(reason)))
  }
}

/**
 * 工具栏中间：谁在操作，和“接管”“交还”。接管以后 bot 先停手，你直接在这台 Mac 上操作那个应用；
 * 交还时可以留一句话，bot 带着这句话接着做。
 */
export function ComputerControl(props: { readonly user: ComputerUser; readonly botName: string; readonly onError: (message: string) => void }) {
  const { user, botName } = props
  const run = useComputerRun(props.onError)
  const menu = useMenu('end')
  const [note, setNote] = useState('')
  const noteRef = useRef<HTMLInputElement>(null)
  // 菜单先藏着量好位置再显示，藏着时 autoFocus 不起作用：显示出来以后再把光标放进留言框。
  useEffect(() => {
    if (menu.open && menu.style.visibility !== 'hidden') noteRef.current?.focus()
  }, [menu.open, menu.style.visibility])
  if (!user.takenOver) {
    return (
      <div className="pod-browser-state">
        <span title={t('你只看不动；画面下面是{botName}这一步在做什么', { botName })}>
          <Badge tone="info">{t('AI 操作中')}</Badge>
        </span>
        <Button small kind="primary" onClick={() => run(computerApi.takeover())}>
          {t('接管')}
        </Button>
      </div>
    )
  }
  const handback = (): void =>
    run(computerApi.handback(note), () => {
      setNote('')
      menu.close()
    })
  return (
    <div className="pod-browser-state">
      <span title={t('{botName}停手了，在等你交还', { botName })}>
        <Badge tone="warn">{t('你在操作')}</Badge>
      </span>
      <button ref={menu.anchor} type="button" className="pod-button pod-button-primary pod-button-small" aria-haspopup="menu" aria-expanded={menu.open} onClick={menu.toggle}>
        {t('交还给{ownerName}', { ownerName: botName })}
      </button>
      <MenuPanel control={menu} label={t('交还给{ownerName}', { ownerName: botName })}>
        <div className="pod-menu-form pod-browser-handback">
          <input
            ref={noteRef}
            className="pod-input"
            value={note}
            placeholder={t('交还时留一句话，例如“已经填好了”')}
            aria-label={t('交还时留的话')}
            onChange={(event) => setNote(event.target.value)}
            onKeyDown={(event) => {
              if (event.key === 'Enter' && !event.nativeEvent.isComposing) handback()
            }}
          />
          <button type="button" className="pod-button pod-button-primary pod-button-small" onClick={handback}>
            {t('交还')}
          </button>
        </div>
      </MenuPanel>
    </div>
  )
}
