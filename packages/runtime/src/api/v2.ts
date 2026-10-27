import { randomBytes } from 'node:crypto'
import { mkdir, readFile, writeFile } from 'node:fs/promises'
import { extname, join } from 'node:path'
import { botFolder, fail, isAvatarImage, ok, readId, readString, roomFolder, t } from 'pod-domain'
import { taskFoldersFor } from 'pod-store'
import { listLibrary } from '../chat/library.ts'
import type { FetchRoute } from '../dsh.ts'
import type { PodRuntime } from '../pod.ts'
import { USAGE_RANGES, usageReport, type UsageRange } from '../usage/report.ts'
import { get, post, POD_API_PREFIX, type RouteSpec } from './router.ts'

const AVATAR_TYPES: Readonly<Record<string, string>> = { png: 'image/png', jpg: 'image/jpeg', jpeg: 'image/jpeg', webp: 'image/webp', gif: 'image/gif' }
const AVATAR_MAX_BYTES = 2 * 1024 * 1024

function avatarFolder(pod: PodRuntime): string {
  return join(pod.dataRoot, 'avatars')
}

/** V2 界面用的接口：用量、资料库、群聊（拉群、加减成员）、停止回复、开新对话、清空记录、头像。 */
export function v2Routes(pod: PodRuntime): readonly RouteSpec[] {
  return [
    get('/usage', (query) => {
      const raw = readString(query, 'range')
      const range: UsageRange = (USAGE_RANGES as readonly string[]).includes(raw) ? (raw as UsageRange) : 'today'
      const roomId = readId(query, 'roomId')
      const botId = readId(query, 'botId')
      return ok(usageReport(pod.db, range, pod.now(), pod.settings.get().timezone, { ...(roomId === undefined ? {} : { roomId }), ...(botId === undefined ? {} : { botId }) }))
    }),
    get('/library', async (query) => {
      const botId = readId(query, 'botId')
      const roomId = readId(query, 'roomId')
      if (botId !== undefined) {
        const bot = pod.bots.get(botId)
        if (bot === undefined) return fail('not-found', t('找不到这个 bot'))
        return ok(await listLibrary(pod.workspaceRoot, [botFolder(bot), ...taskFoldersFor(pod.db, { botId })]))
      }
      const room = roomId === undefined ? undefined : pod.rooms.get(roomId)
      if (room === undefined) return fail('not-found', t('要指定 bot 或对话'))
      const task = room.taskId === null ? undefined : pod.tasks.get(room.taskId)
      const bot = room.botId === null ? undefined : pod.bots.get(room.botId)
      const base = room.kind === 'direct' ? (bot === undefined ? [] : [botFolder(bot)]) : [task?.folder ?? roomFolder(room)]
      return ok(await listLibrary(pod.workspaceRoot, [...base, ...taskFoldersFor(pod.db, { roomId: room.id })]))
    }),
    post('/room/create-group', (body) => pod.rooms.createGroupFromPage(body)),
    post('/room/member/add', (body) => pod.rooms.addMemberFromPage(body)),
    post('/room/member/remove', (body) => pod.rooms.removeMemberFromPage(body)),
    post('/room/stop', (body) => pod.rooms.stop(body)),
    post('/room/new-conversation', (body) => pod.rooms.newConversation(body)),
    post('/room/delete-conversation', (body) => pod.rooms.deleteConversation(body)),
    post('/room/clear', (body) => pod.rooms.clear(body)),
    post('/bot/avatar', async (body) => {
      const id = readId(body, 'id')
      const bot = id === undefined ? undefined : pod.bots.get(id)
      if (id === undefined || bot === undefined || bot.archivedAt !== null) return fail('not-found', t('找不到这个 bot'))
      const extension = extname(readString(body, 'name')).toLowerCase().slice(1)
      if (AVATAR_TYPES[extension] === undefined) return fail('invalid-input', t('头像只支持 png、jpg、webp、gif 图片'))
      const data = Buffer.from(readString(body, 'data'), 'base64')
      if (data.byteLength === 0) return fail('invalid-input', t('图片是空的'))
      if (data.byteLength > AVATAR_MAX_BYTES) return fail('invalid-input', t('头像图片最大 2 MB'))
      const file = `${Date.now().toString(36)}-${randomBytes(4).toString('hex')}.${extension}`
      await mkdir(avatarFolder(pod), { recursive: true })
      await writeFile(join(avatarFolder(pod), file), data)
      return pod.bots.update({ id, patch: { avatar: `img:${file}` } })
    }),
  ]
}

/** 头像图片：只读 Pod 数据目录 avatars/ 下、名字合规的文件。 */
export function avatarRoute(pod: PodRuntime): FetchRoute {
  const missing = (): Response => new Response('not found', { status: 404, headers: { 'content-type': 'text/plain; charset=utf-8' } })
  return {
    path: `${POD_API_PREFIX}/avatar`,
    methods: ['GET'],
    requestBody: 'buffered',
    fetch: async (request) => {
      const file = new URL(request.url).searchParams.get('file') ?? ''
      if (!isAvatarImage(`img:${file}`)) return missing()
      const data = await readFile(join(avatarFolder(pod), file)).catch(() => undefined)
      if (data === undefined) return missing()
      const type = AVATAR_TYPES[extname(file).slice(1)] ?? 'application/octet-stream'
      return new Response(new Uint8Array(data), { status: 200, headers: { 'content-type': type, 'cache-control': 'private, max-age=86400', 'x-content-type-options': 'nosniff' } })
    },
  }
}
