import assert from 'node:assert/strict'
import { test } from 'node:test'
import type { Bot } from '../src/bots.ts'
import { quickPersona } from '../src/persona.ts'
import { TEMPORARY_TOPIC, autoGroupName, isTemporaryRoom, type RoomSummary } from '../src/rooms.ts'
import {
  EMPTY_SIDEBAR,
  addSidebarFolder,
  archiveSidebarItem,
  botKey,
  moveSidebarItem,
  parseSidebarPrefs,
  removeSidebarFolder,
  reorderSidebar,
  roomKey,
  SIDEBAR_BOTS,
  SIDEBAR_PINNED,
  sidebarSections,
  toggleSidebarFolder,
} from '../src/sidebar.ts'

function bot(id: string, name: string, createdAt: number, role: 'lead' | 'member' = 'member'): Bot {
  return {
    id,
    name,
    role,
    title: '',
    persona: '…',
    personaSource: 'user',
    avatar: '',
    capabilities: [],
    card: { duties: '', strengths: '', notResponsible: '', askWho: '' },
    model: null,
    toolProfile: 'exec',
    temporary: false,
    createdAt,
    updatedAt: createdAt,
    archivedAt: null,
  }
}

function room(id: string, patch: Partial<RoomSummary>): RoomSummary {
  return {
    id,
    kind: 'direct',
    title: id,
    botId: null,
    teamId: null,
    taskId: null,
    topic: '',
    pinned: false,
    incognito: false,
    notifyLevel: 'all',
    lastSeq: 0,
    readSeq: 0,
    lastMessageAt: null,
    createdAt: 1,
    archivedAt: null,
    unread: 0,
    preview: '',
    busy: false,
    waits: 0,
    memberIds: [],
    subject: '',
    ...patch,
  }
}

test('侧栏整理：丢掉坏数据，分组名截到 12 个字，指向不存在分组的放置去掉', () => {
  const prefs = parseSidebarPrefs({
    folders: [{ id: 'f1', name: '量化研究和回测的那些事儿们啊' }, { id: 'f1', name: '重复' }, { id: 'bad id', name: '坏' }, { id: 'f2', name: '  ' }],
    placement: { 'bot:a': 'f1', 'bot:b': 'f9', 'nope:c': 'f1' },
    archived: ['room:r1', 'room:r1', 'x:y'],
    collapsed: ['f1', 'f9'],
    extra: true,
  })
  assert.deepEqual(prefs.folders, [{ id: 'f1', name: '量化研究和回测的那些事儿' }])
  assert.deepEqual(prefs.placement, { 'bot:a': 'f1' })
  assert.deepEqual(prefs.archived, ['room:r1'])
  assert.deepEqual(prefs.collapsed, ['f1'])
  assert.deepEqual(parseSidebarPrefs('坏的'), EMPTY_SIDEBAR)
})

test('侧栏分区：置顶、分组、Bot、群聊、归档各归各的，按最近使用排；临时对话不算 bot 的单聊', () => {
  const bots = [bot('lead', '主管', 1, 'lead'), bot('a', '写手', 2), bot('b', '程序员', 3), bot('c', '研究员', 4)]
  const rooms = [
    room('r-lead', { botId: 'lead', pinned: true, lastMessageAt: 10 }),
    room('r-a', { botId: 'a', lastMessageAt: 50 }),
    room('r-temp', { botId: 'b', incognito: true, topic: TEMPORARY_TOPIC, lastMessageAt: 99 }),
    room('g1', { kind: 'task', title: '博客小组', lastMessageAt: 30 }),
    room('g2', { kind: 'task', title: '量化小组', lastMessageAt: 40 }),
  ]
  const prefs = { ...EMPTY_SIDEBAR, folders: [{ id: 'f1', name: '量化' }], placement: { [roomKey('g2')]: 'f1' }, archived: [botKey('c')] }
  const sections = sidebarSections(bots, rooms, prefs)
  assert.deepEqual(sections.pinned.map((item) => item.key), ['bot:lead'])
  assert.deepEqual(sections.folders[0]?.items.map((item) => item.key), ['room:g2'])
  assert.deepEqual(sections.bots.map((item) => item.key), ['bot:a', 'bot:b'])
  assert.equal(sections.bots[1]?.room, undefined)
  assert.deepEqual(sections.groups.map((item) => item.key), ['room:g1'])
  assert.deepEqual(sections.archived.map((item) => item.key), ['bot:c'])
})

test('分组的改法：建、移进移出、收起、删分组不删东西，归档和取消归档', () => {
  const created = addSidebarFolder(EMPTY_SIDEBAR, 'f1', ' 量化 ')
  assert.deepEqual(created.folders, [{ id: 'f1', name: '量化' }])
  assert.equal(addSidebarFolder(created, 'f2', '   '), created)
  const moved = moveSidebarItem(archiveSidebarItem(created, 'bot:a', true), 'bot:a', 'f1')
  assert.deepEqual(moved.placement, { 'bot:a': 'f1' })
  assert.deepEqual(moved.archived, [])
  assert.deepEqual(moveSidebarItem(moved, 'bot:a', null).placement, {})
  assert.deepEqual(toggleSidebarFolder(moved, 'f1').collapsed, ['f1'])
  const removed = removeSidebarFolder(toggleSidebarFolder(moved, 'f1'), 'f1')
  assert.deepEqual(removed, { folders: [], placement: {}, archived: [], collapsed: [], order: {} })
  assert.deepEqual(archiveSidebarItem(EMPTY_SIDEBAR, 'room:g1', true).archived, ['room:g1'])
})

test('自动群名、临时对话、只给一句职责时的人设', () => {
  assert.equal(autoGroupName(['写手', '程序员']), '写手、程序员')
  assert.equal(autoGroupName(['因子研究员', '数据工程师', '回测工程师', '策略评审']), '因子研究员等4位')
  assert.equal(autoGroupName([]), '新群聊')
  assert.ok(isTemporaryRoom({ kind: 'direct', incognito: true, topic: TEMPORARY_TOPIC }))
  assert.ok(!isTemporaryRoom({ kind: 'direct', incognito: true, topic: '' }))
  const persona = quickPersona('写手', '写和改博客文章。')
  assert.match(persona, /你是「写手」/)
  assert.match(persona, /你负责：写和改博客文章。\n/)
})

test('主管总在置顶的第一个，不能归档、不进分组；拖过的栏按拖的顺序，新来的排前面', () => {
  const bots = [bot('lead', '主管', 1, 'lead'), bot('a', '写手', 2), bot('b', '程序员', 3), bot('c', '研究员', 4)]
  const rooms = [
    room('r-lead', { botId: 'lead', pinned: false, lastMessageAt: 1 }),
    room('r-a', { botId: 'a', pinned: true, lastMessageAt: 50 }),
    room('r-b', { botId: 'b', lastMessageAt: 20 }),
    room('r-c', { botId: 'c', lastMessageAt: 30 }),
  ]
  const messy = { ...EMPTY_SIDEBAR, archived: [botKey('lead')], folders: [{ id: 'f1', name: '杂' }], placement: { [botKey('lead')]: 'f1' } }
  const sections = sidebarSections(bots, rooms, messy)
  assert.deepEqual(sections.pinned.map((item) => item.key), ['bot:lead', 'bot:a'])
  assert.deepEqual(sections.archived, [])
  assert.deepEqual(sections.folders[0]?.items, [])
  // 研究员（最近）在前；把程序员拖到研究员前面以后按拖的顺序。
  assert.deepEqual(sections.bots.map((item) => item.key), ['bot:c', 'bot:b'])
  const dragged = reorderSidebar(EMPTY_SIDEBAR, SIDEBAR_BOTS, ['bot:c', 'bot:b'], 'bot:b', 'bot:c')
  assert.deepEqual(dragged.order[SIDEBAR_BOTS], ['bot:b', 'bot:c'])
  assert.deepEqual(sidebarSections(bots, rooms, dragged).bots.map((item) => item.key), ['bot:b', 'bot:c'])
  // 新建的 bot 没排过，排在最前面；拖到置顶栏以后，从别的栏的顺序里去掉。
  const withNew = sidebarSections([...bots, bot('d', '翻译', 5)], rooms, dragged)
  assert.deepEqual(withNew.bots.map((item) => item.key), ['bot:d', 'bot:b', 'bot:c'])
  const pinned = reorderSidebar(dragged, SIDEBAR_PINNED, ['bot:a'], 'bot:b', null)
  assert.deepEqual(pinned.order[SIDEBAR_PINNED], ['bot:a', 'bot:b'])
  assert.deepEqual(pinned.order[SIDEBAR_BOTS], ['bot:c'])
  assert.deepEqual(parseSidebarPrefs({ order: { bots: ['bot:a', 'x'], f9: ['bot:a'], pinned: 'bad' } }).order, { bots: ['bot:a'], pinned: [] })
})
