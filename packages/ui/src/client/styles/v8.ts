/**
 * V3 的界面：概览的版面、任务页（时间线、来由、文件）、
 * 任务卡上的问题、群顶的团队状态、侧栏的概览入口和在跑任务数、消息的去向。
 */
export const V8_CSS = `
.pod-side-overview { margin-bottom: 4px; }
.pod-side-running { flex: none; display: inline-flex; align-items: center; gap: 4px; height: 18px; padding: 0 6px; border-radius: 9px; font-size: 11px; color: var(--pod-info); background: color-mix(in srgb, var(--pod-info) 10%, transparent); }
.pod-side-running .pod-side-busy { width: 6px; height: 6px; }
.pod-avatar-dot-blocked { background: var(--pod-danger); }

.pod-overview-body { flex: 1; min-height: 0; overflow: auto; display: flex; flex-direction: column; gap: 20px; width: 100%; max-width: 900px; align-self: center; box-sizing: border-box; padding: 16px; }
.pod-overview-section { display: flex; flex-direction: column; gap: 8px; }

.pod-taskpage { container-type: inline-size; }
.pod-taskpage-empty { padding: 16px; }
.pod-taskpage-body { flex: 1; min-height: 0; overflow: auto; display: grid; grid-template-columns: minmax(0, 1fr) 280px; align-items: start; gap: 16px; padding: 16px; }
.pod-taskpage-main { display: flex; flex-direction: column; gap: 14px; min-width: 0; }
.pod-taskpage-side { position: sticky; top: 0; display: flex; flex-direction: column; gap: 10px; min-width: 0; }
.pod-taskpage-talk { display: flex; flex-direction: column; gap: 6px; padding: 10px 16px; border-top: 1px solid var(--pod-line); background: var(--dsw-alias-bg-layer-1, #fff); }
.pod-taskpage-brief summary, .pod-tl-report summary { cursor: pointer; font-size: 12px; font-weight: 600; color: var(--dsw-alias-label-tertiary); }
@container (max-width: 760px) {
  .pod-taskpage-body { grid-template-columns: minmax(0, 1fr); }
  .pod-taskpage-side { position: static; }
}
.pod-origin-quote { display: flex; flex-wrap: wrap; align-items: baseline; gap: 4px 8px; margin: 4px 0; padding: 6px 10px; border-left: 3px solid var(--pod-line); border-radius: 0 8px 8px 0; background: var(--pod-soft); font-size: 13px; }
.pod-origin-text { white-space: pre-wrap; overflow-wrap: anywhere; }
.pod-fold { margin-left: 6px; font-size: 12.5px; }
.pod-follows { list-style: none; margin: 0; padding: 0; display: flex; flex-direction: column; gap: 4px; font-size: 13px; }
.pod-timeline { list-style: none; margin: 0 0 0 4px; padding: 0; display: flex; flex-direction: column; border-left: 2px solid var(--pod-line); }
.pod-tl { position: relative; display: grid; grid-template-columns: 76px minmax(0, 1fr); gap: 8px; padding: 5px 0 5px 12px; font-size: 13px; }
.pod-tl::before { content: ''; position: absolute; left: -5px; top: 11px; width: 8px; height: 8px; border-radius: 50%; background: var(--pod-line); }
.pod-tl-message::before { background: var(--dsw-alias-label-tertiary); }
.pod-tl-report::before { background: var(--pod-info); }
.pod-tl-wait::before { background: var(--pod-warn); }
.pod-tl-time { padding-top: 1px; color: var(--dsw-alias-label-tertiary); font-size: 12px; font-variant-numeric: tabular-nums; }
.pod-tl-body { display: flex; flex-wrap: wrap; align-items: center; gap: 4px 8px; min-width: 0; }
.pod-tl-text { flex-basis: 100%; margin: 0; white-space: pre-wrap; color: var(--dsw-alias-label-secondary); overflow-wrap: anywhere; }
.pod-tl-who { font-weight: 600; }
.pod-tl-jump { font-size: 12px; }
.pod-tl-body .pod-tl-report { flex-basis: 100%; }

.pod-wait-detail { white-space: normal; }
.pod-task-question { display: flex; flex-direction: column; gap: 6px; padding: 8px 10px; border-radius: 10px; background: color-mix(in srgb, var(--pod-warn) 8%, transparent); font-size: 13px; }
.pod-task-question-text { flex: 1; min-width: 0; overflow-wrap: anywhere; }


.pod-msg-routes { position: absolute; top: 100%; right: 4px; z-index: 4; max-width: min(420px, 90%); margin-top: -2px; padding: 6px 10px; border: 1px solid var(--pod-line); border-radius: 10px; background: var(--dsw-alias-bg-layer-1, #fff); box-shadow: 0 2px 10px color-mix(in srgb, #000 10%, transparent); font-size: 12.5px; color: var(--dsw-alias-label-secondary); text-align: left; }
.pod-msg-routes ol { margin: 2px 0 0; padding-left: 18px; }
.pod-hit-task { margin: 2px 0 0 12px; font-size: 12px; }
.pod-msg-routes-title { font-size: 12px; font-weight: 600; color: var(--dsw-alias-label-tertiary); }
`
