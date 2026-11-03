/** 气泡尾巴：一组话的最后一个气泡带一个，你的在右下，bot 的在左下（同一个形状翻过来）；颜色跟着气泡。 */
export function BubbleTail(props: { readonly side: 'left' | 'right' }) {
  return (
    <svg className={`pod-tail pod-tail-${props.side}`} viewBox="0 0 24 14" preserveAspectRatio="none" aria-hidden>
      <path
        fill="currentColor"
        d="M21.8078 0C20.0078 1 19.7594 6.40089 23.4997 12.4998C24.2565 13.7338 23.6023 13.9471 21.4402 13.7338C13.9997 12.9998 9.00268 3.99981 0 3.99981C0.00810194 3.99979 13.0078 0.499757 13.0078 0.499757C15.5075 1.01693 21.8078 0 21.8078 0Z"
      />
    </svg>
  )
}
