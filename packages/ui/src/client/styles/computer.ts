/** 电脑面板（和浏览器面板共用大部分样式）、对话里的电脑卡片、对话顶部的电脑按钮。 */
export const COMPUTER_CSS = `
.pod-computer-app { flex: 0 1 auto; display: inline-flex; align-items: center; gap: 6px; min-width: 0; max-width: 240px; padding: 3px 10px; border-radius: 999px; background: var(--pod-soft); font-size: 13px; }
.pod-computer-banner { margin: 8px 10px 0; padding: 8px 12px; border-radius: 10px; background: color-mix(in srgb, var(--pod-warn) 14%, transparent); font-size: 13px; }
.pod-computer-taken .pod-live { outline: 2px solid var(--pod-warn); }
.pod-computer-caption { flex: none; display: flex; align-items: center; gap: 8px; min-width: 0; margin: 0; padding: 8px 14px 12px; border-top: 1px solid var(--pod-line); font-size: 13px; }
.pod-computer-caption .pod-ellipsis { flex: 1 1 auto; min-width: 0; }
.pod-computer-status { flex-direction: column; gap: 10px; padding: 16px; text-align: center; }
.pod-computer-status .pod-button { color: #eee; background: rgba(255,255,255,.1); border-color: rgba(255,255,255,.24); }
.pod-computer-status .pod-button:hover { background: rgba(255,255,255,.18); }
.pod-computer-card-shot { display: flex; align-items: center; justify-content: center; color: #bbb; cursor: pointer; }
.pod-head-button-busy { color: var(--dsw-alias-link, #4d6bfe); }
`
