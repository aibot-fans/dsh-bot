/** 对话：时间线、你的气泡、bot 的发言、正在做什么、输入框（附件、@ 成员）和 Markdown。 */
export const CHAT_CSS = `
.pod-timeline { flex: 1; min-height: 0; overflow-y: auto; }
.pod-timeline-wrap { position: relative; flex: 1; min-height: 0; display: flex; flex-direction: column; }
.pod-jump-latest { position: absolute; right: 18px; bottom: 14px; z-index: 4; appearance: none; display: grid; place-items: center; width: 36px; height: 36px; padding: 0; border: 0; border-radius: 50%; corner-shape: round; background: var(--pod-info); color: var(--dsw-alias-bg-layer-1, #fff); box-shadow: 0 4px 14px color-mix(in srgb, #000 18%, transparent); cursor: pointer; animation: pod-rise .16s ease-out; }
.pod-jump-latest:hover { background: color-mix(in srgb, var(--pod-info) 84%, var(--dsw-alias-bg-layer-1, #fff)); }
.pod-jump-latest:focus-visible { outline: 2px solid var(--pod-info); outline-offset: 2px; }
.pod-jump-count { position: absolute; top: -5px; right: -5px; min-width: 18px; height: 18px; padding: 0 5px; box-sizing: border-box; border-radius: 9px; corner-shape: round; background: var(--pod-danger); color: #fff; font-size: 11px; line-height: 18px; text-align: center; box-shadow: 0 0 0 2px var(--dsw-alias-bg-layer-1, #fff); }
@keyframes pod-rise { from { opacity: 0; transform: translateY(6px); } to { opacity: 1; transform: none; } }
.pod-timeline-inner { display: flex; flex-direction: column; gap: 4px; max-width: 780px; margin: 0 auto; padding: 8px 24px 24px; }
.pod-load-older { align-self: center; margin-bottom: 8px; }
.pod-msg { position: relative; display: flex; gap: 10px; padding: 6px 0; }
.pod-msg-avatar { appearance: none; flex: none; height: fit-content; padding: 0; border: 0; border-radius: 50%; background: none; cursor: pointer; }
.pod-msg-avatar:focus-visible, .pod-msg-author:focus-visible { outline: 2px solid var(--pod-info); outline-offset: 2px; }
.pod-msg-main { flex: 1; min-width: 0; }
.pod-msg-head { display: flex; align-items: baseline; gap: 8px; margin-bottom: 2px; font-size: 13px; }
.pod-msg-author { appearance: none; padding: 0; border: 0; background: none; color: var(--dsw-alias-label-primary); font: inherit; font-weight: 600; cursor: pointer; }
.pod-msg-author:hover { text-decoration: underline; }
.pod-msg-head time { font-size: 11px; color: var(--dsw-alias-label-tertiary); }
.pod-msg-owner { flex-direction: column; align-items: flex-end; gap: 0; }
.pod-bubble { max-width: min(78%, 620px); padding: 8px 14px; border-radius: 18px; background: var(--pod-bubble); }
.pod-msg-owner > .pod-msg-time { margin: 3px 8px 0 0; font-size: 11px; line-height: 1.2; color: var(--dsw-alias-label-tertiary); }
.pod-bubble .pod-quote { border-left-color: color-mix(in srgb, var(--dsw-alias-label-primary) 20%, transparent); }
.pod-msg-actions { position: absolute; top: -12px; right: 4px; z-index: 3; display: flex; align-items: center; gap: 0; padding: 2px; border: 1px solid var(--pod-line); border-radius: 10px; background: var(--dsw-alias-bg-layer-1, #fff); box-shadow: 0 2px 10px color-mix(in srgb, #000 10%, transparent); opacity: 0; pointer-events: none; transition: opacity .12s; }
.pod-msg-actions .pod-icon-button { width: 28px; height: 28px; border-radius: 8px; color: var(--dsw-alias-label-tertiary); }
.pod-msg-actions .pod-icon-button:hover { color: var(--dsw-alias-label-primary); }
.pod-msg:hover .pod-msg-actions, .pod-msg:focus-within .pod-msg-actions, .pod-msg-actions-open { opacity: 1; pointer-events: auto; }
.pod-msg-kickoff .pod-msg-main { padding: 8px 12px; border: 1px solid color-mix(in srgb, var(--pod-info) 30%, transparent); border-radius: 12px; background: color-mix(in srgb, var(--pod-info) 4%, transparent); }
.pod-msg-live .pod-md { opacity: .92; }
.pod-live-line { display: inline-flex; align-items: center; gap: 8px; margin-top: 2px; font-size: 12.5px; color: var(--dsw-alias-label-tertiary); }
.pod-spinner { flex: none; width: 12px; height: 12px; border: 2px solid var(--pod-line); border-top-color: var(--pod-info); border-radius: 50%; corner-shape: round; animation: pod-spin .9s linear infinite; }
@keyframes pod-spin { to { transform: rotate(360deg); } }
@media (prefers-reduced-motion: reduce) { .pod-spinner, .pod-side-busy { animation: none; } }
.pod-focused > * { animation: pod-flash 2.4s ease-out; border-radius: 10px; }
@keyframes pod-flash { 0%, 40% { background: color-mix(in srgb, var(--pod-warn) 22%, transparent); } 100% { background: transparent; } }
.pod-kickoff-actions { display: flex; gap: 6px; margin-top: 6px; }
.pod-msg-card { display: flex; flex-direction: column; align-items: flex-start; gap: 4px; padding: 4px 0 4px 38px; }
.pod-msg-card > * { width: 100%; max-width: 640px; }
.pod-msg-card > .pod-link { width: auto; }
.pod-quote { margin: 2px 0 4px; padding: 2px 8px; border-left: 2px solid var(--pod-line); font-size: 12px; color: var(--dsw-alias-label-tertiary); }
.pod-line { display: flex; justify-content: space-between; align-items: center; gap: 12px; padding: 2px 0 2px 38px; font-size: 12px; color: var(--dsw-alias-label-tertiary); }
.pod-line time { flex: none; }
.pod-line-receipt { color: var(--pod-info); }
.pod-divider { display: flex; align-items: center; gap: 12px; margin: 14px 0; font-size: 12px; color: var(--dsw-alias-label-tertiary); }
.pod-divider::before, .pod-divider::after { content: ''; flex: 1; height: 1px; background: var(--pod-line); }
.pod-folded { padding: 2px 0 2px 38px; font-size: 13px; }
.pod-unread-summary { display: flex; flex-direction: column; gap: 4px; margin: 8px 0; padding: 10px 14px; border: 1px dashed var(--pod-line); border-radius: 10px; font-size: 13px; }
.pod-unread-summary ul { margin: 0; padding-left: 18px; color: var(--dsw-alias-label-secondary); }
.pod-attachment-image { appearance: none; display: block; margin-top: 6px; padding: 0; border: 0; background: none; cursor: zoom-in; }
.pod-attachment-image img { display: block; max-width: 280px; max-height: 220px; border: 1px solid var(--pod-line); border-radius: 12px; }
.pod-composer { position: relative; display: flex; flex-direction: column; gap: 6px; width: 100%; max-width: 828px; margin: 0 auto; padding: 0 24px 16px; }
.pod-composer-reply { display: flex; align-items: center; gap: 6px; padding: 0 8px; font-size: 12px; color: var(--dsw-alias-label-tertiary); }
.pod-composer-box { display: flex; flex-direction: column; gap: 6px; padding: 8px 8px 8px 8px; border: 1px solid var(--pod-line); border-radius: 24px; background: var(--dsw-alias-bg-layer-1, #fff); box-shadow: 0 2px 10px color-mix(in srgb, #000 4%, transparent); }
.pod-composer-box:focus-within { border-color: color-mix(in srgb, var(--pod-info) 55%, var(--pod-line)); }
.pod-composer-row { display: flex; align-items: flex-end; gap: 6px; }
.pod-composer-row .pod-icon-button { width: 34px; height: 34px; border-radius: 50%; }
.pod-composer-field { position: relative; flex: 1; min-width: 0; display: grid; }
.pod-composer-field > * { grid-area: 1 / 1; min-width: 0; }
.pod-composer-mention { padding: 0; border-radius: 4px; background: color-mix(in srgb, var(--pod-mention) 14%, transparent); color: var(--pod-mention); }
.pod-send { appearance: none; flex: none; display: grid; place-items: center; width: 34px; height: 34px; border: 0; border-radius: 50%; background: var(--dsw-alias-label-primary); color: var(--dsw-alias-bg-layer-1, #fff); cursor: pointer; }
.pod-send:disabled { opacity: .3; cursor: default; }
.pod-send:focus-visible { outline: 2px solid var(--pod-info); outline-offset: 2px; }
.pod-pending { display: flex; flex-wrap: wrap; gap: 6px; padding: 2px 4px; }
.pod-pending-item { display: inline-flex; align-items: center; gap: 6px; max-width: 220px; padding: 4px 4px 4px 4px; border-radius: 10px; background: var(--pod-soft); font-size: 12px; }
.pod-pending-item img { flex: none; width: 36px; height: 36px; border-radius: 6px; object-fit: cover; }
.pod-pending-remove { appearance: none; flex: none; display: grid; place-items: center; padding: 3px; border: 0; border-radius: 4px; background: none; color: var(--dsw-alias-label-tertiary); cursor: pointer; }
.pod-pending-remove:hover { color: var(--dsw-alias-label-primary); background: var(--pod-line); }
.pod-mentions { position: absolute; bottom: calc(100% - 10px); left: 24px; z-index: 20; width: 280px; margin: 0; padding: 4px; list-style: none; border: 1px solid var(--pod-line); border-radius: 12px; background: var(--dsw-alias-bg-layer-1, #fff); box-shadow: 0 12px 32px color-mix(in srgb, #000 12%, transparent); }
.pod-mentions button { appearance: none; display: flex; align-items: center; gap: 8px; width: 100%; padding: 6px 8px; border: 0; border-radius: 8px; background: transparent; color: inherit; font: inherit; font-size: 13.5px; text-align: left; cursor: pointer; }
.pod-mentions button:hover, .pod-mentions .pod-mention-active { background: var(--pod-soft); }
.pod-md { font-size: 14.5px; line-height: 1.7; overflow-wrap: anywhere; }
.pod-md > :first-child { margin-top: 0; }
.pod-md > :last-child { margin-bottom: 0; }
.pod-md-p { margin: 4px 0; }
.pod-md-heading { margin: 10px 0 4px; font-size: 14.5px; font-weight: 600; }
.pod-md-list { margin: 4px 0; padding-left: 22px; }
.pod-md-list .pod-md-list { margin: 2px 0; }
.pod-md-list > li > .pod-md-p, .pod-md-list > li > .pod-md-pre, .pod-md-list > li > .pod-md-quote { margin: 4px 0; }
.pod-md-quote { margin: 6px 0; padding: 2px 10px; border-left: 3px solid var(--pod-line); color: var(--dsw-alias-label-secondary); }
.pod-md-quote > :first-child { margin-top: 0; }
.pod-md-quote > :last-child { margin-bottom: 0; }
.pod-md-code { padding: 1px 5px; border-radius: 4px; background: var(--dsw-alias-markdown-code-block, var(--pod-soft)); font-family: var(--ds-font-family-code, ui-monospace, monospace); font-size: 12.5px; }
.pod-md-pre { margin: 6px 0; padding: 10px 12px; overflow-x: auto; border-radius: 8px; background: var(--dsw-alias-markdown-code-block, var(--pod-soft)); font-family: var(--ds-font-family-code, ui-monospace, monospace); font-size: 12.5px; line-height: 1.5; }
.pod-md-table-wrap { margin: 6px 0; overflow-x: auto; }
.pod-md-table { border-collapse: collapse; font-size: 13px; }
.pod-md-table th, .pod-md-table td { padding: 4px 10px; border: 1px solid var(--pod-line); text-align: left; vertical-align: top; }
.pod-md-table th { background: var(--pod-soft); font-weight: 600; }
.pod-md-rule { margin: 10px 0; border: 0; border-top: 1px solid var(--pod-line); }
.pod-md a { color: var(--pod-info); }
.pod-md s { color: var(--dsw-alias-label-secondary); }
`
