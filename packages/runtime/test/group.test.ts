import assert from 'node:assert/strict'
import { test } from 'node:test'
import type { Bot, RoomMessage } from 'pod-domain'
import { groupFrame, recentLines, resolveMembers, stripMentions } from '../src/chat/group.ts'

const bot = (id: string, name: string, role: Bot['role'] = 'member'): Bot => ({
  id,
  name,
  role,
  title: name,
  persona: '',
  personaSource: 'user',
  avatar: '',
  capabilities: [],
  card: { duties: '', strengths: '', notResponsible: '', askWho: '' },
  model: null,
  toolProfile: 'research',
  temporary: false,
  createdAt: 0,
  updatedAt: 0,
  archivedAt: null,
})

const lead = bot('bot_lead', '主管', 'lead')
const writer = bot('bot_writer', '写手')
const coder = bot('bot_coder', '程序员')

const message = (seq: number, author: string, body: string, kind: RoomMessage['kind'] = 'text'): RoomMessage => ({
  id: `msg_${seq}`,
  roomId: 'room_x',
  seq,
  author,
  kind,
  body,
  data: {},
  replyTo: null,
  pinned: false,
  sessionId: null,
  version: 0,
  createdAt: seq,
  updatedAt: seq,
  deletedAt: null,
})

test('按名字找群成员：去掉 @，“管理员”指主管，不含自己，群外的名字单列', () => {
  const { found, missing } = resolveMembers(['@程序员', '管理员', '写手', '程序员', '翻译官'], [lead, writer, coder], writer)
  assert.deepEqual(
    found.map((item) => item.name),
    ['程序员', '主管'],
  )
  assert.deepEqual(missing, ['翻译官'])
})

test('最近的群聊：只给它上次发言之后别人说的话，跳过正在转的那条和里程碑', () => {
  const names = new Map([['owner', '用户'], ['bot_writer', '写手'], ['bot_coder', '程序员']])
  const messages = [
    message(1, 'owner', '很早以前的话'),
    message(2, 'bot_writer', '写手上次说的'),
    message(3, 'owner', '之后你说的'),
    message(4, 'pod', '成员加入', 'milestone'),
    message(5, 'bot_coder', '程序员的回答'),
    message(6, 'owner', '正在转的这条'),
  ]
  const lines = recentLines(messages, writer, (author) => names.get(author) ?? author, 'msg_6')
  assert.deepEqual(lines, ['- 用户：之后你说的', '- 程序员：程序员的回答'])
})

test('转给群成员的消息：写明谁说的、有没有 @ 它，附成员', () => {
  const framed = groupFrame({ roomTitle: '量化小组', speaker: '写手', mentioned: true, body: '帮我看看这段代码', recent: [], members: ['主管', '写手', '程序员'], snapshot: undefined })
  assert.match(framed, /^\[写手在群聊「量化小组」里@了你\]\n帮我看看这段代码/)
  assert.match(framed, /\[群成员\] 主管、写手、程序员/)
  assert.doesNotMatch(framed, /最近的群聊/)
})

test('点名：去掉话里重复写的 @点名对象，提到的别人和更长的名字原样保留', () => {
  const writer2 = bot('bot_writer2', '写手二号')
  const members = [lead, writer, writer2, coder]
  assert.equal(stripMentions('@写手 用户找你，在群里应一声', [writer], members), '用户找你，在群里应一声')
  assert.equal(stripMentions('＠写手：帮忙看看 @写手', [writer], members), '帮忙看看')
  assert.equal(stripMentions('@写手二号 也看看', [writer], members), '@写手二号 也看看')
  assert.equal(stripMentions('@管理员 你来定', [lead], members), '你来定')
  assert.equal(stripMentions('写完给 @程序员 看', [writer], members), '写完给 @程序员 看')
  assert.equal(stripMentions('@写手', [writer], members), '')
})

test('转给群成员：别的 bot @ 了它时提醒直接回复，用户说的不加', () => {
  const base = { roomTitle: '333', mentioned: true, body: '用户找你', recent: [], members: ['主管', '写手'], snapshot: undefined }
  assert.match(groupFrame({ ...base, speaker: '主管', fromBot: true }), /不用再 @ 主管/)
  assert.doesNotMatch(groupFrame({ ...base, speaker: '用户' }), /不用再 @/)
})
