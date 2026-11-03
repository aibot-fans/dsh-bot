/**
 * 任务对话：主对话里 Super-agent 那句话下面的任务卡片、转告下面的任务记号，点卡片和记号打开的右边小窗。
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
.pod-tcard-status-working .pod-spinner { border-top-color: var(--pod-working); }
.pod-tcard-status-working .pod-state-still { border-color: var(--pod-working); }
.pod-tcard-status-ended { color: var(--dsw-alias-label-tertiary); }
.pod-tcard-step { display: block; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; color: var(--pod-working); font-size: 12.5px; }
.pod-tcard-loading { padding: 6px 0; color: var(--dsw-alias-label-tertiary); font-size: 12.5px; }

.pod-task-chip { gap: 6px; padding: 3px 10px 3px 4px; }
.pod-task-chip:not(:has(> .pod-avatar, > .pod-group-mark)) { padding-left: 9px; }
.pod-task-chip > .pod-icon { flex: none; color: var(--dsw-alias-label-tertiary); }
.pod-task-chip .pod-task-chip-title { font-weight: 600; }
.pod-task-chip.pod-task-chip-attention { border-color: var(--pod-line); }

.pod-twin { background: var(--dsw-alias-bg-layer-1, #fff); }
.pod-twin-head { flex: none; display: flex; align-items: center; gap: 2px; min-height: 56px; padding: 8px 10px; border-bottom: 1px solid var(--pod-line); }
.pod-twin-tabs { flex: 1; min-width: 0; display: flex; align-items: center; gap: 4px; margin-right: 4px; overflow-x: auto; scrollbar-width: none; }
.pod-twin-tabs::-webkit-scrollbar { display: none; }
.pod-twin-tab { flex: none; display: inline-flex; align-items: center; max-width: 220px; border-radius: 10px; color: var(--dsw-alias-label-secondary); }
.pod-twin-tab:hover { background: var(--pod-soft); }
.pod-twin-tab-on, .pod-twin-tab-on:hover { background: color-mix(in srgb, var(--dsw-alias-label-primary) 7%, transparent); color: var(--dsw-alias-label-primary); }
.pod-twin-tab-main { appearance: none; display: inline-flex; align-items: center; gap: 7px; min-width: 0; padding: 7px 4px 7px 10px; border: 0; border-radius: 10px; background: none; color: inherit; font: inherit; font-size: 13.5px; cursor: pointer; }
.pod-twin-tab-on .pod-twin-tab-main { font-weight: 600; }
.pod-twin-tab-title { min-width: 0; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
.pod-twin-tab-close { appearance: none; flex: none; display: inline-grid; place-items: center; width: 22px; height: 22px; margin-right: 4px; padding: 0; border: 0; border-radius: 6px; background: none; color: var(--dsw-alias-label-tertiary); cursor: pointer; }
.pod-twin-tab-close:hover { background: color-mix(in srgb, var(--dsw-alias-label-primary) 8%, transparent); color: var(--dsw-alias-label-primary); }
.pod-twin-tab-main:focus-visible, .pod-twin-tab-close:focus-visible { outline: 2px solid var(--pod-info); outline-offset: -2px; }
.pod-twin-tab .pod-spinner { border-top-color: var(--pod-working); }
.pod-twin-tab .pod-state-still { border-color: var(--pod-working); }
.pod-twin-chat { flex: 1; }
.pod-twin .pod-timeline-inner { padding: 8px 16px 16px; }
.pod-twin .pod-composer { padding: 0 14px 14px; }
`
