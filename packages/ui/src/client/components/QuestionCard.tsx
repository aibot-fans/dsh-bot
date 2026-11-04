import { useState } from 'react'
import { t, type Wait } from 'pod-domain'
import { Button } from './common.tsx'
import { Markdown } from './Markdown.tsx'
import { settledText, useWaitActions, waitNote, type CardPlace } from './waitAnswer.ts'

interface Option {
  readonly label: string
  /** 选项下面那行小字：选了会怎样。 */
  readonly note: string
}

function optionsOf(wait: Wait): readonly Option[] {
  const labels: readonly unknown[] = Array.isArray(wait.data.options) ? wait.data.options : []
  const notes: readonly unknown[] = Array.isArray(wait.data.optionNotes) ? wait.data.optionNotes : []
  return labels.flatMap((label, index) => {
    const note = notes[index]
    return typeof label === 'string' && label !== '' ? [{ label, note: typeof note === 'string' ? note : '' }] : []
  })
}

/** 最后一行自己写：点开是输入框，回车发出。 */
function WriteRow(props: { readonly first: boolean; readonly busy: boolean; readonly onSend: (text: string) => void; readonly onSkip?: () => void }) {
  const [writing, setWriting] = useState(false)
  const [text, setText] = useState('')
  const send = (): void => {
    if (text.trim() !== '') props.onSend(text.trim())
  }
  if (!writing) {
    return (
      <div className="pod-qcard-row">
        <button type="button" className="pod-qcard-other" onClick={() => setWriting(true)}>
          {props.first ? t('写下你的回答…') : t('其他，自己写…')}
        </button>
        {props.onSkip === undefined ? null : (
          <button type="button" className="pod-link pod-qcard-skip" disabled={props.busy} onClick={props.onSkip} title={t('不答这个问题，让它自己定')}>
            {t('跳过')}
          </button>
        )}
      </div>
    )
  }
  return (
    <div className="pod-qcard-write">
      <textarea
        className="pod-textarea pod-textarea-small"
        rows={1}
        autoFocus
        value={text}
        placeholder={t('写下你的回答…')}
        onChange={(event) => setText(event.target.value)}
        onKeyDown={(event) => {
          if (event.key !== 'Enter' || event.shiftKey || event.nativeEvent.isComposing) return
          event.preventDefault()
          send()
        }}
      />
      <Button small kind="primary" disabled={props.busy || text.trim() === ''} onClick={send}>
        {t('发送')}
      </Button>
    </div>
  )
}

/**
 * 问题卡片：要你拿主意的事。最上面是问题，下面每个选项一行，选项下面一行小字写选了会怎样，推荐的在第一个、带“推荐”；
 * 点一个就是你的回答。最后一行“其他，自己写…”和“跳过”（不答，让干活的 bot 自己定）；没有选项时这一行写“写下你的回答…”。
 * 答过以后选的那个标蓝、其余变灰，自己写的答复标蓝放在最后一行。
 */
export function QuestionCard(props: { readonly wait: Wait; readonly place: CardPlace }) {
  const { wait } = props
  const actions = useWaitActions(wait, props.place)
  const options = optionsOf(wait)
  const note = waitNote(wait)
  const { settled } = actions
  const answer = settled?.status === 'resolved' ? (settled.answer ?? '').trim() : ''
  const written = answer !== '' && !options.some((option) => option.label === answer)
  return (
    <div className="pod-qcard">
      <div className="pod-qcard-title">{wait.title}</div>
      {note.text === '' || note.folded ? null : (
        <div className="pod-qcard-desc">
          <Markdown text={note.text} />
        </div>
      )}
      {options.map((option, index) => (
        <button
          key={option.label}
          type="button"
          className={`pod-qcard-option${settled === undefined ? '' : option.label === answer ? ' pod-qcard-picked' : ' pod-qcard-off'}`}
          disabled={settled !== undefined || actions.busy}
          onClick={() => actions.answer(option.label)}
        >
          <span className="pod-qcard-label">
            {option.label}
            {index === 0 && wait.data.recommended === true ? <span className="pod-qcard-rec">{t('推荐')}</span> : null}
          </span>
          {option.note === '' ? null : <span className="pod-qcard-note">{option.note}</span>}
        </button>
      ))}
      {settled === undefined ? (
        <WriteRow first={options.length === 0} busy={actions.busy} onSend={actions.answer} onSkip={actions.skip} />
      ) : written ? (
        <div className="pod-qcard-other pod-qcard-picked">{answer}</div>
      ) : answer === '' ? (
        <div className="pod-qcard-result">{settledText(settled)}</div>
      ) : null}
      {note.text === '' || !note.folded ? null : (
        <details className="pod-qcard-detail">
          <summary>{t('详情')}</summary>
          <Markdown text={note.text} />
        </details>
      )}
      {actions.problem === undefined ? null : <p className="pod-form-error pod-qcard-problem">{actions.problem}</p>}
    </div>
  )
}
