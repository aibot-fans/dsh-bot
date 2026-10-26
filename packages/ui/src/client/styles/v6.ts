/** 0.7：多段单聊（对话记录、新对话）、bot 名字颜色、色板、详情里的页面页签。 */
export const V6_CSS = `
.pod-bot-name, .pod-color-dot, .pod-color-swatch, .pod-group-cell { --pod-name: var(--pod-name-light, currentColor); }
.pod-theme-dark :is(.pod-bot-name, .pod-color-dot, .pod-color-swatch, .pod-group-cell) { --pod-name: var(--pod-name-dark, currentColor); }
.pod-bot-name { color: var(--pod-name); }
.pod-side-row-title.pod-bot-name { font-weight: 500; }
.pod-hero-name { gap: 6px; padding-left: 0; }

.pod-head-button { appearance: none; flex: none; display: inline-grid; place-items: center; width: 32px; height: 32px; padding: 0; border: 0; border-radius: 9px; background: transparent; color: var(--dsw-alias-label-secondary); cursor: pointer; transition: background-color .12s ease, color .12s ease; }
.pod-head-button:hover { background: var(--pod-soft); color: var(--dsw-alias-label-primary); }
.pod-head-button-on { background: color-mix(in srgb, var(--dsw-alias-label-primary) 8%, transparent); color: var(--dsw-alias-label-primary); }
.pod-head-button:focus-visible { outline: 2px solid var(--pod-info); outline-offset: 1px; }
.pod-convo-subject { min-width: 0; max-width: 34%; color: var(--dsw-alias-label-tertiary); font-size: 13px; }
.pod-convo-subject::before { content: '/'; margin-right: 8px; color: var(--pod-line); }

.pod-history { display: flex; flex-direction: column; gap: 4px; width: 100%; }
.pod-history-head { padding: 4px 8px 6px; font-size: 12px; font-weight: 600; color: var(--dsw-alias-label-secondary); }
.pod-history-list { display: flex; flex-direction: column; gap: 1px; max-height: min(420px, 60vh); overflow-y: auto; }
.pod-history-row { position: relative; display: flex; align-items: center; gap: 4px; padding-right: 4px; border-radius: 8px; }
.pod-history-row:hover { background: var(--pod-soft); }
.pod-history-row-on { background: color-mix(in srgb, var(--pod-info) 9%, transparent); }
.pod-history-row-on:hover { background: color-mix(in srgb, var(--pod-info) 13%, transparent); }
.pod-history-open { appearance: none; flex: 1; min-width: 0; display: flex; flex-direction: column; gap: 1px; padding: 7px 8px; border: 0; background: none; color: inherit; font: inherit; text-align: left; cursor: pointer; }
.pod-history-subject { font-size: 13px; font-weight: 500; }
.pod-history-row-on .pod-history-subject { color: var(--pod-info); }
.pod-history-meta { font-size: 11.5px; color: var(--dsw-alias-label-tertiary); }
.pod-history-remove { opacity: 0; }
.pod-history-row:hover .pod-history-remove, .pod-history-remove:focus-visible { opacity: 1; }
.pod-history-tip { margin: 4px 8px 2px; padding-top: 8px; border-top: 1px solid var(--pod-line); font-size: 11.5px; line-height: 1.5; color: var(--dsw-alias-label-tertiary); }

.pod-color-dot { appearance: none; flex: none; width: 14px; height: 14px; padding: 0; border: 2px solid var(--dsw-alias-bg-layer-1, #fff); border-radius: 50%; background: var(--pod-name, var(--pod-info)); box-shadow: 0 0 0 1px var(--pod-line); cursor: pointer; }
.pod-color-dot:hover { box-shadow: 0 0 0 2px color-mix(in srgb, var(--pod-name, var(--pod-info)) 45%, transparent); }
.pod-color-dot:focus-visible { outline: 2px solid var(--pod-info); outline-offset: 2px; }
.pod-color-picker { display: flex; flex-direction: column; align-items: center; gap: 8px; padding: 10px 12px 6px; border: 1px solid var(--pod-line); border-radius: 12px; background: var(--dsw-alias-bg-layer-1, #fff); }
.pod-color-grid { display: grid; grid-template-columns: repeat(6, 26px); gap: 8px; }
.pod-color-swatch { appearance: none; width: 26px; height: 26px; padding: 0; border: 0; border-radius: 50%; background: var(--pod-name); cursor: pointer; transition: transform .12s ease; }
.pod-color-swatch:hover { transform: scale(1.1); }
.pod-color-swatch-on { box-shadow: 0 0 0 2px var(--dsw-alias-bg-layer-1, #fff), 0 0 0 4px var(--pod-name); }
.pod-color-swatch:focus-visible { outline: 2px solid var(--pod-info); outline-offset: 3px; }

.pod-tip { position: fixed; z-index: 300; max-width: 280px; padding: 5px 9px; border-radius: 7px; background: color-mix(in srgb, var(--dsw-alias-label-primary) 92%, transparent); color: var(--dsw-alias-bg-layer-1, #fff); box-shadow: 0 6px 18px color-mix(in srgb, #000 18%, transparent); font-size: 12px; line-height: 1.45; letter-spacing: .01em; white-space: pre-line; overflow-wrap: anywhere; pointer-events: none; opacity: 0; transform: translateY(2px); transition: opacity .12s ease, transform .12s ease; }
.pod-tip-on { opacity: 1; transform: none; }
@media (prefers-reduced-motion: reduce) { .pod-tip { transition: none; } }

.pod-panel-tabs { justify-content: safe center; overflow-x: auto; scrollbar-width: none; }
.pod-panel-tabs::-webkit-scrollbar { display: none; }
.pod-panel-tabs button { flex: none; padding: 6px 11px; white-space: nowrap; }
`
