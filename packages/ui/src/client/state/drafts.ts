import type { RoomMessage } from 'pod-domain'

/**
 * 输入框的草稿：没发出去的字、引用的消息和附件，按对话存在这个浏览器里。
 * 换对话、关掉页面、dsh web 重启以后回来还在；发出去就清掉。
 * 字和引用放 localStorage；附件放 IndexedDB，同一次打开里先放内存，换回来马上就有。
 * 隐私模式这类存不了的情况，只在这次打开里有效。
 */

/** key 是对话 id；页面旁边的修改对话用 `page:页面 id`。 */
export const PAGE_DRAFT_PREFIX = 'page:'

const PREFIX = 'pod-ui.draft.v1:'
/** 引用只留输入框上面那行要用的：正文前 200 字。 */
const REPLY_BODY_MAX = 200
/** 和上传的上限一样：超过 15 MB 的发不出去，不往本地存。 */
const FILE_KEEP_MAX = 15 * 1024 * 1024
const DB_NAME = 'pod-ui-drafts'
const FILE_STORE = 'files'

export interface Draft {
  readonly text: string
  readonly reply: RoomMessage | undefined
}

const EMPTY: Draft = { text: '', reply: undefined }
const drafts = new Map<string, Draft>()
const files = new Map<string, readonly File[]>()
let pruned = false

function storage(): Storage | undefined {
  try {
    return globalThis.localStorage ?? undefined
  } catch {
    return undefined
  }
}

function parse(raw: string | null | undefined): Draft {
  if (raw === null || raw === undefined) return EMPTY
  try {
    const value = JSON.parse(raw) as { readonly text?: unknown; readonly reply?: Partial<RoomMessage> | null }
    const reply = value.reply
    const valid = typeof reply === 'object' && reply !== null && typeof reply.id === 'string' && typeof reply.author === 'string' && typeof reply.body === 'string'
    return { text: typeof value.text === 'string' ? value.text : '', reply: valid ? (reply as RoomMessage) : undefined }
  } catch {
    return EMPTY
  }
}

/** 这个对话的草稿。 */
export function readDraft(key: string): Draft {
  const cached = drafts.get(key)
  if (cached !== undefined) return cached
  let raw: string | null | undefined
  try {
    raw = storage()?.getItem(PREFIX + key)
  } catch {
    raw = undefined
  }
  const draft = parse(raw)
  drafts.set(key, draft)
  return draft
}

function write(key: string, draft: Draft): void {
  drafts.set(key, draft)
  try {
    if (draft.text === '' && draft.reply === undefined) storage()?.removeItem(PREFIX + key)
    else storage()?.setItem(PREFIX + key, JSON.stringify({ text: draft.text, reply: draft.reply ?? null }))
  } catch {
    // 存满了或者不让存：只在这次打开里有效。
  }
}

export function saveDraftText(key: string, text: string): void {
  const current = readDraft(key)
  if (current.text !== text) write(key, { ...current, text })
}

export function saveDraftReply(key: string, reply: RoomMessage | undefined): void {
  const current = readDraft(key)
  if (current.reply?.id === reply?.id) return
  write(key, { ...current, reply: reply === undefined ? undefined : { ...reply, body: reply.body.slice(0, REPLY_BODY_MAX), data: {} } })
}

// 别的标签页改了草稿：下次用到时重新读。
try {
  globalThis.addEventListener?.('storage', (event: StorageEvent) => {
    if (event.key === null) drafts.clear()
    else if (event.key.startsWith(PREFIX)) drafts.delete(event.key.slice(PREFIX.length))
  })
} catch {
  // 不在浏览器里：没有别的标签页。
}

// ---------- 附件 ----------

let opening: Promise<IDBDatabase | undefined> | undefined

function database(): Promise<IDBDatabase | undefined> {
  opening ??= new Promise((resolve) => {
    try {
      const request = globalThis.indexedDB.open(DB_NAME, 1)
      request.onupgradeneeded = () => request.result.createObjectStore(FILE_STORE)
      request.onsuccess = () => resolve(request.result)
      request.onerror = () => resolve(undefined)
      request.onblocked = () => resolve(undefined)
    } catch {
      resolve(undefined)
    }
  })
  return opening
}

/** 在附件表上跑一个请求；打不开、出错都当没有。 */
async function run<T>(mode: IDBTransactionMode, work: (store: IDBObjectStore) => IDBRequest<T>): Promise<T | undefined> {
  const db = await database()
  if (db === undefined) return undefined
  return new Promise((resolve) => {
    try {
      const request = work(db.transaction(FILE_STORE, mode).objectStore(FILE_STORE))
      request.onsuccess = () => resolve(request.result)
      request.onerror = () => resolve(undefined)
    } catch {
      resolve(undefined)
    }
  })
}

/** 这个对话没发出去的附件。 */
export async function readDraftFiles(key: string): Promise<readonly File[]> {
  const kept = files.get(key)
  if (kept !== undefined) return kept
  const stored: unknown = await run('readonly', (store) => store.get(key))
  const list = Array.isArray(stored) ? stored.filter((item): item is File => item instanceof File) : []
  // 读的这会儿又存过（换回来马上加了附件）：以新的为准。
  const latest = files.get(key) ?? list
  files.set(key, latest)
  return latest
}

export function saveDraftFiles(key: string, list: readonly File[]): void {
  const kept = files.get(key) ?? []
  if (kept.length === list.length && kept.every((file, index) => file === list[index])) return
  files.set(key, list)
  const keep = list.filter((file) => file.size <= FILE_KEEP_MAX)
  if (keep.length === 0) void run('readwrite', (store) => store.delete(key))
  else void run('readwrite', (store) => store.put(keep, key))
}

/** 打开页面后清一次：对话已经不在了（删了、临时对话离开了）的草稿。页面的修改对话只有几个字，不清。 */
export function pruneDrafts(roomIds: ReadonlySet<string>): void {
  if (pruned) return
  pruned = true
  const gone = (key: string): boolean => !key.startsWith(PAGE_DRAFT_PREFIX) && !roomIds.has(key)
  const store = storage()
  try {
    const names = store === undefined ? [] : Array.from({ length: store.length }, (_, index) => store.key(index))
    for (const name of names) {
      if (name === null || !name.startsWith(PREFIX) || !gone(name.slice(PREFIX.length))) continue
      store?.removeItem(name)
      drafts.delete(name.slice(PREFIX.length))
    }
  } catch {
    // 读不了 localStorage：没什么可清的。
  }
  void run('readonly', (table) => table.getAllKeys()).then((keys) => {
    for (const key of keys ?? []) {
      if (typeof key !== 'string' || !gone(key)) continue
      files.delete(key)
      void run('readwrite', (table) => table.delete(key))
    }
  })
}
