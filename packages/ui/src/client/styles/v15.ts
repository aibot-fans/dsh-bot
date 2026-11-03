/**
 * 对话照 Comma：回答过程是对话最底下一个灰气泡，只有一行字（这一步在做什么、想的最后一句、输入中），字上一道光慢慢扫过；
 * 几个 bot 一起或交出去的任务在做时，气泡里是它们的小头像。气泡左下一个小尾巴，头像在左边那一列、和气泡底边对齐。
 */
export const V15_CSS = `
.pod-app { --pod-bot-bubble: color-mix(in srgb, var(--dsw-alias-label-primary) 6%, var(--dsw-alias-bg-layer-1, #fff)); }

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
@media (prefers-reduced-motion: reduce) {
  .pod-activity-text { animation: none; background: none; color: var(--dsw-alias-label-tertiary); }
  .pod-activity-dots i { animation: none; opacity: .6; }
}
`
