/** 新版本提醒：侧栏“设置”旁边的提醒、更新弹窗、更新完的横幅。一键更新的进度框样式跟着框走，在 views/update/overlay.ts。 */
export const UPDATE_CSS = `
.pod-update-info { --pod-tone: var(--pod-info); }
.pod-update-warn { --pod-tone: var(--pod-warn); }
.pod-update-danger { --pod-tone: var(--pod-danger); }
.pod-update-pill { appearance: none; flex: none; display: inline-flex; align-items: center; gap: 6px; height: 28px; padding: 0 10px; border: 0; border-radius: 999px; font: inherit; font-size: 12.5px; font-weight: 500; white-space: nowrap; cursor: pointer; color: var(--pod-tone); background: color-mix(in srgb, var(--pod-tone) 12%, transparent); transition: background-color .12s ease; }
.pod-update-pill:hover { background: color-mix(in srgb, var(--pod-tone) 20%, transparent); }
.pod-update-pill:focus-visible { outline: 2px solid var(--pod-info); outline-offset: 1px; }
.pod-update-pill-dot { width: 6px; height: 6px; border-radius: 50%; background: currentColor; }
.pod-update-mini { order: -1; }
.pod-update-dot { position: absolute; top: 6px; right: 8px; width: 8px; height: 8px; border-radius: 50%; background: var(--pod-tone); box-shadow: 0 0 0 2px var(--pod-side-bg, var(--dsw-alias-bg-layer-1, #fff)); }

.pod-update-result { margin: 0 0 16px; padding: 12px 14px; border-radius: 12px; }
.pod-update-result > p { margin: 0; }
.pod-update-result-info { background: color-mix(in srgb, var(--pod-info) 9%, transparent); }
.pod-update-result-ok { background: color-mix(in srgb, var(--pod-ok) 10%, transparent); }
.pod-update-result-warn { background: color-mix(in srgb, var(--pod-warn) 10%, transparent); }
.pod-update-result-danger { background: color-mix(in srgb, var(--pod-danger) 9%, transparent); }
.pod-update-installed { margin-top: 10px; font-size: 13.5px; }
.pod-update-summary { margin: 0 0 10px; font-size: 13px; }
.pod-update-list { display: flex; flex-direction: column; gap: 12px; margin: 0 0 14px; padding: 0; list-style: none; }
.pod-update-release { padding: 12px 14px; border-radius: 12px; background: var(--pod-btn-fill, var(--pod-soft)); }
.pod-update-release-head { display: flex; align-items: baseline; gap: 8px; margin-bottom: 6px; font-size: 15px; font-weight: 600; }
.pod-update-release-head .pod-hint { font-weight: 400; }
.pod-update-link { margin-left: auto; font-size: 12px; text-decoration: none; }
.pod-update-release .pod-md { font-size: 13.5px; }
.pod-update-actions { display: flex; align-items: center; justify-content: flex-end; gap: 8px; flex-wrap: wrap; margin-top: 12px; }
.pod-update-note { margin: 8px 0 0; font-size: 12.5px; color: var(--dsw-alias-label-tertiary); }
.pod-update-warn-text { margin: 8px 0 0; font-size: 13px; color: var(--pod-warn); }
.pod-update-how > p { margin: 0; }
.pod-update-steps { margin: 8px 0 0; padding: 10px 12px; border-radius: 10px; background: var(--pod-btn-fill, var(--pod-soft)); font-family: ui-monospace, SFMono-Regular, Menlo, monospace; font-size: 12.5px; line-height: 1.7; white-space: pre; overflow-x: auto; }
.pod-update-foot { display: flex; align-items: center; gap: 8px; flex-wrap: wrap; margin-top: 18px; padding-top: 12px; border-top: 1px solid var(--pod-line); font-size: 12.5px; color: var(--dsw-alias-label-tertiary); }
.pod-update-foot .pod-button { margin-left: auto; }
.pod-update-error { color: var(--pod-danger); }

.pod-banner-ok { color: var(--pod-ok); background: color-mix(in srgb, var(--pod-ok) 10%, transparent); }
.pod-banner-buttons { display: inline-flex; gap: 8px; }
`
