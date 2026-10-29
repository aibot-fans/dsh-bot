/** 浏览器视图：标签条、实时画面、工具栏、浮层和动作记录。 */
export const BROWSER_CSS = `
.pod-browser { gap: 12px; }
.pod-tabstrip { display: flex; gap: 6px; overflow-x: auto; padding-bottom: 2px; }
.pod-tabchip { appearance: none; font: inherit; display: flex; align-items: center; gap: 8px; min-width: 160px; max-width: 260px; padding: 6px 10px; border-radius: 10px; border: 1px solid var(--pod-line); background: var(--dsw-alias-bg-layer-2); color: inherit; cursor: pointer; text-align: left; }
.pod-tabchip-active { border-color: var(--dsw-alias-label-primary); background: var(--pod-soft); }
.pod-tabchip-text { display: flex; flex-direction: column; min-width: 0; flex: 1; font-size: 12px; }
.pod-tabchip-meta { color: var(--dsw-alias-label-tertiary); font-size: 11px; }
.pod-tabstrip-sep { flex: none; width: 1px; align-self: stretch; margin: 4px 2px; background: var(--pod-line); }
.pod-tabstrip-label { flex: none; align-self: center; font-size: 11px; color: var(--dsw-alias-label-tertiary); white-space: nowrap; }
.pod-tabchip-loading { width: 8px; height: 8px; border-radius: 50%; background: var(--pod-info); animation: pod-blink 1s infinite; }
@keyframes pod-blink { 50% { opacity: .2; } }
.pod-browser-main { display: grid; grid-template-columns: minmax(0, 1fr) 240px; gap: 14px; align-items: start; }
.pod-browser-bar { display: flex; align-items: center; gap: 6px; }
.pod-browser-bar .pod-input { flex: 1; min-width: 0; }
.pod-browser-bar .pod-browser-note { flex: 0 1 220px; }
.pod-live-wrap { position: relative; }
.pod-live { position: relative; border-radius: 10px; overflow: hidden; background: #1b1b1f; border: 1px solid var(--pod-line); }
.pod-live canvas { display: block; width: 100%; height: auto; aspect-ratio: 16 / 10; object-fit: contain; }
.pod-live-controlled { outline: 2px solid var(--pod-warn); }
.pod-live-controlled canvas { cursor: default; }
.pod-live-ime { position: absolute; left: 0; top: 0; width: 1px; height: 1px; opacity: 0; pointer-events: none; resize: none; border: 0; padding: 0; }
.pod-live-pointer { position: absolute; width: 22px; height: 22px; margin: -11px 0 0 -11px; border-radius: 50%; border: 3px solid var(--pod-warn); box-shadow: 0 0 0 4px rgba(255,170,0,.25); pointer-events: none; animation: pod-pulse 1.2s ease-out 2; }
@keyframes pod-pulse { from { transform: scale(.6); opacity: 1; } to { transform: scale(1.6); opacity: 0; } }
.pod-live-status { position: absolute; inset: 0; display: flex; align-items: center; justify-content: center; color: #bbb; font-size: 13px; }
.pod-live-overlay { position: absolute; inset: 0; display: flex; align-items: center; justify-content: center; background: rgba(0,0,0,.35); border-radius: 10px; }
.pod-live-card { display: flex; flex-direction: column; gap: 10px; width: min(420px, 90%); max-height: 80%; overflow: auto; padding: 16px; border-radius: 12px; background: var(--dsw-alias-bg-layer-1, #fff); box-shadow: 0 8px 30px rgba(0,0,0,.25); }
.pod-live-message { margin: 0; white-space: pre-wrap; word-break: break-word; }
.pod-live-options { list-style: none; margin: 0; padding: 0; display: flex; flex-direction: column; gap: 2px; }
.pod-live-options button { appearance: none; width: 100%; text-align: left; font: inherit; padding: 6px 8px; border: 0; border-radius: 6px; background: transparent; color: inherit; cursor: pointer; }
.pod-live-options button:hover, .pod-live-option-selected { background: var(--pod-soft) !important; }
.pod-browser-side { display: flex; flex-direction: column; gap: 6px; font-size: 13px; }
.pod-browser-actions { margin: 0; padding-left: 0; list-style: none; display: flex; flex-direction: column; gap: 4px; max-height: 420px; overflow-y: auto; }
.pod-approval-shot { max-width: 100%; border-radius: 8px; border: 1px solid var(--pod-line); }
.pod-approval-form { border-collapse: collapse; font-size: 12px; }
.pod-approval-form th { text-align: left; font-weight: 500; color: var(--dsw-alias-label-tertiary); padding: 2px 10px 2px 0; vertical-align: top; }
.pod-approval-form td { padding: 2px 0; word-break: break-all; }
.pod-site-rules { display: flex; flex-direction: column; gap: 6px; }
.pod-site-rule { display: grid; grid-template-columns: minmax(0, 1fr) 150px minmax(0, 1fr) auto; gap: 6px; align-items: center; }
@media (max-width: 900px) { .pod-browser-main { grid-template-columns: 1fr; } .pod-site-rule { grid-template-columns: 1fr 1fr; } }
`
