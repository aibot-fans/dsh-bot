import { t, type PodSettings } from 'pod-domain'
import { Button, Segmented, Switch } from '../../components/common.tsx'
import { useApp } from '../../state/app.ts'
import { MemoryChanges } from '../memory/MemoryView.tsx'
import { Row, type Update } from './Row.tsx'

/** 工作方式：bot 怎么干活。暂停、放手程度、同时做几件事，再是记忆：自动记住要点、每晚整理、你的档案和记忆变更日志。 */
export function WorkPage(props: { readonly settings: PodSettings; readonly update: Update }) {
  const app = useApp()
  const { settings, update } = props
  return (
    <div className="pod-settings-body">
      <Row label={t('暂停处理')} hint={t('开工、送消息、往聊天室发、例程都先停着，消息照旧记下；关掉后排着的按原来的顺序接着做。换模型、改提示词、升级重启前用')}>
        <Switch checked={settings.paused} label={t('暂停处理')} onChange={(paused) => update({ paused })} />
      </Row>
      <Row label={t('放手程度')} hint={t('谨慎：bot 组队开工前，先把计划发给你看')}>
        <Segmented
          value={settings.autonomy}
          options={[
            ['hands-off', t('放手')],
            ['careful', t('谨慎')],
          ]}
          onChange={(autonomy) => update({ autonomy })}
          label={t('放手程度')}
        />
      </Row>
      <Row label={t('同时进行的任务')} hint={t('超出的排队，不拒绝')}>
        <input className="pod-input pod-input-number" type="number" min={1} max={32} aria-label={t('同时进行的任务数')} value={settings.taskConcurrency} onChange={(event) => update({ taskConcurrency: Number(event.target.value) })} />
      </Row>
      <Row label={t('给你说话留的通道')} hint={t('任务再多，你说话也不用排队')}>
        <input className="pod-input pod-input-number" type="number" min={1} max={32} aria-label={t('聊天通道数')} value={settings.chatConcurrency} onChange={(event) => update({ chatConcurrency: Number(event.target.value) })} />
      </Row>
      <Row label={t('自动记住要点')} hint={t('从对话里提取值得记的事，存进对应 bot 的记忆；无痕对话不提取')}>
        <Switch checked={settings.memoryExtraction} label={t('自动记住要点')} onChange={(memoryExtraction) => update({ memoryExtraction })} />
      </Row>
      <Row label={t('每晚整理记忆')} hint={t('夜里空下来的时候核对记忆：重复的并成笔记，过时的换掉，更新每次都带的要点。头 3 次的结果先给你看')}>
        <Switch checked={settings.memoryDream} label={t('每晚整理记忆')} onChange={(memoryDream) => update({ memoryDream })} />
        <Button small onClick={() => app.openDrawer({ kind: 'dreams' })}>
          {t('整理记录')}
        </Button>
      </Row>
      <Row label={t('你的档案')} hint={t('Super-agent 记下的关于你的事：偏好、习惯、约定')}>
        <Button small onClick={() => app.openDrawer({ kind: 'memory', scope: 'owner', scopeId: '', label: t('你的档案') })}>
          {t('打开')}
        </Button>
      </Row>
      <details className="pod-settings-group">
        <summary>{t('记忆变更日志')}</summary>
        <MemoryChanges />
      </details>
    </div>
  )
}
