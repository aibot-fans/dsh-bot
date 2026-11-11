/**
 * 动态里一行行左边的 16px 小图标（照 Comma 动态的样子）：建群、创建任务是圈里一个加号，一句话是气泡，
 * 循环运行是无穷，做成的一步是实心圆里镂空的勾，正在处理是转圈，折起来的几行是三个点。
 */
export type GlyphName = 'created' | 'said' | 'run' | 'done' | 'live' | 'more'

const LINE = { fill: 'none', stroke: 'currentColor', strokeWidth: 1.3, strokeLinecap: 'round', strokeLinejoin: 'round' } as const

function shapes(name: GlyphName) {
  switch (name) {
    case 'created':
      return (
        <g {...LINE}>
          <circle cx="8" cy="8" r="6" />
          <path d="M8 5.4v5.2M5.4 8h5.2" />
        </g>
      )
    case 'said':
      return <path {...LINE} d="M4.75 3h6.5a2 2 0 0 1 2 2v4a2 2 0 0 1-2 2H7.25l-2.5 2.25V11a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2z" />
    case 'run':
      return <path {...LINE} d="M5.25 5.5C3.9 5.5 2.75 6.6 2.75 8s1.15 2.5 2.5 2.5c2.25 0 3.25-5 5.5-5 1.35 0 2.5 1.1 2.5 2.5s-1.15 2.5-2.5 2.5c-2.25 0-3.25-5-5.5-5z" />
    case 'done':
      // 圆和勾画成一条路径，奇偶填充把勾镂空，底下是什么颜色勾就是什么颜色。
      return <path fill="currentColor" fillRule="evenodd" d="M8 1.5a6.5 6.5 0 1 1 0 13a6.5 6.5 0 1 1 0-13zM5.73 7.67L7.08 9.02L10.25 5.59L11.35 6.61L7.12 11.18L4.67 8.73z" />
    case 'live':
      return (
        <g {...LINE} className="pod-act-spin">
          <circle cx="8" cy="8" r="5.6" opacity="0.3" />
          <path d="M8 2.4a5.6 5.6 0 0 1 5.6 5.6" />
        </g>
      )
    case 'more':
      return (
        <g fill="currentColor">
          <circle cx="3.5" cy="8" r="1.1" />
          <circle cx="8" cy="8" r="1.1" />
          <circle cx="12.5" cy="8" r="1.1" />
        </g>
      )
  }
}

export function ActivityGlyph(props: { readonly name: GlyphName }) {
  return (
    <svg width={16} height={16} viewBox="0 0 16 16" aria-hidden focusable="false">
      {shapes(props.name)}
    </svg>
  )
}
