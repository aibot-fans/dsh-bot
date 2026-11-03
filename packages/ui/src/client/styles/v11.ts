/**
 * 提到群的提示（比如“拉了群「监控播报」”）里，群名是进群的入口。
 */
export const V11_CSS = `
.pod-group-chip { appearance: none; display: inline-flex; align-items: center; gap: 6px; max-width: 100%; margin: 0 3px; padding: 2px 9px 2px 3px; border: 1px solid var(--pod-line); border-radius: 999px; background: var(--dsw-alias-bg-layer-1, transparent); color: inherit; font: inherit; font-size: 12.5px; vertical-align: middle; cursor: pointer; }
.pod-group-chip:hover { background: var(--pod-soft); }
.pod-group-chip-title { overflow: hidden; text-overflow: ellipsis; white-space: nowrap; font-weight: 600; color: var(--dsw-alias-label-primary); }
.pod-group-chip-go { display: inline-flex; align-items: center; gap: 2px; color: var(--dsw-alias-link, #4d6bfe); white-space: nowrap; }
`
