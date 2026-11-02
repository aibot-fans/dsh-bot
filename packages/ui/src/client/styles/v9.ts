/**
 * 触发器和自动来源：任务卡上的“到点叫醒”、任务页的触发器一栏、设置里的 X 监控规则。
 */
export const V9_CSS = `
.pod-task-trigger { font-size: 12.5px; color: var(--dsw-alias-label-secondary); overflow-wrap: anywhere; }
.pod-task-inline .pod-task-trigger { display: inline; }
.pod-triggers { list-style: none; margin: 0; padding: 0; display: flex; flex-direction: column; gap: 8px; }
.pod-trigger { display: flex; flex-direction: column; gap: 4px; padding: 8px 10px; border: 1px solid var(--dsw-alias-separator-primary, rgba(0,0,0,.08)); border-radius: 8px; font-size: 13px; }
.pod-trigger p { margin: 0; }
.pod-trigger-closed { opacity: .6; }
.pod-trigger-note { color: var(--dsw-alias-label-secondary); white-space: pre-wrap; overflow-wrap: anywhere; }
.pod-xrules textarea { min-height: 64px; }
`
