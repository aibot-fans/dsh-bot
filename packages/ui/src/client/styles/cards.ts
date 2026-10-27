/** 卡片：任务卡、交付卡、等你卡、bot 卡片、看板、总览统计、设置页。 */
export const CARDS_CSS = `
.pod-task-card { border: 1px solid var(--pod-line); border-radius: 12px; padding: 12px 14px; display: flex; flex-direction: column; gap: 8px; background: var(--dsw-alias-bg-layer-2); max-width: 760px; }
.pod-task-card-loading { color: var(--dsw-alias-label-tertiary); font-size: 13px; }
.pod-task-card-done { border-color: color-mix(in srgb, var(--pod-ok) 35%, var(--pod-line)); }
.pod-task-head { display: flex; align-items: center; justify-content: space-between; gap: 10px; flex-wrap: wrap; }
.pod-task-title { display: flex; align-items: center; gap: 6px; min-width: 0; }
.pod-task-title strong { font-size: 14px; }
.pod-stages { display: flex; flex-wrap: wrap; gap: 4px; font-size: 12px; }
.pod-stage { color: var(--dsw-alias-label-tertiary); }
.pod-stage:not(:last-child)::after { content: '›'; margin-left: 4px; color: var(--dsw-alias-label-caption, var(--dsw-alias-label-tertiary)); }
.pod-stage-done { color: var(--dsw-alias-label-secondary); }
.pod-stage-current { color: var(--dsw-alias-label-primary); font-weight: 600; }
.pod-segments { display: flex; gap: 3px; flex-wrap: wrap; }
.pod-segment { flex: 1 1 60px; min-width: 40px; padding: 2px 6px; border-radius: 5px; font-size: 11px; line-height: 16px; white-space: nowrap; overflow: hidden; text-overflow: ellipsis; color: var(--dsw-alias-label-secondary); background: var(--pod-soft); }
.pod-segments-thin .pod-segment { min-width: 16px; height: 6px; padding: 0; flex: 1 1 16px; }
.pod-segment-done { background: color-mix(in srgb, var(--pod-ok) 55%, transparent); color: #fff; }
.pod-segment-running { background: color-mix(in srgb, var(--pod-info) 45%, transparent); color: #fff; }
.pod-segment-waiting { background: color-mix(in srgb, var(--pod-warn) 55%, transparent); color: #fff; }
.pod-segment-failed { background: color-mix(in srgb, var(--pod-danger) 55%, transparent); color: #fff; }
.pod-segment-cancelled { text-decoration: line-through; opacity: .55; }
.pod-acceptance { margin: 0; padding: 0; list-style: none; display: flex; flex-direction: column; gap: 2px; font-size: 13px; color: var(--dsw-alias-label-secondary); }
.pod-acceptance li { display: flex; gap: 6px; }
.pod-acceptance-done { color: var(--dsw-alias-label-tertiary); text-decoration: line-through; }
.pod-check { flex: none; width: 14px; height: 14px; margin-top: 3px; border-radius: 3px; border: 1px solid var(--pod-line); font-size: 10px; line-height: 12px; text-align: center; color: var(--pod-ok); }
.pod-activity { display: flex; align-items: center; gap: 8px; flex-wrap: wrap; font-size: 12.5px; color: var(--dsw-alias-label-secondary); }
.pod-activity-who { font-weight: 600; color: var(--dsw-alias-label-primary); }
.pod-task-note { font-size: 12.5px; color: var(--dsw-alias-label-secondary); }
.pod-task-wait { font-size: 12.5px; color: var(--pod-warn); }
.pod-task-actions { display: flex; flex-wrap: wrap; gap: 2px; margin-left: -8px; }
.pod-delivery { display: flex; flex-direction: column; gap: 8px; }
.pod-delivery-files { display: flex; flex-wrap: wrap; align-items: center; gap: 6px; }
.pod-file { font-family: var(--ds-font-family-code, ui-monospace, monospace); font-size: 12px; padding: 1px 6px; border-radius: 5px; background: var(--pod-soft); }
.pod-caveats ul { margin: 4px 0 0; padding-left: 18px; font-size: 13px; color: var(--dsw-alias-label-secondary); }
.pod-wait { border: 1px solid color-mix(in srgb, var(--pod-warn) 40%, var(--pod-line)); border-radius: 12px; padding: 12px 14px; display: flex; flex-direction: column; gap: 8px; background: color-mix(in srgb, var(--pod-warn) 4%, var(--dsw-alias-bg-layer-2)); max-width: 760px; }
.pod-wait-closed { border-color: var(--pod-line); background: transparent; color: var(--dsw-alias-label-tertiary); font-size: 13px; padding: 6px 12px; }
.pod-wait-head { display: flex; align-items: center; gap: 8px; flex-wrap: wrap; }
.pod-wait-detail { margin: 0; white-space: pre-wrap; font-size: 13px; color: var(--dsw-alias-label-secondary); }
.pod-wait-answer { display: flex; flex-direction: column; gap: 6px; }
.pod-wait-actions { display: flex; gap: 6px; }
.pod-grid { display: grid; grid-template-columns: repeat(auto-fill, minmax(260px, 1fr)); gap: 12px; }
.pod-card { display: flex; flex-direction: column; gap: 10px; padding: 14px; border-radius: 12px; border: 1px solid var(--pod-line); background: var(--dsw-alias-bg-layer-2); }
.pod-card-muted { opacity: .8; }
.pod-card-head { display: flex; align-items: center; gap: 10px; min-width: 0; }
.pod-card-title { display: flex; align-items: center; gap: 6px; min-width: 0; flex-wrap: wrap; }
.pod-card-title strong { font-size: 15px; }
.pod-persona { margin: 0; color: var(--dsw-alias-label-secondary); font-size: 13px; white-space: pre-wrap; display: -webkit-box; -webkit-line-clamp: 3; -webkit-box-orient: vertical; overflow: hidden; }
.pod-card-actions { display: flex; gap: 6px; margin-top: auto; flex-wrap: wrap; }
.pod-versions { margin: 0; padding: 0; list-style: none; display: flex; flex-direction: column; gap: 14px; }
.pod-versions li { display: flex; flex-direction: column; gap: 4px; padding-bottom: 12px; border-bottom: 1px solid var(--pod-line); }
.pod-board { display: grid; grid-template-columns: repeat(4, minmax(200px, 1fr)); gap: 12px; align-items: start; }
.pod-column { display: flex; flex-direction: column; gap: 8px; min-width: 0; }
.pod-tile { appearance: none; font: inherit; color: inherit; text-align: left; border: 1px solid var(--pod-line); border-radius: 10px; padding: 10px 12px; background: var(--dsw-alias-bg-layer-2); display: flex; flex-direction: column; gap: 6px; cursor: pointer; border-left-width: 3px; }
.pod-tile:hover { background: var(--pod-soft); }
.pod-tile-running { border-left-color: var(--pod-info); }
.pod-tile-waiting { border-left-color: var(--pod-warn); }
.pod-tile-done { border-left-color: var(--pod-ok); }
.pod-tile-failed { border-left-color: var(--pod-danger); }
.pod-tile-meta { display: flex; gap: 8px; flex-wrap: wrap; font-size: 12px; color: var(--dsw-alias-label-secondary); }
.pod-tile-time { font-size: 11px; color: var(--dsw-alias-label-tertiary); }
.pod-subtasks { margin: 0; padding: 0; list-style: none; display: flex; flex-direction: column; gap: 6px; }
.pod-subtask { border: 1px solid var(--pod-line); border-left-width: 3px; border-radius: 8px; padding: 8px 10px; display: flex; flex-direction: column; gap: 4px; font-size: 13px; }
.pod-plan-meta { margin-top: 8px; font-size: 12.5px; color: var(--dsw-alias-label-secondary); display: flex; flex-direction: column; gap: 2px; }
.pod-memories { margin: 0; padding: 0; list-style: none; display: flex; flex-direction: column; gap: 8px; }
.pod-memory { border: 1px solid var(--pod-line); border-radius: 10px; padding: 10px 12px; display: flex; flex-direction: column; gap: 6px; }
.pod-memory-pending { border-style: dashed; border-color: color-mix(in srgb, var(--pod-warn) 50%, var(--pod-line)); }
.pod-memory-content { font-size: 14px; }
.pod-hits { margin: 0; padding: 0; list-style: none; display: flex; flex-direction: column; gap: 6px; }
.pod-hit { appearance: none; font: inherit; color: inherit; text-align: left; width: 100%; border: 1px solid var(--pod-line); border-radius: 10px; padding: 10px 12px; background: var(--dsw-alias-bg-layer-2); display: flex; flex-direction: column; gap: 4px; cursor: pointer; }
.pod-hit:hover { background: var(--pod-soft); }
.pod-snippet { font-size: 13px; color: var(--dsw-alias-label-secondary); }
.pod-snippet mark { background: color-mix(in srgb, var(--pod-warn) 30%, transparent); color: inherit; border-radius: 3px; padding: 0 2px; }
.pod-handover { font-size: 12.5px; border: 1px solid var(--pod-line); border-radius: 8px; padding: 6px 8px; margin-bottom: 6px; }
.pod-handover summary { cursor: pointer; color: var(--dsw-alias-label-secondary); }
.pod-events { margin: 0; padding-left: 18px; display: flex; flex-direction: column; gap: 4px; font-size: 13px; color: var(--dsw-alias-label-secondary); }
.pod-events time { color: var(--dsw-alias-label-tertiary); margin-right: 6px; font-size: 12px; }
.pod-session-row { padding: 3px 0; font-size: 13px; }
.pod-stats { display: grid; grid-template-columns: repeat(auto-fit, minmax(160px, 1fr)); gap: 12px; }
.pod-stat { appearance: none; font: inherit; color: inherit; text-align: left; border: 1px solid var(--pod-line); border-radius: 12px; padding: 14px 16px; background: var(--dsw-alias-bg-layer-2); display: flex; flex-direction: column; gap: 2px; cursor: pointer; }
.pod-stat:disabled { cursor: default; }
.pod-stat-value { font-size: 22px; font-weight: 600; }
.pod-stat-label { font-size: 12px; color: var(--dsw-alias-label-tertiary); }
.pod-ask-lead { display: flex; gap: 8px; }
.pod-ask-lead .pod-input { font-size: 14px; padding: 9px 12px; border-radius: 10px; }
.pod-team-strip { display: flex; gap: 10px; flex-wrap: wrap; }
.pod-team-member { appearance: none; font: inherit; color: inherit; border: 1px solid var(--pod-line); border-radius: 12px; background: var(--dsw-alias-bg-layer-2); padding: 10px 12px; width: 120px; display: flex; flex-direction: column; align-items: center; gap: 4px; cursor: pointer; }
.pod-team-member:hover { background: var(--pod-soft); }
.pod-settings-section { border: 1px solid var(--pod-line); border-radius: 12px; padding: 14px 16px; display: flex; flex-direction: column; gap: 10px; }
.pod-settings-section h2 { margin: 0; font-size: 15px; }
.pod-settings-body { display: flex; flex-direction: column; }
.pod-settings-row { display: flex; align-items: center; justify-content: space-between; gap: 16px; padding: 9px 0; border-top: 1px solid var(--pod-line); font-size: 13px; }
.pod-settings-row:first-child { border-top: 0; }
.pod-settings-control { display: flex; align-items: center; gap: 8px; flex-wrap: wrap; justify-content: flex-end; }
.pod-settings-control .pod-input:not(.pod-input-number):not(.pod-input-time) { width: 280px; max-width: 100%; }
/* 设置行里的分段选项排成一行：左边说明长时让说明折行，别把选项挤成两行。 */
.pod-settings-control .pod-segmented { flex-wrap: nowrap; }
@media (max-width: 980px) { .pod-board { grid-template-columns: repeat(2, minmax(0, 1fr)); } }
@media (max-width: 600px) { .pod-board { grid-template-columns: minmax(0, 1fr); } .pod-settings-row { flex-direction: column; align-items: flex-start; } }
.pod-rated .pod-icon-button { color: var(--pod-ok); }
.pod-rated-down .pod-icon-button { color: var(--pod-danger); }
.pod-rate-reason { display: inline-flex; gap: 6px; align-items: center; }
.pod-rate-reason .pod-input { width: 220px; }
.pod-weekly { gap: 8px; }
.pod-evolution-list { list-style: none; margin: 0; padding: 0; display: flex; flex-direction: column; gap: 6px; }
.pod-evolution { display: flex; flex-direction: column; gap: 2px; padding: 6px 0; border-bottom: 1px solid var(--pod-line); }
.pod-evolution:last-child { border-bottom: 0; }
.pod-scorecard { display: grid; grid-template-columns: repeat(auto-fill, minmax(110px, 1fr)); gap: 6px; font-size: 12px; }
.pod-scorecard div { display: flex; flex-direction: column; }
.pod-scorecard strong { font-size: 15px; }
.pod-onboarding-backdrop { position: fixed; inset: 0; z-index: 50; display: flex; align-items: center; justify-content: center; background: rgba(0,0,0,.35); padding: 16px; }
.pod-onboarding { width: min(720px, 100%); max-height: 90vh; overflow-y: auto; display: flex; flex-direction: column; gap: 16px; padding: 24px; border-radius: 16px; background: var(--dsw-alias-bg-layer-1, #fff); box-shadow: 0 12px 40px rgba(0,0,0,.25); }
.pod-onboarding h2 { margin: 0; font-size: 18px; }
.pod-onboarding p { margin: 0; line-height: 1.7; }
.pod-onboarding-steps { display: flex; gap: 8px; list-style: none; margin: 0; padding: 0; font-size: 12px; color: var(--dsw-alias-label-tertiary); flex-wrap: wrap; }
.pod-onboarding-steps li { padding: 2px 10px; border-radius: 999px; border: 1px solid var(--pod-line); }
.pod-onboarding-current { color: var(--dsw-alias-label-primary); border-color: var(--dsw-alias-label-primary) !important; }
.pod-onboarding-done { opacity: .6; }
.pod-onboarding-actions { justify-content: flex-end; }
.pod-commands { list-style: none; margin: 0 0 6px; padding: 4px; display: flex; flex-direction: column; gap: 2px; border: 1px solid var(--pod-line); border-radius: 10px; background: var(--dsw-alias-bg-layer-2); }
.pod-commands button { appearance: none; width: 100%; display: flex; gap: 10px; align-items: baseline; padding: 5px 8px; border: 0; border-radius: 6px; background: transparent; color: inherit; font: inherit; cursor: pointer; text-align: left; }
.pod-commands button:hover { background: var(--pod-soft); }
.pod-attachment { appearance: none; align-self: flex-start; margin-top: 4px; padding: 4px 10px; border-radius: 8px; border: 1px solid var(--pod-line); background: var(--dsw-alias-bg-layer-2); color: inherit; font: inherit; font-size: 12px; cursor: pointer; }
button.pod-file { appearance: none; border: 0; cursor: pointer; color: inherit; }
button.pod-file:hover { text-decoration: underline; }
.pod-preview-image { max-width: 100%; border-radius: 8px; }
.pod-preview-text { white-space: pre-wrap; word-break: break-word; font-size: 12px; background: var(--dsw-alias-bg-layer-2); padding: 10px; border-radius: 8px; }
.pod-preview-frame { width: 100%; height: 70vh; border: 1px solid var(--pod-line); border-radius: 8px; background: #fff; }
.pod-preview-table { overflow-x: auto; }
.pod-preview-table table { border-collapse: collapse; font-size: 12px; }
.pod-preview-table th, .pod-preview-table td { border: 1px solid var(--pod-line); padding: 4px 8px; text-align: left; }
`
