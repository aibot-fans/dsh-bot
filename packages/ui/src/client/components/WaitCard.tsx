import { useState } from 'react'
import { t, type RoomMessage } from 'pod-domain'
import { api } from '../api/endpoints.ts'
import { useApp } from '../state/app.ts'
import { useResource } from '../state/resource.ts'
import { Markdown } from './Markdown.tsx'
import { WaitAsk, readSettled, settledText } from './WaitAsk.tsx'

/**
 * 对话里的等你：还开着就是那句话后面带按钮（见 WaitAsk）；处理过了按钮收起，留一行小字。
 * 怎么处理的运行时记在消息上；刚点完、消息还没刷新时用这边记下的。
 */
export function WaitCard(props: { readonly message: RoomMessage }) {
  const app = useApp()
  const { message } = props
  const { data: waits } = useResource(app.cache, 'waits', () => api.waits())
  const [settled, setSettled] = useState<string | undefined>(undefined)
  const waitId = String(message.data.waitId ?? '')
  const wait = waits?.find((item) => item.id === waitId)
  const recorded = readSettled(message.data.settled)
  const closed = (text: string) => (
    <div className="pod-ask pod-ask-closed">
      <Markdown text={message.body} />
      <div className="pod-ask-done">{text}</div>
    </div>
  )
  if (settled !== undefined) return closed(settled)
  if (recorded !== undefined) return closed(settledText(recorded))
  if (waits === undefined) return <div className="pod-ask">{message.body}</div>
  if (wait === undefined) return closed(t('已处理'))
  return <WaitAsk wait={wait} onSettled={setSettled} />
}
