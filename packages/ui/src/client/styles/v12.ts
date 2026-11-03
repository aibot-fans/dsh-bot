/**
 * V4：对话里只有对话。任务在对话里只是一行记号（状态图标加标题），任务群里派活是组长的一句话。
 */
export const V12_CSS = `
.pod-msg-card-chip { position: relative; padding-top: 2px; padding-bottom: 2px; }
.pod-msg-card-chip:hover .pod-msg-actions, .pod-msg-card-chip:focus-within .pod-msg-actions { opacity: 1; pointer-events: auto; }
.pod-msg-card.pod-msg-card-chip > * { width: auto; }
.pod-task-chip-wrap { display: inline-flex; flex-direction: column; align-items: flex-start; gap: 4px; max-width: 100%; }
.pod-task-chip { appearance: none; display: inline-flex; align-items: center; gap: 7px; max-width: 100%; padding: 4px 12px 4px 9px; border: 1px solid var(--pod-line); border-radius: 999px; background: var(--dsw-alias-bg-layer-1, transparent); color: var(--dsw-alias-label-primary); font: inherit; font-size: 13px; text-align: left; cursor: pointer; }
.pod-task-chip:hover { background: var(--pod-soft); }
.pod-task-chip-title { min-width: 0; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; font-weight: 500; }
.pod-task-chip-attention { border-color: color-mix(in srgb, var(--pod-danger) 45%, var(--pod-line)); }
.pod-task-chip-ended .pod-task-chip-title { color: var(--dsw-alias-label-secondary); }
.pod-task-chip-loading { color: var(--dsw-alias-label-tertiary); font-size: 12.5px; }
.pod-state-icon { flex: none; display: inline-flex; align-items: center; justify-content: center; width: 14px; height: 14px; border-radius: 50%; }
.pod-state-attention { width: 9px; height: 9px; margin: 0 2.5px; background: var(--pod-danger); }
.pod-state-done { color: var(--pod-ok); }
.pod-state-ended { color: var(--dsw-alias-label-tertiary); }
.pod-state-still { width: 10px; height: 10px; margin: 0 2px; border: 1.5px solid var(--pod-info); }
.pod-spinner.pod-state-icon { width: 10px; height: 10px; margin: 0 2px; }
.pod-subtask-brief { margin-top: 2px; color: var(--dsw-alias-label-secondary); font-size: 13px; white-space: pre-wrap; }
`
