/**
 * 对话照 Comma：你的话是靠右的蓝气泡，bot 的话是靠左的灰气泡，一组的最后一个带尾巴，头像在左边那一列、和那组最后一个气泡底边对齐。
 * 时间居中，隔一段时间才写一次；回的话不在旁边时，气泡上面一小段引用；说到任务的气泡开头是任务记号。
 * 回答过程是对话最底下一个灰气泡，只有一行字（这一步在做什么、想的最后一句、输入中），字上一道光慢慢扫过；
 * 几个 bot 一起或交出去的任务在做时，气泡里是它们的小头像。
 */
export const V15_CSS = `
.pod-app { --pod-bot-bubble: color-mix(in srgb, var(--dsw-alias-label-primary) 6%, var(--dsw-alias-bg-layer-1, #fff)); --pod-owner-bubble: #205bff; --pod-owner-ink: #fff; }

.pod-stamp { align-self: center; margin: 14px 0 2px; font-size: 12px; line-height: 16px; color: var(--dsw-alias-label-tertiary); font-variant-numeric: tabular-nums; }

.pod-msg.pod-msg-owner, .pod-msg.pod-msg-bot { padding: 0; }
.pod-msg.pod-msg-first { padding-top: 6px; }
.pod-msg.pod-msg-last { padding-bottom: 8px; }
.pod-msg.pod-msg-bot { flex-direction: column; align-items: flex-start; gap: 0; padding-left: 38px; }
.pod-bubble-wrap { position: relative; display: flex; min-width: 0; max-width: 100%; }
.pod-bubble-wrap > .pod-msg-avatar { position: absolute; left: -38px; bottom: 0; }
.pod-bubble-wrap-card { width: 100%; max-width: var(--pod-card-max); }
.pod-bubble-wrap-card > :not(.pod-msg-avatar) { flex: 1; min-width: 0; }
.pod-msg-bot > .pod-msg-pinned { margin: 4px 0 0 8px; }

.pod-bubble { position: relative; }
.pod-bubble.pod-bubble-bot, .pod-bubble.pod-bubble-owner { padding: 9px 14px; border-radius: 20px; }
.pod-bubble-bot .pod-md, .pod-bubble-owner .pod-md { line-height: 1.6; }
.pod-bubble.pod-bubble-bot { display: flow-root; max-width: min(var(--pod-card-max), 100%); background: var(--pod-bot-bubble); color: var(--dsw-alias-label-primary); }
.pod-bubble.pod-bubble-owner { max-width: min(78%, 560px); background: var(--pod-owner-bubble); color: var(--pod-owner-ink); }
.pod-bubble-owner a { color: inherit; text-decoration: underline; }
.pod-bubble-owner code { background: color-mix(in srgb, var(--pod-owner-ink) 18%, transparent); color: inherit; }
.pod-bubble-owner .pod-muted-inline { color: color-mix(in srgb, var(--pod-owner-ink) 75%, transparent); }
.pod-tail-right { right: 8px; color: var(--pod-owner-bubble); }

.pod-bubble-chip { float: left; max-width: 100%; margin: 0 8px 0 0; }
/* 正文不是一段话开头（列表、标题、代码）时，记号单独占一行，免得压住列表的圆点。 */
.pod-bubble-bot:has(> .pod-md > :first-child:not(.pod-md-p)) > .pod-bubble-chip { float: none; display: flex; margin: 0 0 4px; }
.pod-bubble-chip .pod-task-chip-wrap { display: inline-flex; }
.pod-bubble-chip .pod-task-chip { gap: 5px; height: 23px; padding: 0 8px 0 5px; border: 0; border-radius: 7px; background: color-mix(in srgb, var(--dsw-alias-label-primary) 7%, var(--pod-bot-bubble)); font-size: 13px; }
.pod-bubble-chip .pod-task-chip:hover { background: color-mix(in srgb, var(--dsw-alias-label-primary) 12%, var(--pod-bot-bubble)); }
.pod-bubble-chip .pod-task-chip .pod-task-chip-title { font-weight: 500; }

.pod-quote-pill { position: relative; display: flex; align-items: center; max-width: min(420px, 100%); margin: 0 0 6px; padding: 4px 10px; border: 1px solid var(--pod-line); border-radius: 14px; font-size: 12.5px; line-height: 18px; color: var(--dsw-alias-label-tertiary); }
.pod-quote-who { position: absolute; left: -32px; top: 50%; display: inline-flex; transform: translateY(-50%); }
.pod-quote-text { min-width: 0; display: -webkit-box; -webkit-line-clamp: 2; -webkit-box-orient: vertical; overflow: hidden; }
.pod-you-avatar { display: inline-grid; place-items: center; width: 16px; height: 16px; border-radius: 50%; background: color-mix(in srgb, var(--pod-owner-bubble) 22%, var(--dsw-alias-bg-layer-1, #fff)); color: var(--pod-owner-bubble); font-size: 9px; font-weight: 700; }
.pod-quote-owner { max-width: min(62%, 480px); margin: 0 0 6px; padding: 5px 10px; border-left: 3px solid color-mix(in srgb, var(--pod-owner-bubble) 25%, transparent); border-radius: 4px; background: color-mix(in srgb, var(--pod-owner-bubble) 5%, var(--dsw-alias-bg-layer-1, #fff)); color: var(--dsw-alias-label-tertiary); font-size: 12.5px; line-height: 18px; display: -webkit-box; -webkit-line-clamp: 2; -webkit-box-orient: vertical; overflow: hidden; }

.pod-msg-gutter { flex: none; display: flex; align-items: flex-end; width: 28px; }
.pod-msg-label { margin: 0 0 3px 13px; font-size: 12px; line-height: 16px; font-weight: 600; }
.pod-tail { position: absolute; bottom: -7px; width: 16px; height: 10px; pointer-events: none; }
.pod-tail-left { left: 8px; transform: scaleX(-1); color: var(--pod-bot-bubble); }

.pod-activity { display: flex; align-items: flex-end; gap: 10px; padding: 10px 0 10px; }
.pod-activity .pod-msg-avatar { margin-bottom: 2px; }
.pod-activity-main { display: flex; flex-direction: column; align-items: flex-start; min-width: 0; max-width: 100%; }
.pod-activity-bubble { position: relative; display: inline-flex; align-items: center; gap: 8px; height: 40px; min-width: 0; max-width: min(520px, 100%); padding: 0 14px; border-radius: 20px; background: var(--pod-bot-bubble); color: var(--dsw-alias-label-tertiary); font-size: 14px; line-height: 20px; }
.pod-activity-text { min-width: 0; overflow: hidden; white-space: nowrap; text-overflow: ellipsis; background: linear-gradient(90deg, var(--dsw-alias-label-tertiary) 0%, var(--dsw-alias-label-tertiary) 40%, color-mix(in srgb, var(--dsw-alias-label-tertiary) 30%, var(--pod-bot-bubble)) 50%, var(--dsw-alias-label-tertiary) 60%, var(--dsw-alias-label-tertiary) 100%); background-size: 250% 100%; -webkit-background-clip: text; background-clip: text; color: transparent; animation: pod-shimmer 2.4s linear infinite; }
.pod-activity-warn { flex: 0 1 auto; min-width: 0; max-width: 50%; overflow: hidden; white-space: nowrap; text-overflow: ellipsis; color: var(--pod-warn); font-size: 12.5px; }
.pod-activity-warn::before { content: '· '; }
.pod-activity-dots { flex: none; display: inline-flex; align-items: center; gap: 3px; }
.pod-activity-dots i { width: 5px; height: 5px; border-radius: 50%; background: var(--dsw-alias-label-tertiary); opacity: .35; animation: pod-dot 1.2s ease-in-out infinite; }
.pod-activity-dots i:nth-child(2) { animation-delay: .2s; }
.pod-activity-dots i:nth-child(3) { animation-delay: .4s; }
.pod-activity-minis { flex: none; display: inline-flex; align-items: center; }
.pod-activity-minis > .pod-avatar + .pod-avatar { margin-left: -8px; box-shadow: 0 0 0 1.5px var(--pod-bot-bubble); }
@keyframes pod-shimmer { from { background-position: 100% 0; } to { background-position: 0 0; } }
@keyframes pod-dot { 0%, 80%, 100% { opacity: .35; } 40% { opacity: 1; } }
/* 任务的状态图标：做完是圈住的勾，没做成是圈住的叉，转圈是干活的蓝色；侧栏每一行右边用的是同一套，侧栏收起时贴在头像右上角。 */
.pod-state-done, .pod-state-ended, .pod-state-failed { border: 1.5px solid currentColor; }
.pod-state-failed { color: var(--pod-danger); }
.pod-state-icon .pod-icon { stroke-width: 3.2; }
.pod-spinner.pod-state-icon { border-color: color-mix(in srgb, var(--pod-working) 22%, transparent); border-top-color: var(--pod-working); }
.pod-side-collapsed .pod-side-status { position: absolute; top: 3px; right: 4px; margin: 0; box-shadow: 0 0 0 2px var(--pod-side-bg); }
.pod-side-collapsed .pod-side-status:not(.pod-state-attention) { background: var(--pod-side-bg); }

@media (prefers-reduced-motion: reduce) {
  .pod-activity-text { animation: none; background: none; color: var(--dsw-alias-label-tertiary); }
  .pod-activity-dots i { animation: none; opacity: .6; }
}
`
