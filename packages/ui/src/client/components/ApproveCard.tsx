import { t, type Wait } from 'pod-domain'
import { api } from '../api/endpoints.ts'
import { useApp } from '../state/app.ts'
import { ApprovalDetail } from './ApprovalDetail.tsx'
import { Button } from './common.tsx'
import { Icon } from './Icon.tsx'
import { Markdown } from './Markdown.tsx'
import { settledText, useWaitActions, waitNote, type CardPlace } from './waitAnswer.ts'

interface Choice {
  readonly label: string
  /** 点了就是这句答复；去接管只是帮你打开那个标签页，没有答复。 */
  readonly answer?: string
  readonly open?: () => void
  /** 不用管：关掉这件事，让干活的 bot 按能做到的继续。 */
  readonly dismiss?: true
}

/** 不做也行的事（登录、没法一次放行的安全拦截）最后都有“不用管”，免得卡片只能点“好了”。 */
function skip(): Choice {
  return { label: t('不用管'), dismiss: true }
}

/** 按钮：批准、先不；允许一次、先不；去接管、登好了、不用管。第一个是蓝色的。 */
function choicesOf(wait: Wait, takeover: (tabId: string) => void): readonly Choice[] {
  switch (wait.kind) {
    case 'login': {
      const tabId = typeof wait.data.tabId === 'string' ? wait.data.tabId : undefined
      return [...(tabId === undefined ? [] : [{ label: t('去接管'), open: () => takeover(tabId) }]), { label: t('登好了'), answer: '' }, skip()]
    }
    case 'security':
      return typeof wait.data.key === 'string'
        ? [
            { label: t('允许一次'), answer: t('允许') },
            { label: t('先不'), answer: t('不允许') },
          ]
        : [{ label: t('处理好了'), answer: '' }, skip()]
    default:
      return [
        { label: t('批准'), answer: t('批准') },
        { label: t('先不'), answer: t('不批准') },
      ]
  }
}

/** 浏览器、X、用电脑的写操作带着截图、网址、表单这些，用审批详情画；bot 自己问的照它写的说明。 */
function hasApprovalDetail(wait: Wait): boolean {
  return wait.kind === 'write' && (typeof wait.data.tabId === 'string' || typeof wait.data.channel === 'string')
}

/**
 * 批准卡片：要你批准、允许的操作。第一行是盾牌和要做什么，下面写清楚（说明、要写的内容；浏览器和 X 的写操作是截图和表单），
 * 最后是批准、先不。要你登录的也是这个样子，按钮是去接管、登好了。处理过的按钮收起，写上处理结果。
 */
export function ApproveCard(props: { readonly wait: Wait; readonly place: CardPlace }) {
  const app = useApp()
  const { wait } = props
  const actions = useWaitActions(wait, props.place)
  const note = waitNote(wait)
  const choices = choicesOf(wait, (tabId) => {
    void api.takeover(tabId).catch(() => undefined)
    app.openBrowserTab(tabId)
  })
  const act = (choice: Choice): void => {
    if (choice.dismiss === true) actions.dismiss()
    else if (choice.answer === undefined) choice.open?.()
    else actions.answer(choice.answer)
  }
  return (
    <div className="pod-acard">
      <div className="pod-acard-head">
        <Icon name={wait.kind === 'login' ? 'browser' : 'shield'} size={16} />
        <span className="pod-acard-title">{wait.title}</span>
      </div>
      {hasApprovalDetail(wait) ? (
        <ApprovalDetail wait={wait} />
      ) : note.text === '' ? null : note.folded ? (
        <details className="pod-acard-detail">
          <summary>{t('详情')}</summary>
          <Markdown text={note.text} />
        </details>
      ) : (
        <div className="pod-acard-detail">
          <Markdown text={note.text} />
        </div>
      )}
      {actions.settled === undefined ? (
        <div className="pod-acard-actions">
          {choices.map((choice, index) => (
            <Button key={choice.label} small kind={index === 0 ? 'primary' : 'default'} disabled={actions.busy} onClick={() => act(choice)}>
              {choice.label}
            </Button>
          ))}
        </div>
      ) : (
        <div className="pod-acard-result">{settledText(actions.settled)}</div>
      )}
      {actions.problem === undefined ? null : <p className="pod-form-error">{actions.problem}</p>}
    </div>
  )
}
