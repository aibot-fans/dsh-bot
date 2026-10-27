import { t } from 'pod-domain'
import { Icon } from './Icon.tsx'
import { useNarrow } from './media.ts'

/**
 * 右侧面板右上角的关闭。手机上面板整页显示，换成左上角的返回；
 * stacked 是面板左上角自己已经有一个返回（成员卡片回群聊详情这种），这时还是右上角的关闭。
 */
export function PanelClose(props: { readonly label: string; readonly onClose: () => void; readonly stacked?: boolean }) {
  const narrow = useNarrow()
  const back = narrow && props.stacked !== true
  return (
    <button type="button" className={`pod-round${back ? ' pod-panel-back' : ''}`} aria-label={back ? t('返回') : props.label} title={back ? t('返回') : t('关闭')} onClick={props.onClose}>
      <Icon name={back ? 'back' : 'close'} size={18} />
    </button>
  )
}
