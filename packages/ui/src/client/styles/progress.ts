/** 执行进度：回答进行中的那一块（计划、当前一步、思考、每一步、提示），和跑完以后回复下面的一行摘要。 */
export const PROGRESS_CSS = `
.pod-progress { display: flex; flex-direction: column; gap: 6px; margin-top: 4px; padding: 8px 10px; border: 1px solid var(--pod-line); border-radius: 10px; background: color-mix(in srgb, var(--pod-soft) 55%, transparent); font-size: 12.5px; color: var(--dsw-alias-label-secondary); max-width: 560px; }
.pod-progress-head { display: flex; align-items: center; gap: 8px; flex-wrap: wrap; min-width: 0; }
.pod-progress-now { min-width: 0; color: var(--dsw-alias-label-primary); font-weight: 500; overflow-wrap: anywhere; }
.pod-progress-meta { color: var(--dsw-alias-label-tertiary); font-variant-numeric: tabular-nums; }
.pod-progress-command { display: flex; align-items: baseline; gap: 8px; min-width: 0; padding-left: 20px; color: var(--dsw-alias-label-tertiary); font-size: 11.5px; }
.pod-progress-command code { min-width: 0; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; font-family: var(--ds-font-family-code, ui-monospace, monospace); color: var(--dsw-alias-label-secondary); }
.pod-progress-command span { flex: none; font-variant-numeric: tabular-nums; }
.pod-progress-thought { margin: 0; padding-left: 20px; color: var(--dsw-alias-label-tertiary); font-style: italic; overflow-wrap: anywhere; }
.pod-progress-toggle, .pod-run-toggle { appearance: none; display: inline-flex; align-items: center; gap: 4px; align-self: flex-start; padding: 2px 0; border: 0; background: none; font: inherit; font-size: 12px; color: var(--dsw-alias-label-tertiary); cursor: pointer; }
.pod-progress-toggle:hover, .pod-run-toggle:hover { color: var(--dsw-alias-label-primary); }
.pod-progress-toggle:focus-visible, .pod-run-toggle:focus-visible { outline: 2px solid var(--pod-info); outline-offset: 2px; border-radius: 4px; }
.pod-progress-health { display: flex; align-items: center; gap: 12px; flex-wrap: wrap; padding: 6px 8px; border-radius: 8px; background: color-mix(in srgb, var(--pod-warn) 12%, transparent); color: var(--pod-warn); }
.pod-progress-health > span { flex: 1 1 auto; min-width: 0; }
.pod-progress-health .pod-link { font-size: 12.5px; color: var(--pod-warn); font-weight: 500; }
.pod-link-danger, .pod-progress-health .pod-link-danger { color: var(--pod-danger); }

.pod-plan, .pod-steps { display: flex; flex-direction: column; gap: 3px; margin: 0; padding: 0; list-style: none; }
.pod-plan-item, .pod-step { display: flex; align-items: flex-start; gap: 8px; min-width: 0; line-height: 1.45; }
.pod-plan-mark, .pod-step-mark { flex: none; display: inline-grid; place-items: center; width: 12px; height: 18px; color: var(--dsw-alias-label-tertiary); }
.pod-plan-completed { color: var(--dsw-alias-label-tertiary); }
.pod-plan-completed .pod-plan-mark, .pod-step .pod-step-mark { color: var(--pod-ok); }
.pod-plan-in_progress { color: var(--dsw-alias-label-primary); font-weight: 500; }
.pod-plan-pending { color: var(--dsw-alias-label-tertiary); }
.pod-step-label { flex: 1 1 auto; min-width: 0; overflow-wrap: anywhere; }
.pod-step-time { flex: none; color: var(--dsw-alias-label-tertiary); font-variant-numeric: tabular-nums; }
.pod-step-failed .pod-step-mark, .pod-step-failed .pod-step-label { color: var(--pod-danger); }
.pod-steps-more { color: var(--dsw-alias-label-tertiary); }
.pod-spinner-small { width: 8px; height: 8px; border-width: 1.5px; }

.pod-run { margin-top: 2px; font-size: 12px; color: var(--dsw-alias-label-tertiary); }
.pod-run-body { display: flex; flex-direction: column; gap: 8px; margin-top: 4px; padding: 8px 10px; border-left: 2px solid var(--pod-line); max-width: 560px; }
`
