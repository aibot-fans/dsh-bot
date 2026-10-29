/** 对话顶上的置顶条、置顶消息列表，你自己那条消息上的“已置顶”。 */
export const PINS_CSS = `
.pod-pins { flex: none; display: flex; align-items: center; gap: 8px; padding: 5px 12px 5px 18px; border-top: 1px solid var(--pod-line); border-bottom: 1px solid var(--pod-line); background: color-mix(in srgb, var(--pod-info) 5%, var(--dsw-alias-bg-layer-1, #fff)); font-size: 13px; }
.pod-pins > .pod-icon { flex: none; color: var(--pod-info); }
.pod-pins-latest { appearance: none; flex: 1; min-width: 0; display: flex; align-items: baseline; gap: 8px; padding: 3px 0; border: 0; background: none; color: inherit; font: inherit; text-align: left; cursor: pointer; }
.pod-pins-text { flex: 1; color: var(--dsw-alias-label-primary); }
.pod-pins-latest:hover .pod-pins-text { text-decoration: underline; text-underline-offset: 3px; text-decoration-color: var(--pod-line); }
.pod-pins-more { appearance: none; flex: none; display: inline-flex; align-items: center; gap: 2px; height: 26px; padding: 0 6px; border: 0; border-radius: 8px; background: transparent; color: var(--dsw-alias-label-secondary); font: inherit; font-size: 12px; cursor: pointer; }
.pod-pins-more:hover, .pod-pins-more[aria-expanded="true"] { background: var(--pod-soft); color: var(--dsw-alias-label-primary); }
.pod-pins-more:focus-visible, .pod-pins-latest:focus-visible { outline: 2px solid var(--pod-info); outline-offset: 1px; border-radius: 6px; }
.pod-pins-body { display: -webkit-box; -webkit-line-clamp: 2; -webkit-box-orient: vertical; overflow: hidden; font-weight: 400; line-height: 1.45; white-space: normal; overflow-wrap: anywhere; }
.pod-msg-owner > .pod-msg-pinned { margin: 3px 8px 0 0; }
`
