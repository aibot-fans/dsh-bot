import { ROUTE_LABELS, t, type Bot, type RouteKind } from 'pod-domain'
import { api, type RouteView } from '../../api/endpoints.ts'
import { useApp } from '../../state/app.ts'
import { useResource } from '../../state/resource.ts'

/** X 监控这类自动来源由轻量模型判断，不是前台。 */
const JUDGE_LABELS: Partial<Readonly<Record<RouteKind, string>>> = { opened: '自动判断：开了任务', ignored: '自动判断：不用处理' }

function routeText(route: RouteView, bots: ReadonlyMap<string, Bot>): string {
  const front = route.route === 'front' && route.botId !== null ? t('（{bot}）', { bot: bots.get(route.botId)?.name ?? route.botId }) : ''
  const note = route.note === '' ? '' : t('：{note}', { note: route.note })
  const label = (route.decidedBy === 'judge' ? JUDGE_LABELS[route.route] : undefined) ?? ROUTE_LABELS[route.route]
  return `${t(label)}${front}${note}`
}

/** 鼠标停在你的消息（和 X 监控的事件）上时显示它的去向：开了哪个任务、转给哪个任务、不用处理（原因）、被哪个任务交还、被规则挡掉（原因）。 */
export function MessageRoutes(props: { readonly messageId: string; readonly bots: ReadonlyMap<string, Bot> }) {
  const app = useApp()
  const { data } = useResource(app.cache, `routes:${props.messageId}`, () => api.messageRoutes(props.messageId))
  if (data === undefined || data.length === 0) return null
  return (
    <div className="pod-msg-routes" role="note" aria-label={t('这条消息的去向')}>
      <span className="pod-msg-routes-title">{t('去向')}</span>
      <ol>
        {data.map((route) => {
          const taskId = route.taskId
          return (
            <li key={route.id}>
              <span>{routeText(route, props.bots)}</span>
              {taskId === null || route.taskTitle === null ? null : (
                <button type="button" className="pod-link" onClick={() => app.openTask(taskId)}>
                  {t('「{title}」', { title: route.taskTitle })}
                </button>
              )}
            </li>
          )
        })}
      </ol>
    </div>
  )
}
