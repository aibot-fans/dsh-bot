import { OWNER, POD, type RoomMessage } from 'pod-domain'

/** 跟着回复走、放在回复文字下面的卡片和状态：页面、任务记号、等你处理、提示、周报。 */
const TRAILING: ReadonlySet<string> = new Set(['page', 'task-card', 'wait', 'notice', 'weekly'])

/** 对话里不放的：里程碑、回执、浏览器和电脑卡片（浏览器、电脑在顶上的按钮里看）。 */
const HIDDEN: ReadonlySet<string> = new Set(['milestone', 'receipt', 'browser', 'computer'])

/**
 * 对话里只有对话：上面这几种都不放；任务群里回合出错也不放（任务自己重试，恢复不了才变成等你）。
 * 消息本身照旧留着，任务页的时间线里还在。
 */
export function shownInChat(message: RoomMessage, taskRoom: boolean): boolean {
  if (HIDDEN.has(message.kind)) return false
  return !(taskRoom && message.kind === 'notice' && message.data.turnError !== undefined)
}

/** 时间线里的一段：同一个 bot 连着说的话（texts），和跟着它的卡片、状态（cards）。 */
export interface ReplyBlock {
  /** 说话的 bot；你的消息、分隔线和 Pod 的状态行单独成段，是 undefined。 */
  readonly author: string | undefined
  readonly texts: readonly RoomMessage[]
  readonly cards: readonly RoomMessage[]
}

function divider(message: RoomMessage): boolean {
  return message.kind === 'notice' && message.data.segment === true
}

/**
 * 把消息排成一段段回复，每段先放文字，bot 自己发的卡片和状态放在下面（bot 往往先存页面、派任务，最后才说话）。
 * 你说话、分隔线、换了别的 bot 说话，或者文字之后又来了卡片再来文字，都另起一段。
 * Pod 自己的状态行（出错、提示）不属于哪一段回复，按时间留在原处。
 * 只改显示的先后，不改消息本身。
 */
export function arrange(messages: readonly RoomMessage[]): readonly ReplyBlock[] {
  const blocks: ReplyBlock[] = []
  let author: string | undefined
  let texts: RoomMessage[] = []
  let cards: RoomMessage[] = []
  const flush = (): void => {
    if (texts.length > 0 || cards.length > 0) blocks.push({ author, texts, cards })
    author = undefined
    texts = []
    cards = []
  }
  for (const message of messages) {
    if (message.author === OWNER || message.author === POD || divider(message)) {
      flush()
      blocks.push({ author: undefined, texts: [message], cards: [] })
      continue
    }
    const bot = message.author
    if (TRAILING.has(message.kind)) {
      // 文字后面又来了卡片：前一段到这里为止，卡片跟着这个 bot 的下一句话；别的 bot 的卡片另起一段。
      if (texts.length > 0 || (author !== undefined && bot !== author)) flush()
      cards.push(message)
      author = bot
      continue
    }
    if (author !== undefined && bot !== author) flush()
    texts.push(message)
    author = bot
  }
  flush()
  return blocks
}
