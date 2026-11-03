import type { Bot, TaskSnapshot } from 'pod-domain'
import { api } from '../api/endpoints.ts'
import { useApp } from '../state/app.ts'
import { useResource } from '../state/resource.ts'
import { Avatar } from './common.tsx'
import { GroupMark } from './GroupMark.tsx'

/**
 * 这件事是谁在干：交给一个 bot 的是它；开了任务群的是负责的 bot 在前，后面是群里的其他成员。
 * Super-agent 只是派活的，不算在里面（它自己负责的除外）。
 */
export function useTaskPeople(snapshot: TaskSnapshot | undefined): readonly Bot[] {
  const app = useApp()
  const { data: rooms } = useResource(app.cache, 'rooms', () => api.rooms())
  const { data: bots } = useResource(app.cache, 'bots', () => api.bots())
  if (snapshot === undefined) return []
  const owner = snapshot.task.ownerBotId
  const group = snapshot.groupRoomId === null ? undefined : rooms?.find((room) => room.id === snapshot.groupRoomId)
  const others = (group?.memberIds ?? []).filter((id) => id !== owner)
  const ids = owner === null ? others : [owner, ...others]
  return ids
    .map((id) => bots?.find((bot) => bot.id === id))
    .filter((bot): bot is Bot => bot !== undefined && (bot.role !== 'lead' || bot.id === owner))
}

/** 头像：一个 bot 是它的头像，几个 bot 是拼在一起的群头像。 */
export function TaskPeople(props: { readonly people: readonly Bot[]; readonly size: number }) {
  const [first] = props.people
  if (first === undefined) return null
  return props.people.length > 1 ? <GroupMark members={props.people} size={props.size} /> : <Avatar bot={first} size={props.size} />
}
