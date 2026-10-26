import { useState } from 'react'
import { planProgress, progressHealth, spoken, type PlanItem, type PlanStatus, type RunSummary, type TurnProgress } from 'pod-domain'
import { useNow } from './common.tsx'
import { Icon } from './Icon.tsx'

const PLAN_STATUS: Readonly<Record<PlanStatus, string>> = { completed: '已完成', in_progress: '正在做', pending: '还没开始' }

interface StepLine {
  readonly label: string
  readonly ms: number
  /** 还在跑是 null。 */
  readonly ok: boolean | null
}

/** 计划：做完的打勾，正在做的转圈并加粗，没开始的淡色。 */
function PlanList(props: { readonly plan: readonly PlanItem[] }) {
  return (
    <ol className="pod-plan" aria-label="计划">
      {props.plan.map((item, index) => (
        <li key={`${index}:${item.content}`} className={`pod-plan-item pod-plan-${item.status}`}>
          <span className="pod-plan-mark" role="img" aria-label={PLAN_STATUS[item.status]}>
            {item.status === 'completed' ? <Icon name="check" size={12} /> : item.status === 'in_progress' ? <span className="pod-spinner pod-spinner-small" /> : <Icon name="dot" size={12} />}
          </span>
          <span>{item.content}</span>
        </li>
      ))}
    </ol>
  )
}

/** 每一步一行：做了什么、用了多久、成没成。 */
function StepList(props: { readonly steps: readonly StepLine[]; readonly omitted: number }) {
  return (
    <ol className="pod-steps" aria-label="每一步">
      {props.omitted > 0 ? <li className="pod-steps-more">前面还有 {props.omitted} 步</li> : null}
      {props.steps.map((step, index) => (
        <li key={index} className={`pod-step${step.ok === false ? ' pod-step-failed' : ''}`}>
          <span className="pod-step-mark" role="img" aria-label={step.ok === null ? '在做' : step.ok ? '成了' : '出错'}>
            {step.ok === null ? <span className="pod-spinner pod-spinner-small" /> : <Icon name={step.ok ? 'check' : 'close'} size={12} />}
          </span>
          <span className="pod-step-label">{step.label}</span>
          <span className="pod-step-time">{spoken(step.ms)}</span>
        </li>
      ))}
    </ol>
  )
}

export interface ProgressBlockProps {
  readonly progress: TurnProgress | null
  /** 没有进度时显示的正在做的事；空串是在想。 */
  readonly label: string
  /** 正在输入回复的文字。 */
  readonly streaming: boolean
  /** 看着不太对的时候给的两个按钮：让它汇报一下、停止。只有聊天里给。 */
  readonly onReport?: () => void
  readonly onStop?: () => void
  /** 看门狗标了“可能在绕圈”（任务卡里）。 */
  readonly stalled?: boolean
}

/**
 * 回答进行中的执行进度：正在做什么（跑命令时下面一行小字是原始命令和这一步跑了多久）、已经多久、第几步、计划做到哪，
 * 正在想时是思考的最后一句，想完了在头上写“想了 N 秒”。每一步可以展开看。
 * 一步跑了太久、连着出错、连着做同一步、计划很久没动时，下面出一行提示，可以让它汇报或者停止。
 */
export function ProgressBlock(props: ProgressBlockProps) {
  const now = useNow(1000)
  const [open, setOpen] = useState(false)
  const { progress } = props
  const current = progress?.steps.findLast((step) => step.ok === null)
  const thinking = progress?.thinking ?? null
  const status = current !== undefined ? `正在${current.label}` : thinking !== null ? '正在想' : props.streaming ? '正在输入' : props.label === '' ? '正在想' : `正在${props.label}`
  const thought = progress === null ? 0 : progress.thoughtMs + (progress.thinkingSince === null ? 0 : now - progress.thinkingSince)
  const plan = planProgress(progress?.plan ?? [])
  const meta =
    progress === null
      ? []
      : [
          spoken(now - progress.startedAt),
          progress.calls > 0 ? `${progress.calls} 步` : undefined,
          plan.total > 0 ? `计划 ${plan.done}/${plan.total}` : undefined,
          thinking === null && thought >= 1000 ? `想了 ${spoken(thought)}` : undefined,
        ].filter((part): part is string => part !== undefined)
  const health = progress === null ? null : progressHealth(progress, now)
  const steps = (progress?.steps ?? []).map((step) => ({ label: step.label, ms: (step.endedAt ?? now) - step.startedAt, ok: step.ok }))
  const stepAge = current === undefined ? 0 : now - current.startedAt
  return (
    <div className="pod-progress">
      <div className="pod-progress-head">
        <span className="pod-spinner" aria-hidden />
        <span className="pod-progress-now">{status}</span>
        {meta.length === 0 ? null : <span className="pod-progress-meta">{meta.join(' · ')}</span>}
        {props.stalled === true ? <span className="pod-badge pod-badge-warn">可能在绕圈</span> : null}
      </div>
      {current !== undefined && (current.command !== null || stepAge >= 10_000) ? (
        <div className="pod-progress-command">
          {current.command === null ? null : <code>{current.command}</code>}
          <span>这一步 {spoken(stepAge)}</span>
        </div>
      ) : null}
      {thinking === null ? null : <p className="pod-progress-thought">{thinking}</p>}
      {progress === null || progress.plan.length === 0 ? null : <PlanList plan={progress.plan} />}
      {steps.length === 0 ? null : (
        <button type="button" className="pod-progress-toggle" aria-expanded={open} onClick={() => setOpen((value) => !value)}>
          <Icon name={open ? 'up' : 'down'} size={12} />
          {open ? '收起每一步' : `看每一步（${progress?.calls ?? steps.length}）`}
        </button>
      )}
      {open ? <StepList steps={steps} omitted={(progress?.calls ?? 0) - steps.length} /> : null}
      {health === null || (props.onReport === undefined && props.onStop === undefined) ? null : (
        <div className="pod-progress-health" role="status">
          <span>{health.text}</span>
          {props.onReport === undefined ? null : (
            <button type="button" className="pod-link" onClick={props.onReport}>
              让它汇报
            </button>
          )}
          {props.onStop === undefined ? null : (
            <button type="button" className="pod-link pod-link-danger" onClick={props.onStop}>
              停止
            </button>
          )}
        </div>
      )}
    </div>
  )
}

/** 跑完的回答下面的一行：用时、几步、几步出错、想了多久；点开是计划和每一步（只有一句话，没有命令输出）。 */
export function RunSummaryLine(props: { readonly run: RunSummary }) {
  const [open, setOpen] = useState(false)
  const { run } = props
  const failed = run.steps.filter((step) => !step.ok).length
  const parts = [`用时 ${spoken(run.ms)}`, run.calls > 0 ? `${run.calls} 步` : undefined, failed > 0 ? `${failed} 步出错` : undefined, run.thoughtMs >= 1000 ? `想了 ${spoken(run.thoughtMs)}` : undefined].filter(
    (part): part is string => part !== undefined,
  )
  return (
    <div className="pod-run">
      <button type="button" className="pod-run-toggle" aria-expanded={open} onClick={() => setOpen((value) => !value)}>
        <Icon name={open ? 'up' : 'down'} size={12} />
        <span>{parts.join(' · ')}</span>
      </button>
      {open ? (
        <div className="pod-run-body">
          {run.plan.length === 0 ? null : <PlanList plan={run.plan} />}
          <StepList steps={run.steps} omitted={run.calls - run.steps.length} />
        </div>
      ) : null}
    </div>
  )
}
