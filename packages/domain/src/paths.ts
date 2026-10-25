/**
 * 工作区里的目录约定（相对 ~/Pod）：
 *   bots/<bot>/                 单聊时用的工作区
 *   tasks/<任务>/<子任务>/       不属于团队的任务过程文件
 *   teams/<团队>/tasks/<任务>/   团队任务的过程文件
 *   teams/<团队>/shared/、shared/  最终产物
 */

const UNSAFE = /[\\/:*?"<>|\u0000-\u001f]+/g

/** 目录名：去掉不安全字符，截到 24 个字，再加 id 的后 4 位避免重名。 */
export function folderName(title: string, id: string): string {
  const cleaned = [...title.replace(UNSAFE, ' ').replace(/\s+/g, '-').replace(/^[-.]+|[-.]+$/g, '')].slice(0, 24).join('')
  const suffix = id.slice(-4)
  return cleaned === '' ? suffix : `${cleaned}-${suffix}`
}

export function botFolder(bot: { readonly id: string; readonly name: string }): string {
  return `bots/${folderName(bot.name, bot.id)}`
}

export function teamFolder(team: { readonly id: string; readonly name: string }): string {
  return `teams/${folderName(team.name, team.id)}`
}

export function rootTaskFolder(task: { readonly id: string; readonly title: string }, team?: { readonly id: string; readonly name: string }): string {
  const base = team === undefined ? 'tasks' : `${teamFolder(team)}/tasks`
  return `${base}/${folderName(task.title, task.id)}`
}

export function childTaskFolder(rootFolder: string, task: { readonly id: string; readonly title: string }): string {
  return `${rootFolder}/${folderName(task.title, task.id)}`
}

export function sharedFolder(team?: { readonly id: string; readonly name: string }): string {
  return team === undefined ? 'shared' : `${teamFolder(team)}/shared`
}

export function roomFolder(room: { readonly id: string; readonly title: string }): string {
  return `rooms/${folderName(room.title, room.id)}`
}
