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
`
