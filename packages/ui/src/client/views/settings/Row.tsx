import type { ReactNode } from 'react'
import type { PodSettings } from 'pod-domain'

export type Update = (patch: Partial<PodSettings>) => void

/** 设置里的一行：左边名字和说明，右边开关、按钮。 */
export function Row(props: { readonly label: string; readonly hint?: ReactNode; readonly children: ReactNode }) {
  return (
    <div className="pod-settings-row">
      <div>
        <div>{props.label}</div>
        {props.hint === undefined ? null : <div className="pod-hint">{props.hint}</div>}
      </div>
      <div className="pod-settings-control">{props.children}</div>
    </div>
  )
}
