/**
 * 任务对话：主对话里 Super-agent 那句话下面的任务卡片、转告下面的任务记号，主对话右边的任务栏（照 Comma 主页）。
 */
export const V13_CSS = `
.pod-app { --pod-working: var(--dsw-alias-link, #4d6bfe); }
.pod-msg-card-task { position: relative; padding-top: 2px; padding-bottom: 4px; }
.pod-msg-card-task:hover .pod-msg-actions, .pod-msg-card-task:focus-within .pod-msg-actions { opacity: 1; pointer-events: auto; }
.pod-msg-card.pod-msg-card-task > * { width: auto; }
.pod-msg-card.pod-msg-card-task > .pod-tcard-wrap { width: min(100%, 440px); }
.pod-tcard-wrap { display: flex; flex-direction: column; align-items: stretch; gap: 4px; }
.pod-tcard { appearance: none; display: flex; flex-direction: column; gap: 5px; width: 100%; padding: 9px 12px; border: 1px solid var(--pod-line); border-radius: 12px; background: var(--dsw-alias-bg-layer-1, #fff); color: var(--dsw-alias-label-primary); font: inherit; text-align: left; cursor: pointer; }
.pod-tcard:hover { background: var(--pod-soft); }
.pod-tcard:focus-visible { outline: 2px solid var(--pod-info); outline-offset: 1px; }
.pod-tcard-attention { border-color: color-mix(in srgb, var(--pod-danger) 40%, var(--pod-line)); }
.pod-tcard-row { display: flex; align-items: center; gap: 8px; min-width: 0; }
.pod-tcard-row > .pod-icon { flex: none; color: var(--dsw-alias-label-tertiary); }
.pod-tcard-title { flex: 1; min-width: 0; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; font-size: 14px; font-weight: 600; }
.pod-tcard-status { flex: none; display: inline-flex; align-items: center; gap: 5px; font-size: 12.5px; white-space: nowrap; }
.pod-tcard-status-done { color: var(--pod-ok); }
.pod-tcard-status-attention { color: var(--pod-danger); }
.pod-tcard-status-working { color: var(--pod-working); }
.pod-tcard-status-working .pod-spinner, .pod-rail-card .pod-spinner { border-top-color: var(--pod-working); }
.pod-tcard-status-working .pod-state-still, .pod-rail-card .pod-state-still { border-color: var(--pod-working); }
.pod-tcard-status-ended { color: var(--dsw-alias-label-tertiary); }
.pod-tcard-step { display: block; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; color: var(--pod-working); font-size: 12.5px; }
.pod-tcard-loading { padding: 6px 0; color: var(--dsw-alias-label-tertiary); font-size: 12.5px; }

.pod-msg-chips { display: flex; flex-wrap: wrap; gap: 6px; margin-top: 6px; }
.pod-task-chip { gap: 6px; padding: 3px 10px 3px 4px; }
.pod-task-chip:not(:has(> .pod-avatar, > .pod-group-mark)) { padding-left: 9px; }
.pod-task-chip > .pod-icon { flex: none; color: var(--dsw-alias-label-tertiary); }
.pod-task-chip .pod-task-chip-title { font-weight: 600; }
.pod-task-chip.pod-task-chip-attention { border-color: var(--pod-line); }

.pod-home { display: flex; min-width: 0; min-height: 0; }
.pod-home > .pod-convo { flex: 1; }
.pod-rail { flex: none; display: flex; flex-direction: column; width: 288px; min-height: 0; border-left: 1px solid var(--pod-line); background: var(--dsw-alias-bg-layer-1, #fff); }
.pod-rail-head { flex: none; display: flex; align-items: center; gap: 6px; min-height: 56px; padding: 10px 10px 10px 18px; }
.pod-rail-head strong { font-size: 15px; }
.pod-rail-body { flex: 1; min-height: 0; overflow-y: auto; display: flex; flex-direction: column; gap: 10px; padding: 4px 12px 12px; }
.pod-rail-card { appearance: none; flex: none; display: flex; flex-direction: column; align-items: flex-start; gap: 7px; width: 100%; padding: 12px 14px; border: 1px solid var(--pod-line); border-radius: 12px; background: var(--dsw-alias-bg-layer-1, #fff); color: var(--dsw-alias-label-primary); font: inherit; text-align: left; cursor: pointer; }
.pod-rail-card:hover { background: var(--pod-soft); }
.pod-rail-card:focus-visible { outline: 2px solid var(--pod-info); outline-offset: 1px; }
.pod-rail-card-head { display: flex; align-items: center; gap: 8px; width: 100%; min-width: 0; }
.pod-rail-card-title { flex: 1; min-width: 0; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; font-size: 14px; }
.pod-rail-people { display: flex; flex-wrap: wrap; gap: 6px; max-width: 100%; }
.pod-rail-person { display: inline-flex; align-items: center; gap: 5px; max-width: 100%; padding: 2px 9px 2px 3px; border: 1px solid var(--pod-line); border-radius: 999px; font-size: 12.5px; }
.pod-rail-line { display: -webkit-box; -webkit-line-clamp: 2; -webkit-box-orient: vertical; overflow: hidden; font-size: 13px; line-height: 1.5; word-break: break-word; }
.pod-rail-line-ask { color: var(--pod-danger); }
.pod-rail-line-work { color: var(--pod-working); }
.pod-rail-line-quiet { color: var(--dsw-alias-label-secondary); }
.pod-rail-time { color: var(--dsw-alias-label-tertiary); font-size: 12px; font-variant-numeric: tabular-nums; }
.pod-rail-empty { margin: 8px 6px; color: var(--dsw-alias-label-tertiary); font-size: 13px; }
.pod-rail-foot { flex: none; display: flex; align-items: center; justify-content: center; gap: 6px; min-height: 52px; padding: 8px 12px; border-top: 1px solid var(--pod-line); }
.pod-rail-tab { appearance: none; padding: 5px 14px; border: 0; border-radius: 999px; background: var(--pod-soft); color: var(--dsw-alias-label-primary); font: inherit; font-size: 13px; font-weight: 600; cursor: default; }
.pod-rail-dot { appearance: none; display: inline-grid; place-items: center; width: 22px; height: 22px; padding: 0; border: 0; border-radius: 50%; background: none; cursor: pointer; }
.pod-rail-dot::before { content: ''; width: 8px; height: 8px; border-radius: 50%; background: color-mix(in srgb, var(--dsw-alias-label-primary) 22%, transparent); }
.pod-rail-dot:hover::before { background: color-mix(in srgb, var(--dsw-alias-label-primary) 45%, transparent); }
.pod-rail-dot:focus-visible, .pod-rail-tab:focus-visible { outline: 2px solid var(--pod-info); outline-offset: 2px; }
.pod-rail-collapsed { width: 52px; align-items: center; padding-top: 11px; }
.pod-rail-unfold { appearance: none; position: relative; display: inline-grid; place-items: center; width: 34px; height: 34px; padding: 0; border: 0; border-radius: 10px; background: none; color: var(--dsw-alias-label-secondary); cursor: pointer; }
.pod-rail-unfold:hover { background: var(--pod-soft); color: var(--dsw-alias-label-primary); }
.pod-rail-unfold:focus-visible { outline: 2px solid var(--pod-info); outline-offset: 1px; }
.pod-rail-count { position: absolute; top: -3px; right: -5px; min-width: 16px; height: 16px; padding: 0 4px; border-radius: 8px; background: var(--pod-info); color: #fff; font-size: 10.5px; line-height: 16px; text-align: center; }
.pod-rail-count-ask { background: var(--pod-danger); }
@media (max-width: 1360px) {
  .pod-layout-panel .pod-rail { display: none; }
}
@media (max-width: 960px) {
  .pod-rail { display: none; }
}
`
