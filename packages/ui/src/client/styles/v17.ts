/**
 * 合两家之长：暂停着的任务画两道竖线（不转圈）；句子里的任务链接是行内的小一号记号。
 */
export const V17_CSS = `
.pod-state-paused { width: 10px; height: 10px; margin: 0 2px; border-radius: 0; box-sizing: border-box; border-left: 3px solid var(--dsw-alias-label-tertiary); border-right: 3px solid var(--dsw-alias-label-tertiary); }
.pod-task-chip-wrap.pod-task-chip-inline { display: inline-flex; flex-direction: row; max-width: 100%; margin: 0 2px; vertical-align: bottom; }
.pod-task-chip-inline .pod-task-chip { gap: 4px; padding: 0 8px 0 6px; font-size: inherit; line-height: 1.6; }
.pod-task-chip-inline .pod-task-chip .pod-task-chip-title { font-weight: 500; }
.pod-state-attention { background: var(--pod-warn); }
.pod-task-fact-attention { color: var(--pod-warn); }
.pod-task-fact-failed { color: var(--pod-danger); }
`
