import { useCallback, useEffect, useSyncExternalStore } from 'react'

/**
 * 页面数据缓存：每份数据一个 key（例如 rooms、task:<id>），组件订阅自己用的 key。
 * 宿主推来“什么变了”的事件时按 key 失效，有人在看就重新拉；重新拉的过程中保留旧数据，不闪。
 */

export interface ResourceState<T> {
  readonly data: T | undefined
  readonly error: string | undefined
  readonly loading: boolean
}

interface Entry {
  state: ResourceState<unknown>
  fetcher: (() => Promise<unknown>) | undefined
  inflight: Promise<void> | undefined
  stale: boolean
  generation: number
}

const EMPTY: ResourceState<never> = { data: undefined, error: undefined, loading: false }

export class ResourceCache {
  private readonly entries = new Map<string, Entry>()
  private readonly listeners = new Map<string, Set<() => void>>()

  private entry(key: string): Entry {
    const existing = this.entries.get(key)
    if (existing !== undefined) return existing
    const created: Entry = { state: EMPTY, fetcher: undefined, inflight: undefined, stale: true, generation: 0 }
    this.entries.set(key, created)
    return created
  }

  snapshot<T>(key: string): ResourceState<T> {
    return (this.entries.get(key)?.state ?? EMPTY) as ResourceState<T>
  }

  subscribe(key: string, listener: () => void): () => void {
    const set = this.listeners.get(key) ?? new Set()
    set.add(listener)
    this.listeners.set(key, set)
    return () => {
      set.delete(listener)
      if (set.size === 0) this.listeners.delete(key)
    }
  }

  private notify(key: string): void {
    for (const listener of [...(this.listeners.get(key) ?? [])]) listener()
  }

  private setState(key: string, state: ResourceState<unknown>): void {
    this.entry(key).state = state
    this.notify(key)
  }

  load(key: string, fetcher: () => Promise<unknown>, force = false): Promise<void> {
    const entry = this.entry(key)
    entry.fetcher = fetcher
    if (entry.inflight !== undefined && !force) return entry.inflight
    if (!entry.stale && !force) return Promise.resolve()
    entry.stale = false
    entry.generation += 1
    const generation = entry.generation
    this.setState(key, { ...entry.state, loading: true })
    const run = fetcher()
      .then((data) => {
        if (entry.generation === generation) this.setState(key, { data, error: undefined, loading: false })
      })
      .catch((error: unknown) => {
        if (entry.generation === generation) {
          this.setState(key, { ...entry.state, error: error instanceof Error ? error.message : String(error), loading: false })
        }
      })
      .finally(() => {
        if (entry.generation === generation) entry.inflight = undefined
      })
    entry.inflight = run
    return run
  }

  /** 让一个或一组 key 失效；有人在看的立刻重新拉。 */
  invalidate(match: string | ((key: string) => boolean)): void {
    const test = typeof match === 'string' ? (key: string) => key === match || key.startsWith(`${match}:`) : match
    for (const [key, entry] of this.entries) {
      if (!test(key)) continue
      entry.stale = true
      if (this.listeners.has(key) && entry.fetcher !== undefined) void this.load(key, entry.fetcher, true)
    }
  }

  /** 直接写入数据（比如发消息后把返回的那条拼进列表），不用再拉一次。 */
  update<T>(key: string, change: (current: T | undefined) => T): void {
    const entry = this.entry(key)
    this.setState(key, { ...entry.state, data: change(entry.state.data as T | undefined) })
  }

  invalidateAll(): void {
    this.invalidate(() => true)
  }
}

/** 订阅一份数据；key 为 null 时不拉。 */
export function useResource<T>(cache: ResourceCache, key: string | null, fetcher: () => Promise<T>): ResourceState<T> & { readonly reload: () => void } {
  const subscribe = useCallback((listener: () => void) => (key === null ? () => {} : cache.subscribe(key, listener)), [cache, key])
  const getSnapshot = useCallback(() => (key === null ? EMPTY : cache.snapshot<T>(key)), [cache, key])
  const state = useSyncExternalStore(subscribe, getSnapshot, getSnapshot)
  useEffect(() => {
    if (key !== null) void cache.load(key, fetcher)
    // fetcher 每次渲染都是新函数；按 key 决定是否重新拉。
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [cache, key])
  const reload = useCallback(() => {
    if (key !== null) void cache.load(key, fetcher, true)
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [cache, key])
  return { ...(state as ResourceState<T>), reload }
}
