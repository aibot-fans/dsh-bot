import { stageGroup } from './engine/stage.ts'
import type { TaskSnapshot } from './tasks.ts'

/**
 * 动态：一段对话里干过的活，放在详情里成员下面（群、成员单聊），任务详情里也是它。
 * 一件活一组：标题、谁在干、你怎么说的；下面是干活的 bot 记的进展，最后一行是结果或者停在哪。
 * 任务对话里按交代和每次接着说分组；群里还有建群、谁进群出群这几行。
 */

/** 一件活的状态：在动（转圈）、等着（到点、新消息、成员交上来）、等你、没做成、暂停着、做完了、结束了（停掉的、无需处理的）。 */
export type ActivityState = 'moving' | 'still' | 'attention' | 'failed' | 'paused' | 'done' | 'ended'

/** 一件活里的一行：做成的一步、交给成员的一件、成员交上来的，或者最后一行（结果、停在哪）。 */
export interface ActivityEntry {
  /** 什么时候；在做的那一行是 null。 */
  readonly at: number | null
  readonly text: string
  /** step 做成的一步；handoff 交给成员；end 最后一行。 */
  readonly kind: 'step' | 'handoff' | 'end'
  /** 最后一行和成员那件结束时画的状态；做成的一步是 null（画勾）。 */
  readonly state: ActivityState | null
  /** 谁记的（不是这件活负责的 bot 时名字写在前面）。 */
  readonly botId: string | null
  /** 点了跳到的消息：这一步之后交的结果、等你的卡片、没做成的原因；没有是 null。 */
  readonly messageId: string | null
}

/** 一件活：群里、单聊里交代的一件事；任务对话里是交代和每次接着说。 */
export interface ActivityJob {
  readonly kind: 'job'
  readonly key: string
  readonly taskId: string
  readonly title: string
  readonly state: ActivityState
  readonly at: number
  /** 负责的 bot 在前，后面是交给过的成员。 */
  readonly botIds: readonly string[]
  /** 你怎么说的（交代这件事的原话、接着说的话）；不是你交代的是 null。 */
  readonly said: string | null
  /** 点“你说”跳到的消息（在这段对话里的）。 */
  readonly saidMessageId: string | null
  readonly entries: readonly ActivityEntry[]
}

/** 一行里程碑：建群、谁进群、谁出群。 */
export interface ActivityMark {
  readonly kind: 'mark'
  readonly key: string
  readonly at: number
  readonly text: string
  readonly mark: 'created' | 'member'
}

export type ActivityItem = ActivityJob | ActivityMark

/** 一段对话的动态，先的在前。 */
export interface RoomActivity {
  readonly roomId: string
  readonly items: readonly ActivityItem[]
}

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
