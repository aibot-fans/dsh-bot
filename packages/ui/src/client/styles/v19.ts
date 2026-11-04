/**
 * 动态：群详情成员下面、成员单聊的 bot 详情和任务详情里，一段对话里干过的活。
 * 左边一列是图标，一件活一组用一根细线连到下一组；标题加粗、能点开任务详情，下面一行是谁在干和你怎么说的，
 * 再下面是记的进展（打勾）、交给成员的（箭头），最后一行是结果或者停在哪；连着对话里一句的点了跳过去。
 * 详情的标签那一行能横着滑，内容一长会被挤没，固定住它的高度。
 */
export const V19_CSS = `
.pod-panel-tabs { flex: none; }
.pod-act-body { padding: 4px 12px 10px 12px; }
.pod-act { margin: 0; padding: 0; list-style: none; font-size: 13px; line-height: 1.45; }
.pod-act-g { position: relative; padding: 4px 0 8px 24px; }
.pod-act-g::before { content: ''; position: absolute; left: 8px; top: 24px; bottom: -4px; width: 1px; background: var(--pod-line); }
.pod-act-g:last-child::before { display: none; }
.pod-act-gi { position: absolute; left: 1px; top: 6px; display: flex; align-items: center; justify-content: center; width: 15px; height: 15px; background: var(--dsw-alias-bg-layer-1, #fff); }
.pod-act-gh { display: flex; align-items: baseline; gap: 8px; min-width: 0; }
.pod-act-title { appearance: none; min-width: 0; padding: 0; border: 0; background: none; color: var(--dsw-alias-label-primary); font: inherit; font-weight: 600; text-align: left; overflow: hidden; white-space: nowrap; text-overflow: ellipsis; }
.pod-act-open { cursor: pointer; }
.pod-act-open:hover { color: var(--pod-working); }
.pod-act-muted { font-weight: 400; color: var(--dsw-alias-label-secondary); }
.pod-act-time { flex: none; margin-left: auto; color: var(--dsw-alias-label-tertiary); font-size: 11.5px; font-variant-numeric: tabular-nums; }
.pod-act-who { display: flex; align-items: center; gap: 6px; min-width: 0; margin: 1px 0 4px; color: var(--dsw-alias-label-secondary); font-size: 12px; white-space: nowrap; }
.pod-act-person { flex: none; display: inline-flex; align-items: center; gap: 4px; }
.pod-act-said { appearance: none; min-width: 0; margin-left: 2px; padding: 0; border: 0; background: none; color: var(--dsw-alias-label-tertiary); font: inherit; text-align: left; overflow: hidden; text-overflow: ellipsis; }
button.pod-act-said { cursor: pointer; }
button.pod-act-said:hover { color: var(--dsw-alias-label-secondary); }
.pod-act-e { appearance: none; display: flex; align-items: center; gap: 7px; width: 100%; padding: 2px 0; border: 0; background: none; color: var(--dsw-alias-label-primary); font: inherit; text-align: left; }
.pod-act-e > .pod-state-icon, .pod-act-check, .pod-act-handoff { flex: none; }
.pod-act-text { flex: 1 1 auto; min-width: 0; word-break: break-word; }
.pod-act-link { cursor: pointer; }
.pod-act-link:hover .pod-act-text { text-decoration: underline; text-underline-offset: 2px; }
.pod-act-end .pod-act-text { color: var(--dsw-alias-label-secondary); }
.pod-act-link.pod-act-end .pod-act-text { color: var(--pod-working); }
.pod-act-live .pod-act-text { color: var(--pod-working); }
.pod-act-bad .pod-act-text { color: var(--pod-danger); }
.pod-act-check, .pod-act-handoff, .pod-act-mark { display: inline-flex; align-items: center; justify-content: center; width: 14px; height: 14px; color: var(--dsw-alias-label-tertiary); }
.pod-act-check { color: var(--pod-ok); }
.pod-act-check .pod-icon { stroke-width: 2.6; }
.pod-act-mark { color: var(--dsw-alias-label-tertiary); }
.pod-act-dots { display: inline-flex; gap: 2px; }
.pod-act-dots i { width: 3px; height: 3px; border-radius: 50%; background: var(--dsw-alias-label-tertiary); }
.pod-act-more { appearance: none; margin: 0 0 2px; padding: 0; border: 0; background: none; color: var(--dsw-alias-label-tertiary); font: inherit; font-size: 12px; cursor: pointer; }
.pod-act-more:hover { color: var(--dsw-alias-label-secondary); }
.pod-act-empty { margin: 0; padding: 2px 2px 4px; color: var(--dsw-alias-label-tertiary); font-size: 13px; }
.pod-act button:focus-visible { outline: 2px solid var(--pod-info); outline-offset: 2px; border-radius: 4px; }
`
