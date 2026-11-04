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
.pod-task-hero { display: flex; flex-direction: column; gap: 6px; padding: 2px 4px 0; }
.pod-task-hero-title { font-size: 17px; line-height: 1.4; }
.pod-task-section-body { margin: 0; padding: 2px 14px 10px; font-size: 13.5px; }
.pod-task-section .pod-md { line-height: 1.6; }
.pod-task-child { appearance: none; display: flex; align-items: center; justify-content: space-between; gap: 10px; margin: 0 6px; padding: 7px 8px; border: 0; border-radius: 8px; background: none; color: inherit; font: inherit; font-size: 13.5px; text-align: left; cursor: pointer; }
.pod-task-child:hover { background: var(--pod-soft); }
.pod-task-child + .pod-task-child { margin-top: 0; }
.pod-panel-tabs { gap: 2px; }
.pod-panel-tabs button { padding: 6px 9px; }
`
