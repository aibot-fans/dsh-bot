import { useState } from 'react'
import { api } from '../../api/endpoints.ts'
import { errorText } from '../../api/http.ts'
import { Button, IconButton } from '../../components/common.tsx'
import { useApp } from '../../state/app.ts'
import { useResource } from '../../state/resource.ts'

export interface Rating {
  /** 1 是赞，-1 是踩，0 是没评。 */
  readonly current: number
  readonly rate: (value: number, why?: string) => void
}

/** 一条 bot 发言的评价：现在是赞、踩还是没评，以及改评价。 */
export function useRating(roomId: string, messageId: string): Rating {
  const app = useApp()
  const { data: ratings } = useResource(app.cache, `ratings:${roomId}`, () => api.ratings(roomId))
  return {
    current: ratings?.[messageId] ?? 0,
    rate: (value, why = '') => {
      api
        .rateMessage(messageId, value, why)
        .then(() => app.cache.invalidate(`ratings:${roomId}`))
        .catch((error: unknown) => window.alert(errorText(error)))
    },
  }
}

/** bot 发言下面的赞和踩：踩的时候可以附一句原因，自我优化按这些反馈调整经验和人设。 */
export function RateButtons(props: { readonly roomId: string; readonly messageId: string }) {
  const { current, rate } = useRating(props.roomId, props.messageId)
  const [asking, setAsking] = useState(false)
  const [reason, setReason] = useState('')
  return (
    <>
      <span className={current === 1 ? 'pod-rated' : ''}>
        <IconButton icon="up" label={current === 1 ? '取消赞' : '赞'} onClick={() => rate(current === 1 ? 0 : 1)} />
      </span>
      <span className={current === -1 ? 'pod-rated pod-rated-down' : ''}>
        <IconButton
          icon="down"
          label={current === -1 ? '取消踩' : '踩'}
          onClick={() => {
            if (current === -1) rate(0)
            else setAsking(true)
          }}
        />
      </span>
      {asking ? (
        <span className="pod-rate-reason">
          <input className="pod-input" autoFocus placeholder="哪里不好？可以不写" value={reason} onChange={(event) => setReason(event.target.value)} onKeyDown={(event) => event.key === 'Enter' && !event.nativeEvent.isComposing && (rate(-1, reason), setAsking(false), setReason(''))} />
          <Button
            small
            onClick={() => {
              rate(-1, reason)
              setAsking(false)
              setReason('')
            }}
          >
            提交
          </Button>
          <Button small kind="quiet" onClick={() => setAsking(false)}>
            取消
          </Button>
        </span>
      ) : null}
    </>
  )
}
