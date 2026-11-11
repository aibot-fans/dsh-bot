/**
 * 对话顶上的“需要你”条：和置顶条一个样子，底色带一点提醒色，在置顶条上面。
 * 写着最新的一件，点了跳到对话里那张卡片；右边是“不用管”，不止一件时还有全部几件。
 * 跳到卡片时下面留出“回到最新”那个圆按钮的位置，不挡住卡片上的按钮。
 */
export const V21_CSS = `
.pod-waitbar { flex: none; display: flex; align-items: center; gap: 8px; padding: 5px 12px 5px 18px; border-top: 1px solid var(--pod-line); border-bottom: 1px solid var(--pod-line); background: color-mix(in srgb, var(--pod-warn) 7%, var(--dsw-alias-bg-layer-1, #fff)); font-size: 13px; }
.pod-waitbar + .pod-pins { border-top: 0; }
.pod-waitbar > .pod-icon { flex: none; color: var(--pod-warn); }
.pod-waitbar-latest { appearance: none; flex: 1; min-width: 0; display: flex; padding: 3px 0; border: 0; background: none; color: inherit; font: inherit; text-align: left; cursor: pointer; }
.pod-waitbar-text { flex: 1; color: var(--dsw-alias-label-primary); }
.pod-waitbar-latest:hover .pod-waitbar-text { text-decoration: underline; text-underline-offset: 3px; text-decoration-color: var(--pod-line); }
.pod-waitbar-problem { flex: none; max-width: 40%; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; color: var(--pod-danger); font-size: 12px; }
.pod-waitbar-skip { appearance: none; flex: none; height: 26px; padding: 0 10px; border: 0; border-radius: 8px; background: var(--pod-btn-fill); color: var(--dsw-alias-label-secondary); font: inherit; font-size: 12px; white-space: nowrap; cursor: pointer; }
.pod-waitbar-skip:hover { background: var(--pod-btn-fill-hover); color: var(--dsw-alias-label-primary); }
.pod-waitbar-skip:disabled { opacity: .5; cursor: default; }
.pod-waitbar-latest:focus-visible, .pod-waitbar-skip:focus-visible { outline: 2px solid var(--pod-info); outline-offset: 1px; border-radius: 6px; }
.pod-timeline .pod-acard { scroll-margin: 16px 0 64px; }
`
