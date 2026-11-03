/**
 * 全屏的任务对话：顶上的任务名和下面一行小字、详情收起后留着的任务状态，输入框上面那行「正在处理」，
 * 右边「详情」最上面的任务和进展；侧栏里在干活的 bot 和群聊旁的蓝点。
 */
export const V14_CSS = `
.pod-side-busy { background: var(--pod-working); box-shadow: 0 0 0 3px color-mix(in srgb, var(--pod-working) 18%, transparent); }

.pod-convo-titles { display: flex; flex-direction: column; align-items: flex-start; min-width: 0; line-height: 1.3; text-align: left; }
.pod-convo-titles strong { max-width: 100%; font-size: 15px; }
.pod-convo-sub { max-width: 100%; color: var(--dsw-alias-label-tertiary); font-size: 12.5px; font-weight: 400; }
.pod-convo-group .pod-convo-titles .pod-convo-name { max-width: 100%; padding-top: 1px; padding-bottom: 1px; }
.pod-convo-group .pod-convo-titles .pod-convo-sub { padding-left: 6px; }

.pod-task-pill { appearance: none; flex: none; display: inline-flex; align-items: center; gap: 6px; height: 30px; padding: 0 12px 0 10px; border: 0; border-radius: 999px; background: var(--pod-soft); color: var(--dsw-alias-label-secondary); font: inherit; font-size: 13px; font-weight: 600; white-space: nowrap; cursor: pointer; }
.pod-task-pill:focus-visible { outline: 2px solid var(--pod-info); outline-offset: 1px; }
.pod-task-pill-working { background: color-mix(in srgb, var(--pod-working) 10%, transparent); color: var(--pod-working); }
.pod-task-pill-attention { background: color-mix(in srgb, var(--pod-danger) 10%, transparent); color: var(--pod-danger); }
.pod-task-pill-done { background: color-mix(in srgb, var(--pod-ok) 12%, transparent); color: var(--pod-ok); }
.pod-task-pill:hover { filter: brightness(0.96); }

.pod-task-fact-working { color: var(--pod-working); }
.pod-task-fact-attention { color: var(--pod-danger); }
.pod-task-fact-done { color: var(--pod-ok); }
.pod-task-fact-ended { color: var(--dsw-alias-label-tertiary); }
.pod-task-fact-working .pod-spinner, .pod-task-pill-working .pod-spinner, .pod-task-working .pod-spinner { border-top-color: var(--pod-working); }
.pod-task-fact-working .pod-state-still, .pod-task-pill-working .pod-state-still { border-color: var(--pod-working); }
.pod-task-facts .pod-kv:has(.pod-task-source) { align-items: start; }
.pod-task-source { display: flex; flex-direction: column; align-items: flex-start; gap: 6px; min-width: 0; }
.pod-task-quote { appearance: none; display: -webkit-box; -webkit-line-clamp: 3; -webkit-box-orient: vertical; overflow: hidden; max-width: 100%; padding: 0 0 0 10px; border: 0; border-left: 2px solid var(--pod-line); background: none; color: var(--dsw-alias-label-secondary); font: inherit; font-size: 13px; line-height: 1.55; text-align: left; word-break: break-word; cursor: pointer; }
.pod-task-quote:hover { color: var(--dsw-alias-label-primary); }
.pod-task-quote:focus-visible { outline: 2px solid var(--pod-info); outline-offset: 2px; }

.pod-task-progress { display: flex; flex-direction: column; gap: 8px; margin: 0; padding: 6px 14px 12px; list-style: none; }
.pod-task-progress li { display: grid; grid-template-columns: 6px minmax(0, 1fr) auto; align-items: baseline; gap: 10px; font-size: 13.5px; line-height: 1.5; }
.pod-task-progress li::before { content: ''; width: 6px; height: 6px; border-radius: 50%; background: color-mix(in srgb, var(--dsw-alias-label-primary) 25%, transparent); transform: translateY(-2px); }
.pod-task-progress-text { min-width: 0; word-break: break-word; }
.pod-task-progress-time { color: var(--dsw-alias-label-tertiary); font-size: 12px; font-variant-numeric: tabular-nums; }
.pod-task-progress-empty { margin: 0; padding: 4px 14px 12px; color: var(--dsw-alias-label-tertiary); font-size: 13px; }

.pod-task-working { flex: none; display: flex; align-items: center; gap: 8px; width: 100%; max-width: calc(var(--pod-chat-max) + 48px); margin: 0 auto; padding: 2px 32px 8px; color: var(--dsw-alias-label-secondary); font-size: 13.5px; }
.pod-task-working strong { flex: none; font-size: 13.5px; }
.pod-task-working-text { min-width: 0; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
.pod-twin .pod-task-working { padding: 2px 22px 8px; }
@media (max-width: 760px) { .pod-task-working { padding: 2px 16px 6px; } }
`
