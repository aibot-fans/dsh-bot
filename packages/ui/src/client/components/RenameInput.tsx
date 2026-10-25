import { useState, type KeyboardEvent } from 'react'

/** 原地改名用的输入框：回车或点别处保存，Esc 放弃；没改或改成空的就当放弃。 */
export function RenameInput(props: {
  readonly value: string
  readonly max: number
  readonly label: string
  readonly onSave: (value: string) => void
  readonly onCancel: () => void
  readonly className?: string
}) {
  const [value, setValue] = useState(props.value)
  const finish = (): void => {
    const clean = value.trim()
    if (clean === '' || clean === props.value) props.onCancel()
    else props.onSave(clean)
  }
  const onKey = (event: KeyboardEvent<HTMLInputElement>): void => {
    if (event.key === 'Enter' && !event.nativeEvent.isComposing) finish()
    if (event.key === 'Escape') props.onCancel()
  }
  return (
    <input
      className={`pod-input pod-rename ${props.className ?? ''}`}
      autoFocus
      aria-label={props.label}
      value={value}
      maxLength={props.max}
      onFocus={(event) => event.target.select()}
      onChange={(event) => setValue(event.target.value)}
      onKeyDown={onKey}
      onBlur={finish}
      onClick={(event) => event.stopPropagation()}
    />
  )
}
