/**
 * 动态，照 Comma 的样子：12px 字、18px 行高，左边一列 16px 图标。
 * 一组开头那行一根细线连到下一组开头，组里做成的几步缩进一列，自己一根细线连着；线从图标底下起、到下一个图标上面止，两头各空 1px。
 * 一行的内边距伸到列外面，图标和上面对齐，悬停的灰底比字宽一点；一行写“做了什么 时刻”，时刻颜色更浅。
 * 详情的标签那一行能横着滑，内容一长会被挤没，固定住它的高度。
 */
export const V19_CSS = `
.pod-panel-tabs { flex: none; }
.pod-act-body { padding: 2px 12px 10px 12px; }
.pod-act, .pod-act-steps { display: flex; flex-direction: column; margin: 0; padding: 0; list-style: none; }
.pod-act-group, .pod-act-item { position: relative; }
.pod-act-steps { padding-left: 24px; }
.pod-act-group:not(:last-child)::before, .pod-act-item:not(:last-child)::after { content: ''; position: absolute; top: 22px; bottom: -4px; left: 7.5px; border-left: 1px solid var(--pod-line); pointer-events: none; }
.pod-act-row { appearance: none; display: flex; align-items: flex-start; gap: 8px; width: fit-content; max-width: calc(100% + 8px); margin: 0 0 0 -8px; padding: 4px 8px; border: 0; border-radius: 8px; background: none; color: var(--dsw-alias-label-secondary); font: inherit; font-size: 12px; line-height: 18px; text-align: left; outline: none; }
button.pod-act-row { cursor: pointer; }
button.pod-act-row:hover, button.pod-act-row:active { background: var(--pod-btn-ghost-hover); }
button.pod-act-row:focus-visible { box-shadow: 0 0 0 2px color-mix(in srgb, var(--dsw-alias-label-tertiary) 45%, transparent); }
.pod-act-icon { flex: none; display: flex; align-items: center; justify-content: center; width: 16px; height: 18px; color: color-mix(in srgb, var(--dsw-alias-label-tertiary) 80%, transparent); }
.pod-act-icon svg { display: block; width: 16px; height: 16px; }
.pod-act-icon[data-done="true"] { color: var(--pod-ok); }
.pod-act-spin { transform-origin: 8px 8px; animation: pod-spin 1s linear infinite; }
.pod-act-text { min-width: 0; overflow-wrap: anywhere; }
.pod-act-text[data-kind="request"] { display: flex; align-items: baseline; min-width: 0; }
.pod-act-text[data-kind="request"] .pod-act-title { overflow: hidden; color: var(--dsw-alias-label-primary); text-overflow: ellipsis; white-space: nowrap; }
.pod-act-item[data-live="true"] .pod-act-text, [data-fold="true"] > .pod-act-row .pod-act-text { color: var(--dsw-alias-label-tertiary); }
.pod-act-time { flex: none; margin-left: 6px; color: color-mix(in srgb, var(--dsw-alias-label-tertiary) 80%, transparent); font-variant-numeric: tabular-nums; white-space: nowrap; }
.pod-act-empty { margin: 0; padding: 2px 2px 4px; color: var(--dsw-alias-label-tertiary); font-size: 13px; }
@media (prefers-reduced-motion: reduce) { .pod-act-spin { animation: none; } }
`
