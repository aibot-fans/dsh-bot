import type { PanelIconProps } from './dsh.ts'

/** 侧栏行的图标：一个豆荚里三颗豆，代表一组 bot。外壳负责按钮、文字和选中态。 */
export function PodIcon({ size }: PanelIconProps) {
  return (
    <svg
      data-dsh-panel-entry="pod"
      viewBox="0 0 16 16"
      width={size}
      height={size}
      fill="none"
      stroke="currentColor"
      strokeWidth="1.3"
      strokeLinecap="round"
      aria-hidden="true"
    >
      <rect x="1.75" y="4.75" width="12.5" height="6.5" rx="3.25" />
      <circle cx="5" cy="8" r="0.9" />
      <circle cx="8" cy="8" r="0.9" />
      <circle cx="11" cy="8" r="0.9" />
    </svg>
  )
}
