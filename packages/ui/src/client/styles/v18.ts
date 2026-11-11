/**
 * 11-04 那批改动：用电脑缺权限时的步骤框；看不出回的是哪句时气泡上面那一行小字（点了跳到原话）；
 * 顶部今天的用量（点开看分布）；任务详情；详情的七个标签收紧一点，侧栏宽度里放得下；对话区右边缘拖宽度的那一条；
 * 顶栏多了用量以后，开着右边详情时名字不让副标题挤没（副标题先缩）；设置左栏分组（手机上照旧一行横滑，不显示组名）。
 */
export const V18_CSS = `
.pod-fix { display: flex; flex-direction: column; gap: 8px; margin: 0 0 14px; padding: 12px 14px; border-radius: 10px; background: color-mix(in srgb, var(--pod-warn) 9%, transparent); color: var(--dsw-alias-label-primary); font-size: 13px; line-height: 1.55; }
.pod-fix > strong { color: var(--pod-warn); font-size: 14px; }
.pod-fix ol { margin: 0; padding-left: 20px; }
.pod-fix .pod-row { flex-wrap: wrap; }
.pod-fix .pod-muted { margin: 0; font-size: 12px; }
.pod-reply-ref { appearance: none; display: flex; align-items: center; gap: 4px; max-width: min(420px, 100%); margin: 0 0 3px; padding: 0 4px; border: 0; background: none; color: var(--dsw-alias-label-tertiary); font: inherit; font-size: 12px; line-height: 18px; cursor: pointer; }
.pod-reply-ref:hover { color: var(--dsw-alias-label-secondary); }
.pod-reply-ref:hover .pod-reply-text { text-decoration: underline; }
.pod-reply-ref:focus-visible { outline: 2px solid var(--pod-info); outline-offset: 1px; border-radius: 4px; }
.pod-reply-ref svg { flex: none; }
.pod-reply-who { flex: none; }
.pod-reply-text { min-width: 0; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
.pod-usage-chip { appearance: none; padding: 5px 10px; border: 0; border-radius: 8px; background: var(--pod-btn-fill); color: var(--dsw-alias-label-secondary); font: inherit; font-size: 12px; font-variant-numeric: tabular-nums; white-space: nowrap; cursor: pointer; transition: background-color .12s ease, color .12s ease; }
.pod-usage-chip:hover, .pod-usage-chip[aria-expanded="true"] { background: var(--pod-btn-fill-hover); color: var(--dsw-alias-label-primary); }
.pod-usage-chip:focus-visible { outline: 2px solid var(--pod-info); outline-offset: 1px; }
.pod-usage-popover { display: flex; flex-direction: column; gap: 8px; min-width: 0; padding: 6px; }
.pod-usage-subject { font-size: 12px; color: var(--dsw-alias-label-tertiary); }
.pod-usage-total { display: flex; flex-direction: column; gap: 2px; }
.pod-usage-total strong { font-size: 20px; }
.pod-usage-row { display: grid; grid-template-columns: 120px minmax(0, 1fr) 56px; gap: 8px; align-items: center; font-size: 13px; }
.pod-usage-place { font-size: 13px; color: var(--dsw-alias-label-secondary); }
.pod-usage-bar { height: 6px; overflow: hidden; border-radius: 3px; background: var(--pod-soft); }
.pod-usage-bar span { display: block; height: 100%; border-radius: 0 3px 3px 0; background: var(--pod-series); }
.pod-usage-value { text-align: right; font-variant-numeric: tabular-nums; color: var(--dsw-alias-label-secondary); }
.pod-task-hero { display: flex; flex-direction: column; gap: 6px; padding: 2px 4px 0; }
.pod-task-hero-title { font-size: 17px; line-height: 1.4; }
.pod-task-section-body { margin: 0; padding: 2px 14px 10px; font-size: 13.5px; }
.pod-task-section .pod-md { line-height: 1.6; }
.pod-task-child { appearance: none; display: flex; align-items: center; justify-content: space-between; gap: 10px; margin: 0 6px; padding: 7px 8px; border: 0; border-radius: 8px; background: none; color: inherit; font: inherit; font-size: 13.5px; text-align: left; cursor: pointer; }
.pod-task-child:hover { background: var(--pod-soft); }
.pod-task-child + .pod-task-child { margin-top: 0; }
.pod-panel-tabs { gap: 2px; }
.pod-panel-tabs button { padding: 6px 9px; }
.pod-convo { position: relative; }
.pod-chat-resize { position: absolute; top: 56px; bottom: 0; left: min(calc(50% + var(--pod-chat-max) / 2), calc(100% - 6px)); z-index: 3; width: 12px; margin-left: -6px; cursor: col-resize; touch-action: none; }
.pod-chat-resize::after { content: ''; position: absolute; top: 12px; bottom: 12px; left: 5px; width: 2px; border-radius: 1px; background: transparent; transition: background-color .12s ease; }
.pod-chat-resize:hover::after, .pod-chat-resize:focus-visible::after, .pod-chat-resize-on::after { background: color-mix(in srgb, var(--pod-info) 55%, transparent); }
.pod-chat-resize:focus-visible { outline: none; }
.pod-chat-resize-on { cursor: col-resize; }
@media (min-width: 761px) {
  .pod-convo-head .pod-convo-title { flex-shrink: 0; max-width: 45%; }
  .pod-convo-head .pod-convo-subject { flex: 0 50 auto; }
}
.pod-settings-nav-group { display: flex; flex-direction: column; gap: 2px; }
.pod-settings-nav-group + .pod-settings-nav-group { margin-top: 10px; }
.pod-settings-nav-label { padding: 2px 12px 4px; font-size: 11.5px; font-weight: 600; letter-spacing: .02em; color: var(--dsw-alias-label-tertiary); }
@media (max-width: 760px) {
  .pod-settings-nav-group { display: contents; }
  .pod-settings-nav-label { display: none; }
}
`
