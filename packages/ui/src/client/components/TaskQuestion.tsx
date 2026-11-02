import { useState } from 'react'
import { t, type Wait } from 'pod-domain'
import { Badge, Button } from './common.tsx'
import { WaitView } from './WaitCard.tsx'

/** 任务卡上要你回答的问题（只放一个，最早的）：点“答复”在卡上展开答复框，选项点一下就是答复。 */
export function TaskQuestion(props: { readonly wait: Wait; readonly more: number }) {
  const [open, setOpen] = useState(false)
  return (
    <div className="pod-task-question">
      <div className="pod-row pod-wrap">
        <Badge tone="warn">{t('要你回答')}</Badge>
        <span className="pod-task-question-text">{props.wait.title}</span>
        {props.more > 0 ? <span className="pod-muted-inline">{t('还有 {count} 件', { count: props.more })}</span> : null}
        <Button small kind={open ? 'quiet' : 'primary'} onClick={() => setOpen((value) => !value)}>
          {open ? t('收起') : t('答复')}
        </Button>
      </div>
      {open ? <WaitView wait={props.wait} /> : null}
    </div>
  )
}
