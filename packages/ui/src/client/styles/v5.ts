/**
 * 0.5 的新部件：侧栏的红色未读角标和拖动提示、悬停才出现的消息按钮、群提示里的群名链接、
 * 详情页的返回、文件预览的更多格式（PDF、音视频、JSON）、鲸鱼图标、上传文件旁边的「文字版」。颜色都取 dsh 的主题变量。
 */
export const V5_CSS = `
.pod-side-badge { flex: none; display: inline-grid; place-items: center; min-width: 18px; height: 18px; padding: 0 5px; border-radius: 9px; font-size: 11px; font-weight: 600; line-height: 1; color: #fff; background: var(--pod-danger); font-variant-numeric: tabular-nums; }
.pod-side-collapsed .pod-side-badge { position: absolute; top: 1px; right: 3px; min-width: 16px; height: 16px; padding: 0 4px; font-size: 10px; box-shadow: 0 0 0 2px var(--pod-side-bg); }
.pod-side-item[draggable="true"] { -webkit-user-drag: element; }
.pod-side-drop-before { box-shadow: inset 0 2px 0 var(--pod-info); }
.pod-side-drop-after { box-shadow: inset 0 -2px 0 var(--pod-info); }
.pod-side-drop-head { border-radius: 8px; background: color-mix(in srgb, var(--pod-info) 10%, transparent); color: var(--pod-info); }
.pod-side-fold { flex: none; margin-left: 2px; }
.pod-side-collapsed .pod-side-fold { order: -1; margin: 0 0 4px; }
.pod-usage-subject { font-size: 12px; color: var(--dsw-alias-label-tertiary); }
.pod-usage-place { font-size: 13px; color: var(--dsw-alias-label-secondary); }
.pod-convo-new { flex: none; width: 32px; height: 32px; border-radius: 8px; color: var(--dsw-alias-label-secondary); }
.pod-notice-link { --pod-link: var(--dsw-alias-link, #4d6bfe); appearance: none; display: inline; padding: 0 3px; border: 0; border-radius: 6px; background: color-mix(in srgb, var(--pod-link) 10%, transparent); color: var(--pod-link); font: inherit; font-weight: 600; text-decoration: underline; text-decoration-color: color-mix(in srgb, var(--pod-link) 40%, transparent); text-underline-offset: 3px; cursor: pointer; }
.pod-notice-link:hover { background: color-mix(in srgb, var(--pod-link) 18%, transparent); text-decoration-color: currentColor; }
.pod-notice-link:focus-visible { outline: 2px solid var(--pod-link); outline-offset: 1px; }
.pod-group-hero { display: flex; align-items: center; gap: 14px; text-align: left; }
.pod-group-hero-main { flex: 1; min-width: 0; display: flex; flex-direction: column; align-items: flex-start; gap: 2px; }
.pod-group-hero .pod-hero-title { margin-left: -8px; }
.pod-group-hero .pod-hero-rename { max-width: 100%; text-align: left; }
.pod-group-hero .pod-hero-sub { max-width: none; }
.pod-preview-head { display: flex; align-items: center; gap: 10px; min-width: 0; }
.pod-preview-head .pod-hint { flex: 1; min-width: 0; }
.pod-preview-head a.pod-button { flex: none; text-decoration: none; }
.pod-preview-pdf { height: 78vh; }
.pod-preview-audio { width: 100%; }
.pod-preview-video { display: block; width: 100%; max-height: 70vh; border-radius: 8px; background: #000; }
.pod-preview-code { font-family: var(--dsw-alias-font-mono, ui-monospace, SFMono-Regular, Menlo, monospace); white-space: pre; overflow-x: auto; word-break: normal; }
.pod-preview-none { display: flex; flex-direction: column; gap: 6px; padding: 18px; border: 1px dashed var(--pod-line); border-radius: 12px; text-align: center; }
.pod-attachment-row { align-self: flex-start; display: flex; flex-wrap: wrap; align-items: center; gap: 6px; margin-top: 4px; }
.pod-attachment-row .pod-attachment { margin-top: 0; }
.pod-attachment-note { margin-top: 4px; }
`
