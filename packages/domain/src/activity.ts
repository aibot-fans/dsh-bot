import { stageGroup } from './engine/stage.ts'
import type { TaskSnapshot } from './tasks.ts'

/**
 * 动态：照 Comma 的做法，只记干活的 bot 做成的一步（里程碑），每一步归在它跟着的那一句下面。
 * 一组的开头一行：群里是建群、你说的一句、Super-agent 或组长转来的一件、到点跑的一轮；任务里是创建任务、之后每次接着说、每一轮。
 * 下面是这一组里做成的几步（bot 记的进展、交的结果），点了跳到它之后交的结果；还在干的那一组最后多一行“正在处理…”。
 * 一步都没有的组不列（建群、创建任务那一行除外）。
 */

/** 一组开头的那一行：group 建了群；task 创建了任务；said 一句话（你说的、转来的）；run 到点跑的一轮。 */
export type ActivityRequestKind = 'group' | 'task' | 'said' | 'run'

export interface ActivityRequest {
  readonly kind: ActivityRequestKind
  /** said 是那句话的第一行；别的由页面写。 */
  readonly text: string
  readonly at: number
}

/** 做成的一步。 */
export interface ActivityStep {
  /** 一行字；不是这件事负责的 bot 记的，前面带着名字。 */
  readonly title: string
  readonly at: number
  /** 点了跳到的消息：这一步之后交的结果、回答，没有就是这一步之前对话里最后一句；都没有是 null。 */
  readonly messageId: string | null
}

export interface ActivityGroup {
  /** 稳定的标识：开头那句消息的 id、那一轮执行的 id；建群、创建任务是群、任务的 id。 */
  readonly key: string
  readonly request: ActivityRequest
  readonly steps: readonly ActivityStep[]
  /** 这一组的事还在干：最后多一行“正在处理…”。 */
  readonly live: boolean
}

/** 一段对话（群、单聊、任务对话）或一件任务的动态，先的在前。 */
export interface Activity {
  readonly groups: readonly ActivityGroup[]
}

export interface RoomActivity extends Activity {
  readonly roomId: string
}

/** 一件活现在的状态：在动（转圈）、等着（到点、新消息、成员交上来）、等你、没做成、暂停着、做完了、结束了（停掉的、无需处理的）。 */
export type ActivityState = 'moving' | 'still' | 'attention' | 'failed' | 'paused' | 'done' | 'ended'

/** 一件活现在的状态，和任务的状态图标一个规矩。 */
export function activityState(snapshot: TaskSnapshot): ActivityState {
  const { task, stage, children } = snapshot
  if (task.status === 'done' || (stage === 'ended' && task.endReason === 'done')) return 'done'
  if (stage === 'ended') return 'ended'
  if (stage === 'paused') return 'paused'
  // 子任务等组长验收是组长的事，不算等你。
  if (task.parentId !== null && stage === 'review') return 'moving'
  if (stage === 'failed') return 'failed'
  if (stageGroup(stage) === 'attention') return 'attention'
  if (stage === 'queued' || stage === 'running') return 'moving'
  return stage === 'idle' && children.some((child) => child.endedAt === null) ? 'moving' : 'still'
}
