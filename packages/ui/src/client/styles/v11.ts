/**
 * 任务就是群聊：主对话里开了群的任务只是一个进群的入口，任务群里的子任务一行一个，群顶一行这件事的状态，提到群的提示里群名是入口。
 */
export const V11_CSS = `
.pod-entry-wrap { display: flex; flex-direction: column; gap: 6px; }
.pod-entry, .pod-subtask-line { appearance: none; display: flex; align-items: center; gap: 8px; width: 100%; min-width: 0; border: 0; background: none; color: inherit; font: inherit; text-align: left; cursor: pointer; }
.pod-entry { padding: 7px 10px; border: 1px solid var(--pod-line); border-radius: 10px; font-size: 13px; }
.pod-entry:hover, .pod-subtask-line:hover { background: var(--pod-soft); }
.pod-subtask-line { padding: 3px 6px; border-radius: 8px; font-size: 13px; }
.pod-entry-dot { flex: none; width: 8px; height: 8px; border-radius: 50%; background: var(--pod-info); }
.pod-entry-working .pod-entry-dot { animation: pod-blink 1.6s ease-in-out infinite; }
.pod-entry-attention .pod-entry-dot { background: var(--pod-warn); }
.pod-entry-done .pod-entry-dot { background: var(--pod-ok); }
.pod-entry-ended .pod-entry-dot { background: var(--dsw-alias-label-tertiary); }
.pod-entry-attention.pod-entry { border-color: color-mix(in srgb, var(--pod-warn) 45%, var(--pod-line)); }
.pod-entry-title { flex: 0 1 auto; min-width: 0; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; color: var(--dsw-alias-label-primary); font-weight: 500; }
.pod-entry-status { flex: none; color: var(--dsw-alias-label-secondary); font-size: 12.5px; white-space: nowrap; }
.pod-entry-go { flex: none; display: inline-flex; align-items: center; gap: 2px; margin-left: auto; color: var(--dsw-alias-link, #4d6bfe); font-size: 12.5px; white-space: nowrap; }
.pod-subtask-line .pod-botname { flex: none; }
.pod-task-strip { display: flex; align-items: center; gap: 8px; min-height: 38px; padding: 4px 16px; border-bottom: 1px solid var(--pod-line); font-size: 12.5px; }
.pod-task-strip .pod-entry-status { color: var(--dsw-alias-label-primary); font-weight: 500; }
.pod-task-strip-actions { display: inline-flex; flex-wrap: wrap; gap: 4px; margin-left: auto; }
.pod-group-chip { appearance: none; display: inline-flex; align-items: center; gap: 6px; max-width: 100%; margin: 0 3px; padding: 2px 9px 2px 3px; border: 1px solid var(--pod-line); border-radius: 999px; background: var(--dsw-alias-bg-layer-1, transparent); color: inherit; font: inherit; font-size: 12.5px; vertical-align: middle; cursor: pointer; }
.pod-group-chip:hover { background: var(--pod-soft); }
.pod-group-chip-title { overflow: hidden; text-overflow: ellipsis; white-space: nowrap; font-weight: 600; color: var(--dsw-alias-label-primary); }
.pod-group-chip-go { display: inline-flex; align-items: center; gap: 2px; color: var(--dsw-alias-link, #4d6bfe); white-space: nowrap; }
.pod-msg-task-links { display: inline-flex; align-self: flex-start; gap: 12px; }
.pod-routed-link { display: block; margin-top: 2px; font-size: 12px; text-align: left; }
`
