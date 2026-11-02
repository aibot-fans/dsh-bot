/**
 * 团队说明和默认更新：设置里的团队说明三块，bot 详情里人设的“默认已更新”，按行显示的差异。
 */
export const V10_CSS = `
.pod-team-note textarea { font-size: 13px; line-height: 1.6; resize: vertical; }
.pod-seed-update { display: flex; flex-direction: column; gap: 8px; margin-top: 10px; padding: 10px 12px; border-radius: 10px; background: color-mix(in srgb, var(--pod-warn) 7%, transparent); }
.pod-box-pad > .pod-seed-update:first-child, .pod-stack > .pod-seed-update { margin-top: 0; }
.pod-diff { max-height: 360px; overflow: auto; border: 1px solid var(--pod-line); border-radius: 8px; background: var(--dsw-alias-bg-layer-1, #fff); font-size: 12.5px; line-height: 1.6; }
.pod-diff-line { display: flex; gap: 8px; padding: 0 10px; white-space: pre-wrap; overflow-wrap: anywhere; }
.pod-diff-mark { flex: none; width: 1ch; color: var(--dsw-alias-label-secondary); user-select: none; }
.pod-diff-add { background: color-mix(in srgb, var(--pod-ok) 13%, transparent); }
.pod-diff-add .pod-diff-mark { color: var(--pod-ok); }
.pod-diff-del { background: color-mix(in srgb, var(--pod-danger) 11%, transparent); color: var(--dsw-alias-label-secondary); }
.pod-diff-del .pod-diff-mark { color: var(--pod-danger); }
`
