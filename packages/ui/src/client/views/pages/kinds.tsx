import { PAGE_KIND_LABELS, isPageKind, type PageKind } from 'pod-domain'
import { Icon } from '../../components/Icon.tsx'

/** 页面种类的小图标：报告、看板、跟踪表、原型、幻灯片、海报、图示各一个。 */
export function KindIcon(props: { readonly kind: PageKind; readonly size?: number }) {
  const size = props.size ?? 34
  return (
    <span className="pod-kind" style={{ width: size, height: size }} title={PAGE_KIND_LABELS[props.kind]} aria-hidden>
      <Icon name={`kind-${props.kind}`} size={Math.round(size * 0.53)} />
    </span>
  )
}

/** 消息数据里的种类：认不出就当报告。 */
export function kindOf(value: unknown): PageKind {
  return isPageKind(value) ? value : 'report'
}
