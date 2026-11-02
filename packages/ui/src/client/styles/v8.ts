/**
 * V3 的界面：概览（要你处理的事、系统好不好、进行中的）、任务页（时间线、来由、文件）、
 * 任务卡上的问题、群顶的团队状态、侧栏的概览入口和在跑任务数、消息的去向。
 */
export const V8_CSS = `
.pod-side-overview { margin-bottom: 4px; }
.pod-side-running { flex: none; display: inline-flex; align-items: center; gap: 4px; height: 18px; padding: 0 6px; border-radius: 9px; font-size: 11px; color: var(--pod-info); background: color-mix(in srgb, var(--pod-info) 10%, transparent); }
.pod-side-running .pod-side-busy { width: 6px; height: 6px; }
.pod-avatar-dot-blocked { background: var(--pod-danger); }

.pod-overview-body { flex: 1; min-height: 0; overflow: auto; display: flex; flex-direction: column; gap: 20px; width: 100%; max-width: 900px; align-self: center; box-sizing: border-box; padding: 16px; }
.pod-overview-section { display: flex; flex-direction: column; gap: 8px; }
.pod-attention-list, .pod-active-list { list-style: none; margin: 0; padding: 0; display: flex; flex-direction: column; gap: 8px; }
.pod-attention { display: flex; flex-direction: column; gap: 8px; padding: 10px 12px; border: 1px solid var(--pod-line); border-radius: 12px; }
.pod-attention-row { display: flex; align-items: flex-start; gap: 10px; min-width: 0; }
.pod-attention-main { flex: 1; min-width: 0; display: flex; flex-direction: column; gap: 2px; }
.pod-attention-title { max-width: 100%; color: inherit; font-size: 14px; }
.pod-attention-meta { display: flex; align-items: center; flex-wrap: wrap; gap: 8px; font-size: 12.5px; }
.pod-attention-summary { overflow: hidden; display: -webkit-box; -webkit-line-clamp: 2; -webkit-box-orient: vertical; color: var(--dsw-alias-label-secondary); font-size: 13px; overflow-wrap: anywhere; }
.pod-attention-actions { flex: none; display: flex; flex-wrap: wrap; justify-content: flex-end; gap: 6px; }
.pod-active-row { appearance: none; display: flex; align-items: center; gap: 10px; width: 100%; padding: 8px 12px; border: 1px solid var(--pod-line); border-radius: 10px; background: none; color: inherit; font: inherit; font-size: 13px; text-align: left; cursor: pointer; }
.pod-active-row:hover { background: var(--pod-soft); }
.pod-active-main { flex: 1; min-width: 0; display: flex; flex-direction: column; }
.pod-health-line { display: flex; align-items: center; flex-wrap: wrap; gap: 10px; padding: 8px 12px; border: 1px solid var(--pod-line); border-radius: 10px; font-size: 13px; }
.pod-overview .pod-problem { padding: 8px 12px; border-radius: 10px; color: var(--pod-danger); background: color-mix(in srgb, var(--pod-danger) 8%, transparent); }

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
.pod-task-inline-progress { max-width: 100%; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; font-size: 12.5px; }

.pod-teambar { display: flex; gap: 6px; overflow-x: auto; padding: 6px 16px; border-bottom: 1px solid var(--pod-line); scrollbar-width: none; }
.pod-teambar::-webkit-scrollbar { display: none; }
.pod-teambar-member { appearance: none; flex: none; display: inline-flex; align-items: center; gap: 6px; max-width: 280px; padding: 3px 10px 3px 4px; border: 1px solid var(--pod-line); border-radius: 999px; background: none; color: inherit; font: inherit; font-size: 12.5px; cursor: pointer; }
button.pod-teambar-member:hover { background: var(--pod-soft); }
.pod-teambar-idle { cursor: default; opacity: .75; }
.pod-teambar-waiting { border-color: color-mix(in srgb, var(--pod-warn) 50%, var(--pod-line)); }
.pod-teambar-blocked { border-color: color-mix(in srgb, var(--pod-danger) 50%, var(--pod-line)); }
.pod-teambar-text { display: flex; gap: 4px; min-width: 0; white-space: nowrap; }
.pod-teambar-name { font-weight: 600; }
.pod-teambar-state { overflow: hidden; text-overflow: ellipsis; color: var(--dsw-alias-label-secondary); }

.pod-msg-routes { position: absolute; top: 100%; right: 4px; z-index: 4; max-width: min(420px, 90%); margin-top: -2px; padding: 6px 10px; border: 1px solid var(--pod-line); border-radius: 10px; background: var(--dsw-alias-bg-layer-1, #fff); box-shadow: 0 2px 10px color-mix(in srgb, #000 10%, transparent); font-size: 12.5px; color: var(--dsw-alias-label-secondary); text-align: left; }
.pod-msg-routes ol { margin: 2px 0 0; padding-left: 18px; }
.pod-hit-task { margin: 2px 0 0 12px; font-size: 12px; }
.pod-msg-routes-title { font-size: 12px; font-weight: 600; color: var(--dsw-alias-label-tertiary); }
`
