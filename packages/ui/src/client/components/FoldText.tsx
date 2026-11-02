import { useState } from 'react'
import { t } from 'pod-domain'

/** 长文字先只露前面一截，点“展开”看全文。 */
export function FoldText(props: { readonly text: string; readonly limit?: number }) {
  const [open, setOpen] = useState(false)
  const limit = props.limit ?? 240
  const long = props.text.length > limit
  return (
    <>
      {long && !open ? `${props.text.slice(0, limit)}…` : props.text}
      {long ? (
        <button type="button" className="pod-link pod-fold" onClick={() => setOpen(!open)}>
          {open ? t('收起') : t('展开')}
        </button>
      ) : null}
    </>
  )
}
