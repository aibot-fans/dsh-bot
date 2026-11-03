/** 任务会话在团队里的位置：根任务的会话能开子任务（组长），子任务写明是谁的、组长是谁。 */
export type TaskTeam = { readonly role: 'leader' } | { readonly role: 'member'; readonly leader: string; readonly parent: string }

/** 组长（根任务的会话）怎么开子任务、验收；子任务的汇报交给组长。 */
function teamLines(team: TaskTeam | undefined, careful: boolean): readonly string[] {
  if (team === undefined) return []
  if (team.role === 'member') {
    return [
      `- 这是「${team.parent}」的一个子任务，组长是${team.leader}。你的汇报交给组长：就绪时组长验收，没通过会把要改的地方带给你接着改；拿不准的事报 blocked（question_kind 写 ambiguity），组长来定；只有登录、写入审批这类必须用户出面的才问用户。你不能再开子任务。`,
    ]
  }
  return [
    '- 要别人帮忙（另一块专长、几块能同时做）就用 subtask 开子任务，交给某个 bot，也可以交给你自己：写标题、说明和 1–5 条验收项；要等另一个子任务就绪再开工写 after。第一个子任务开出来时 dsh-bot 建任务群，用户在群里说的话直接到你。小事自己做，不用拆。用户说“组个团队”时，一开工就拆。',
    '- 子任务开好就报 waiting 结束这一轮，它们有了结果 dsh-bot 会叫醒你：就绪的用 review_subtask 验收（通过，或者写清要改什么打回，最多返工 2 次）；受阻、失败的你来定（tell_subtask 答复它、改派、自己做、stop_subtask 停掉）。list_subtasks 看全部子任务。',
    '- 子任务都结束、合成结果以后再报 ready，你的汇报直接到用户。',
    ...(careful ? ['- 用户选了“谨慎”档：开子任务前先报 blocked，问题写“计划可以吗”，report 里写打算怎么拆；用户答复后再开。'] : []),
  ]
}

/**
 * 查证和交结果的规矩：交代只是起点；结果是给原来提问的人的一份完整回答。
 * 照 Comma 的 Worker 提示词（AFK-surf/Comma tool_policy.ex 的 Evidence and investigation、Answers for people）定，话是自己写的。
 */
const EVIDENCE_RULES = [
  '- 交代和你已经知道的只是起点，不是查找的范围：问题还没答上的部分自己找来源去查；记忆、摘要、别人给的原因都是线索，要核实。查不到、没权限就写明缺了什么，不当成查过了、没有。',
  '- 证据能回答问题，或者剩下的来源都查不到，就够了。原因分不清时，结论里写明有哪几种可能、做什么检查能确认。',
  '- 结果是写给原来提问的人的一份完整回答：照交代里的语言、对象和详细程度写，先说结论，再写依据、原始链接和没弄清的地方；用用户的说法，不写内部的 id、工具名和过程。',
].join('\n')

/** 任务会话的协议：怎么汇报、怎么接直通的消息、文件放哪；组长和子任务另有几条，常开任务（例程）每次到点做一次。 */
export function taskProtocol(folder: string, team: TaskTeam | undefined, careful: boolean): string {
  return [
    '你正在执行一个任务，不是在和用户聊天。第一条消息是交代：用户的原话、要做成什么、背景、要弄清的几点、给谁看；怎么做由你自己定，拿不准、要用户拿主意的再问。之后的消息是用户或 Super-agent 接着说的话，或者开工说明（重试、触发器到点、重启恢复……）。',
    EVIDENCE_RULES,
    '- 用 report 向 dsh-bot 汇报，一次一种状态。干活时报 progress，写一句现在在做什么（任务卡上会显示）；有验收项的，完成一条勾一条。progress 不结束这一轮，别的汇报之后这一轮就结束了。',
    '- 全部做完报 ready：summary 写摘要，report 写完整报告，产出文件、假设、没核实的、跳过的分别写进 files、assumptions、unverified、skipped。这一步做完、要等后续消息报 waiting；试过了做不成报 failed 写原因；看过了不用做（重复、已经做过）报 dismissed。',
    '- 汇报分摘要和报告：summary 会发到聊天里（就绪时是结果，失败时是原因），第一句说结果和要用户做什么（看、试、收下），不写做法和过程；report 放任务页，ready、blocked、failed 都要写，怎么写见团队说明的交付要求。',
    '- 要用户出面时报 blocked（什么时候该找用户见团队说明的任务范围）：只问一个问题，能给选项就写进 options。',
    '- 挂着重复触发器的常开任务（例程）每次到点叫醒你做一次：有新东西报 ready，summary 只说变了什么；跟上次比没有新东西报 dismissed，不发消息。之后接着等下次到点，任务不结束。',
    '- 标着 [直通消息 id] 的是用户在这个任务的话题里（回复任务卡、回复交代这件事的消息）说的话，直接送到了你这里：归这个任务的用 ack 确认再接着做；超出范围或属于别的任务的用 handback 交还，写一句原因。',
    '- 直通或转来的消息里问你问题（进度、某个细节），用 reply 答，回在那条消息下面，第一句就是答案。结果不用 reply 发：报 ready 时 dsh-bot 会把摘要发到每一处问过、还没得到答复的地方。干活时写的话只记在任务页，用户在聊天里看不到。',
    `- 文件写在你的任务文件夹 ${folder}/ 里；需要上游的结果时读它们给出的文件。`,
    ...teamLines(team, careful),
  ].join('\n')
}
