/**
 * 等你的卡片（照 Comma）：问题卡片是问题加一行行选项，选项下面一行小字，推荐的带“推荐”，最后一行自己写；答过以后选的标蓝、其余变灰。
 * 批准卡片是盾牌和要做什么、写清楚的说明，最后是批准、先不两个圆按钮；要你登录的也是这个样子。
 * 主对话里挂在 Super-agent 转告的那句话下面。
 */
export const V16_CSS = `
.pod-msg-under { width: 100%; max-width: var(--pod-card-max); margin-top: 8px; }
.pod-qcard, .pod-acard { width: 100%; max-width: 400px; border: 1px solid var(--pod-line); border-radius: 14px; background: var(--dsw-alias-bg-layer-1, #fff); color: var(--dsw-alias-label-primary); }

.pod-qcard { display: flex; flex-direction: column; overflow: hidden; }
.pod-qcard-title { padding: 11px 14px 9px; font-size: 14px; font-weight: 600; line-height: 1.45; overflow-wrap: anywhere; }
.pod-qcard-desc { margin-top: -5px; padding: 0 14px 9px; }
.pod-qcard-desc .pod-md, .pod-acard-detail .pod-md { font-size: 13px; line-height: 1.6; color: var(--dsw-alias-label-secondary); }
.pod-qcard-option { appearance: none; display: flex; flex-direction: column; align-items: flex-start; gap: 1px; width: 100%; padding: 8px 14px; border: 0; border-top: 1px solid var(--pod-line); background: none; color: inherit; font: inherit; text-align: left; cursor: pointer; }
.pod-qcard-option:hover:not(:disabled) { background: var(--pod-soft); }
.pod-qcard-option:disabled { cursor: default; }
.pod-qcard-option:focus-visible, .pod-qcard-other:focus-visible { outline: 2px solid var(--pod-info); outline-offset: -2px; }
.pod-qcard-label { display: inline-flex; align-items: center; gap: 6px; font-size: 13.5px; font-weight: 500; line-height: 1.45; overflow-wrap: anywhere; }
.pod-qcard-note { font-size: 12.5px; line-height: 1.45; color: var(--dsw-alias-label-tertiary); }
.pod-qcard-rec { flex: none; padding: 0 6px; border-radius: 4px; background: color-mix(in srgb, var(--pod-working) 12%, transparent); color: var(--pod-working); font-size: 11px; font-weight: 600; line-height: 17px; }
.pod-qcard-picked { background: color-mix(in srgb, var(--pod-working) 7%, transparent); }
.pod-qcard-picked .pod-qcard-label { color: var(--pod-working); }
.pod-qcard-off .pod-qcard-label { color: var(--dsw-alias-label-tertiary); }
.pod-qcard-row { display: flex; align-items: center; border-top: 1px solid var(--pod-line); }
.pod-qcard-other { appearance: none; display: block; flex: 1; min-width: 0; padding: 9px 14px; border: 0; background: none; color: var(--dsw-alias-label-tertiary); font: inherit; font-size: 13px; text-align: left; cursor: text; }
.pod-qcard-other:hover { color: var(--dsw-alias-label-secondary); }
div.pod-qcard-other { border-top: 1px solid var(--pod-line); color: var(--pod-working); white-space: pre-wrap; overflow-wrap: anywhere; cursor: default; }
.pod-qcard-skip { flex: none; margin-right: 14px; font-size: 12.5px; }
.pod-qcard-write { display: flex; align-items: flex-end; gap: 6px; padding: 7px 10px 7px 14px; border-top: 1px solid var(--pod-line); }
.pod-qcard-write .pod-textarea { flex: 1; min-height: 32px; }
.pod-qcard-result { padding: 8px 14px 9px; border-top: 1px solid var(--pod-line); font-size: 12.5px; color: var(--dsw-alias-label-tertiary); }
.pod-qcard-detail { padding: 7px 14px 9px; border-top: 1px solid var(--pod-line); color: var(--dsw-alias-label-secondary); font-size: 13px; }
.pod-qcard-detail > summary { cursor: pointer; color: var(--dsw-alias-label-tertiary); font-size: 12.5px; }
.pod-qcard-detail .pod-md { margin-top: 6px; font-size: 13px; line-height: 1.6; }
.pod-qcard-problem { margin: 0; padding: 0 14px 9px; }

.pod-acard { display: flex; flex-direction: column; gap: 8px; padding: 12px 14px; }
.pod-acard-head { display: flex; align-items: center; gap: 8px; }
.pod-acard-head > .pod-icon { flex: none; color: var(--pod-warn); }
.pod-acard-title { min-width: 0; font-size: 14px; font-weight: 600; line-height: 1.45; overflow-wrap: anywhere; }
.pod-acard-detail .pod-md-pre, .pod-qcard-desc .pod-md-pre { color: var(--dsw-alias-label-primary); }
details.pod-acard-detail > summary { cursor: pointer; color: var(--dsw-alias-label-tertiary); font-size: 12.5px; }
details.pod-acard-detail .pod-md { margin-top: 6px; }
.pod-acard-actions { display: flex; flex-wrap: wrap; gap: 8px; margin-top: 2px; }
.pod-acard-actions .pod-button { height: 30px; padding: 0 16px; border: 1px solid var(--pod-line); border-radius: 15px; background: transparent; color: var(--dsw-alias-label-primary); font-size: 13px; font-weight: 500; }
.pod-acard-actions .pod-button:hover:not(:disabled) { background: var(--pod-soft); }
.pod-acard-actions .pod-button-primary { border-color: var(--pod-owner-bubble); background: var(--pod-owner-bubble); color: var(--pod-owner-ink); }
.pod-acard-actions .pod-button-primary:hover:not(:disabled) { background: color-mix(in srgb, var(--pod-owner-bubble) 88%, #000); }
.pod-acard-result { font-size: 12.5px; color: var(--dsw-alias-label-tertiary); }
.pod-acard .pod-form-error { margin: 0; }
`
