/**
 * 记忆整理用的两步测试剧本：回放一份记录交发现，整合一个范围交新的一版。
 * 按固定的关键词出结果，顺带放几条该被核对拦下的（原话不在记录里、没有出处、和出处对不上），好验证代码那一道。
 */

const TOPICS = ['周报', '服务器', '日志', '部署', '监控', '报告', '账号']

function topicOf(text) {
  return TOPICS.find((topic) => text.includes(topic)) ?? '其他约定'
}

/** 一句话里带关键词的那一小句，原样截出来当原话。 */
function clause(text, words) {
  const parts = text.split(/(?<=[。！？!?；;])/)
  const hit = parts.find((part) => words.some((word) => part.includes(word))) ?? text
  return hit.trim().slice(0, 78)
}

/** 第一步：回放。用户说“以后、记住、不要、都用”的记成偏好；说“改成、不对”又对得上已有记忆的记成纠正。 */
export function dreamReplay(prompt) {
  const known = [...prompt.matchAll(/^\((k\d+)\) (.*)$/gm)].map((match) => ({ alias: match[1], text: match[2] }))
  const lines = [...prompt.matchAll(/^\[(m\d+)\] ([^：]+)：(.*)$/gm)].map((match) => ({ at: match[1], name: match[2], text: match[3] }))
  const findings = []
  for (const line of lines) {
    const owner = line.name === '用户'
    if (owner && line.text.includes('测试编造')) {
      findings.push({ kind: 'new', about: 'owner', type: 'preference', content: '用户喜欢在周末开会', quote: '这句话在记录里根本没有出现过', at: line.at })
      continue
    }
    if (owner && /密码|password/i.test(line.text)) {
      findings.push({ kind: 'new', about: 'owner', type: 'fact', content: `用户给了密码：${line.text.slice(0, 40)}`, quote: line.text.slice(0, 30), at: line.at })
      continue
    }
    if (owner && /改成|不对|别再/.test(line.text)) {
      const target = known.find((item) => topicOf(item.text) === topicOf(line.text) && topicOf(line.text) !== '其他约定')
      const quote = clause(line.text, ['改成', '不对', '别再'])
      findings.push({ kind: target === undefined ? 'new' : 'contradict', about: 'owner', type: 'preference', content: `用户改了说法：${quote}`, quote, at: line.at, ...(target === undefined ? {} : { target: target.alias }) })
      continue
    }
    if (owner && /以后|记住|不要|都用|一律/.test(line.text)) {
      const quote = clause(line.text, ['以后', '记住', '不要', '都用', '一律'])
      findings.push({ kind: 'new', about: line.text.includes('这个群') ? 'group' : 'owner', type: line.text.includes('这个群') ? 'convention' : 'preference', content: `用户要求：${quote}`, quote, at: line.at })
      continue
    }
    // 任务会话里的：跑过的命令记成这个 bot 的做法，出错的工具结果记成踩过的坑，汇报里的结论记成这件事的决定。
    if (line.name.includes(' 调用 ') && !/调用 (report|complete_task|reply|remember|recall)$/.test(line.name)) {
      const quote = line.text.slice(0, 70)
      findings.push({ kind: 'new', about: 'bot', type: 'experience', content: `用过的做法：${quote}`, quote, at: line.at })
      continue
    }
    if (line.name.includes('工具结果（出错）')) {
      const quote = line.text.slice(0, 70)
      findings.push({ kind: 'new', about: 'bot', type: 'experience', content: `踩过的坑：${quote}`, quote, at: line.at })
      continue
    }
    if (line.name.includes('的汇报（ready）')) {
      const quote = line.text.slice(0, 60)
      findings.push({ kind: 'new', about: 'group', type: 'decision', content: `这件事的结论：${quote}`, quote, at: line.at })
      continue
    }
    if (!owner && line.text.includes('（推断）')) {
      const quote = line.text.slice(0, 60)
      findings.push({ kind: 'new', about: 'owner', type: 'fact', content: `用户可能${quote.replace('（推断）', '').slice(0, 40)}`, quote, at: line.at })
    }
    if (!owner && /请记住|以后你要/.test(line.text)) {
      findings.push({ kind: 'new', about: 'owner', type: 'convention', content: `以后要照这句办：${line.text.slice(0, 40)}`, quote: line.text.slice(0, 40), at: line.at })
    }
  }
  return findings
}

/** 分拣 Super-agent 名下的条目：提到用户的归关于用户，提到某个群名的归那个群，说“交给谁”的归组织目录，别的不动。 */
export function dreamSort(prompt) {
  const groups = [...prompt.matchAll(/^\((g\d+)\) 「([^」]+)」/gm)].map((match) => ({ alias: match[1], title: match[2] }))
  const entries = [...prompt.matchAll(/^\((e\d+)\) (.*)$/gm)].map((match) => ({ alias: match[1], text: match[2] }))
  return entries.map((entry) => {
    const group = groups.find((item) => entry.text.includes(item.title))
    const to = group !== undefined ? group.alias : entry.text.includes('交给') ? 'org' : entry.text.includes('用户') ? 'owner' : 'self'
    return { id: entry.alias, to }
  })
}

function section(prompt, title) {
  const start = prompt.indexOf(`[${title}]`)
  if (start < 0) return ''
  const end = prompt.indexOf('\n\n[', start + 1)
  return prompt.slice(start, end < 0 ? undefined : end)
}

/** 第二步：整合。按话题分页，一字不差的并成一句；带“（旧）”的被同话题的“（新）”替掉，带“一次性”的归档。 */
export function dreamConsolidate(prompt) {
  const notes = [...section(prompt, '现有的笔记').matchAll(/^\((n\d+)\) 《([^》]+)》/gm)].map((match) => ({ alias: match[1], title: match[2] }))
  const entries = [...section(prompt, '还没整理的条目').matchAll(/^\((e\d+)\) ([^：]*)：(.*)$/gm)].map((match) => ({ alias: match[1], tags: match[2], text: match[3] }))
  const findings = [...section(prompt, '今晚的发现').matchAll(/^\((f\d+)\) (.*?」，\d\d-\d\d)：(.*)$/gm)].map((match) => ({ alias: match[1], tags: match[2], text: match[3] }))
  const replaced = []
  const dropped = []
  const questions = []
  const gone = new Set()
  for (const entry of entries) {
    if (entry.text.includes('一次性')) {
      dropped.push({ id: entry.alias, why: '一次性的细节' })
      gone.add(entry.alias)
    }
    if (entry.text.includes('（旧）')) {
      const by = entries.find((other) => other.text.includes('（新）') && topicOf(other.text) === topicOf(entry.text))
      if (by !== undefined) {
        replaced.push({ old: entry.alias, by: by.alias, why: '后来改了说法' })
        gone.add(entry.alias)
      }
    }
  }
  const left = entries.find((entry) => entry.text.includes('冲突A'))
  const right = entries.find((entry) => entry.text.includes('冲突B'))
  if (left !== undefined && right !== undefined) {
    questions.push({ text: '这两条说法不一样，分不清哪条对。', about: [left.alias, right.alias] })
    gone.add(left.alias)
    gone.add(right.alias)
  }
  const pages = new Map()
  for (const item of [...entries.filter((entry) => !gone.has(entry.alias)), ...findings.filter((finding) => !finding.tags.startsWith('证实'))]) {
    const topic = topicOf(item.text)
    const page = pages.get(topic) ?? []
    const plain = (text) => text.replace(/\s+/g, '').replace(/[，。,.]$/, '')
    const same = page.find((line) => plain(line.text) === plain(item.text) || plain(line.text).startsWith(plain(item.text)) || plain(item.text).startsWith(plain(line.text)))
    if (same === undefined) page.push({ text: item.text, from: [item.alias] })
    else {
      same.from.push(item.alias)
      if (item.text.length > same.text.length && !item.tags.includes('原样')) same.text = item.text
    }
    pages.set(topic, page)
  }
  const result = [...pages.entries()].map(([topic, lines]) => {
    const known = notes.find((note) => note.title.includes(topic))
    return { id: known?.alias ?? 'new', title: topic === '其他约定' ? topic : `${topic}怎么办`, description: `和${topic}有关的约定和做法`, lines, remove: [] }
  })
  if (prompt.includes('测试没出处') && result[0] !== undefined) {
    result[0].lines.push({ text: '这一句没有写出处', from: [] })
    result[0].lines.push({ text: '完全对不上的一句话 zzz-9999', from: [entries[0]?.alias ?? 'e1'] })
  }
  const points = result.flatMap((page) => page.lines.filter((line) => line.from.length > 0).slice(0, 1)).slice(0, 3).map((line) => ({ text: line.text.slice(0, 58), from: line.from }))
  return { notes: result, replaced, dropped, points, questions }
}
