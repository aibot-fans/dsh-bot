/** 浏览器视图：工具栏、实时画面、浮层和动作记录，以及审批卡和站点规则。 */
export const BROWSER_CSS = `
/* 浏览器面板：上面一条工具栏（右侧面板里折成两行：切换网页和按钮一行，前进后退、网址和接管一行），下面全是画面。 */
.pod-browser-head { flex: none; display: flex; flex-wrap: wrap; align-items: center; gap: 6px 8px; padding: 8px 10px; border-bottom: 1px solid var(--pod-line); }
.pod-browser-head-main { flex: 1 1 0; display: flex; align-items: center; gap: 4px; min-width: 0; }
.pod-browser-head-tools { order: 2; flex: none; display: flex; align-items: center; gap: 2px; }
.pod-browser-head-nav { order: 3; flex: 1 1 100%; display: flex; align-items: center; gap: 2px; min-width: 0; }
.pod-browser-head .pod-round { width: 30px; height: 30px; box-shadow: none; }
.pod-browser-head .pod-panel-back { margin-right: 0; }
.pod-browser-back { flex: none; padding: 4px 8px 4px 4px; }
.pod-browser-title { display: inline-flex; align-items: center; gap: 8px; min-width: 0; padding-left: 4px; }
.pod-browser-switch { appearance: none; display: inline-flex; align-items: center; gap: 6px; min-width: 0; max-width: 100%; height: 32px; padding: 0 8px 0 6px; border: 0; border-radius: 8px; background: transparent; color: var(--dsw-alias-label-primary); font: inherit; font-size: 13.5px; font-weight: 600; cursor: pointer; }
.pod-browser-switch:hover, .pod-browser-switch[aria-expanded="true"] { background: var(--pod-soft); }
.pod-browser-switch:focus-visible { outline: 2px solid var(--pod-info); outline-offset: 1px; }
.pod-browser-switch > svg:last-child { flex: none; color: var(--dsw-alias-label-tertiary); }
.pod-browser-count { flex: none; min-width: 18px; padding: 0 5px; border-radius: 999px; background: var(--pod-soft); color: var(--dsw-alias-label-secondary); font-size: 11px; font-weight: 500; line-height: 18px; text-align: center; }
.pod-browser-options { display: flex; flex-direction: column; gap: 1px; max-height: min(420px, 60vh); overflow-y: auto; }
.pod-browser-option-text { flex: 1; display: flex; flex-direction: column; min-width: 0; }
.pod-browser-option-meta { font-size: 11.5px; color: var(--dsw-alias-label-tertiary); }
.pod-browser-loading { width: 8px; height: 8px; border-radius: 50%; background: var(--pod-info); animation: pod-blink 1s infinite; }
@keyframes pod-blink { 50% { opacity: .2; } }
.pod-browser-url { flex: 1; min-width: 80px; height: 30px; margin-left: 4px; padding: 0 12px; border-color: transparent; border-radius: 999px; background: var(--pod-soft); }
.pod-browser-url:read-only { color: var(--dsw-alias-label-secondary); }
.pod-browser-url:focus-visible { background: var(--dsw-alias-bg-layer-1, #fff); }
.pod-browser-state { flex: none; display: flex; align-items: center; gap: 6px; margin-left: 6px; }
.pod-browser-state > span { display: inline-flex; cursor: default; }
.pod-menu .pod-browser-handback { width: 260px; }
.pod-browser-body { flex: 1; min-height: 0; display: flex; flex-direction: column; }
.pod-browser-notes { flex: none; display: flex; flex-direction: column; gap: 8px; padding: 10px 12px 0; }
/* 画面区：按网页的实际比例放到最大（宽和高都不超出），左右居中；右侧面板里靠上，全屏时上下也居中。 */
.pod-browser-stage { position: relative; flex: 1; min-height: 120px; container-type: size; display: flex; justify-content: center; align-items: flex-start; padding: 10px; }
.pod-browser-stage .pod-live { width: fit-content; }
.pod-browser-stage .pod-live canvas { width: min(100cqw - 2px, (100cqh - 2px) * var(--pod-live-ratio, 1.6)); }
/* 窗口内全屏：盖住整个窗口（模态框、菜单还在上面），工具栏收成一行。 */
.pod-panel.pod-panel-full { position: fixed; inset: 0; z-index: 55; width: auto; max-width: none; border-left: 0; box-shadow: none; padding-top: var(--dsh-frame-top-clearance, 0px); }
.pod-panel-full .pod-browser-head-main { flex: 0 1 320px; }
.pod-panel-full .pod-browser-head-nav { order: 2; flex: 1 1 0; }
.pod-panel-full .pod-browser-head-tools { order: 3; }
.pod-panel-full .pod-browser-stage { align-items: center; padding: 8px; }
/* 画面上浮着的：bot 请你接管的提示（上方居中）、动作记录（右上角）。 */
.pod-browser-wait { position: absolute; top: 18px; left: 50%; z-index: 2; display: flex; align-items: center; gap: 10px; width: max-content; max-width: calc(100% - 40px); padding: 8px 8px 8px 12px; transform: translateX(-50%); border: 1px solid color-mix(in srgb, var(--pod-warn) 45%, transparent); border-radius: 12px; background: var(--dsw-alias-bg-layer-1, #fff); box-shadow: 0 8px 24px color-mix(in srgb, #000 16%, transparent); font-size: 13px; }
.pod-browser-wait > svg { flex: none; color: var(--pod-warn); }
.pod-browser-log { position: absolute; top: 18px; right: 18px; z-index: 2; display: flex; flex-direction: column; width: min(320px, calc(100% - 36px)); max-height: calc(100% - 36px); border: 1px solid var(--pod-line); border-radius: 12px; background: var(--dsw-alias-bg-layer-1, #fff); box-shadow: 0 8px 24px color-mix(in srgb, #000 16%, transparent); }
.pod-browser-log-head { display: flex; align-items: center; justify-content: space-between; padding: 8px 8px 6px 12px; font-size: 13px; }
.pod-browser-actions { flex: 1; min-height: 0; overflow-y: auto; margin: 0; padding: 0 12px 10px; list-style: none; display: flex; flex-direction: column; gap: 4px; font-size: 12.5px; }
.pod-live { position: relative; border-radius: 10px; overflow: hidden; background: #1b1b1f; border: 1px solid var(--pod-line); }
.pod-live canvas { display: block; width: 100%; height: auto; }
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
.pod-approval-shot { max-width: 100%; border-radius: 8px; border: 1px solid var(--pod-line); }
.pod-approval-form { border-collapse: collapse; font-size: 12px; }
.pod-approval-form th { text-align: left; font-weight: 500; color: var(--dsw-alias-label-tertiary); padding: 2px 10px 2px 0; vertical-align: top; }
.pod-approval-form td { padding: 2px 0; word-break: break-all; }
.pod-site-rules { display: flex; flex-direction: column; gap: 6px; }
.pod-site-rule { display: grid; grid-template-columns: minmax(0, 1fr) 150px minmax(0, 1fr) auto; gap: 6px; align-items: center; }
@media (max-width: 900px) { .pod-site-rule { grid-template-columns: 1fr 1fr; } }
`
