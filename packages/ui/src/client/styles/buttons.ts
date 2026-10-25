/**
 * 按钮统一换成“轻盈”一套：图标按钮不描边、不投影，悬停才出浅底；文字按钮默认浅灰底，
 * 主按钮实心，安静按钮透明，危险按钮浅红底；按下时轻轻缩一下。放在最后，盖过早先的写法。
 */
export const BUTTONS_CSS = `
.pod-app { --pod-btn-fill: color-mix(in srgb, var(--dsw-alias-label-primary) 6%, transparent); --pod-btn-fill-hover: color-mix(in srgb, var(--dsw-alias-label-primary) 10%, transparent); --pod-btn-ghost-hover: color-mix(in srgb, var(--dsw-alias-label-primary) 7%, transparent); }

.pod-round { width: 32px; height: 32px; border: 0; border-radius: 9px; background: transparent; box-shadow: none; color: var(--dsw-alias-label-secondary); transition: background-color .12s ease, color .12s ease, transform .08s ease; }
.pod-round:hover { background: var(--pod-btn-ghost-hover); color: var(--dsw-alias-label-primary); }
.pod-side-top .pod-round { width: 32px; height: 32px; }
.pod-round-small { width: 28px; height: 28px; border-radius: 8px; }
.pod-icon-button { width: 28px; height: 28px; border-radius: 8px; transition: background-color .12s ease, color .12s ease, transform .08s ease; }
.pod-icon-button:hover:not(:disabled), .pod-head-button:hover { background: var(--pod-btn-ghost-hover); }
.pod-icon-button:disabled { opacity: .35; cursor: default; }
.pod-msg-actions .pod-icon-button { width: 28px; height: 28px; border-radius: 8px; }

.pod-button { padding: 6px 14px; border: 0; border-radius: 9px; background: var(--pod-btn-fill); font-weight: 500; transition: background-color .12s ease, color .12s ease, transform .08s ease; }
.pod-button:hover:not(:disabled) { background: var(--pod-btn-fill-hover); }
.pod-button:disabled { opacity: .4; }
.pod-button-small { padding: 4px 10px; border-radius: 7px; font-size: 12px; }
.pod-button-primary { background: var(--dsw-alias-label-primary); color: var(--dsw-alias-bg-layer-1, #fff); }
.pod-button-primary:hover:not(:disabled) { background: color-mix(in srgb, var(--dsw-alias-label-primary) 84%, var(--dsw-alias-bg-layer-1, #fff)); opacity: 1; }
.pod-button-quiet { background: transparent; color: var(--dsw-alias-label-secondary); }
.pod-button-quiet:hover:not(:disabled) { background: var(--pod-btn-ghost-hover); color: var(--dsw-alias-label-primary); }
.pod-button-danger { background: color-mix(in srgb, var(--pod-danger) 9%, transparent); color: var(--pod-danger); }
.pod-button-danger:hover:not(:disabled) { background: color-mix(in srgb, var(--pod-danger) 15%, transparent); }

.pod-usage-chip { padding: 5px 10px; border: 0; border-radius: 8px; background: var(--pod-btn-fill); color: var(--dsw-alias-label-secondary); font-size: 12px; font-variant-numeric: tabular-nums; transition: background-color .12s ease, color .12s ease; }
.pod-usage-chip:hover, .pod-usage-chip[aria-expanded="true"] { background: var(--pod-btn-fill-hover); color: var(--dsw-alias-label-primary); }
.pod-usage-chip:focus-visible { outline: 2px solid var(--pod-info); outline-offset: 1px; }

.pod-chip { padding: 4px 12px; border: 0; background: var(--pod-btn-fill); transition: background-color .12s ease, color .12s ease; }
.pod-chip:hover { background: var(--pod-btn-fill-hover); color: var(--dsw-alias-label-primary); }
.pod-chip-active, .pod-chip-active:hover { background: var(--dsw-alias-label-primary); color: var(--dsw-alias-bg-layer-1, #fff); }
.pod-chip:focus-visible { outline: 2px solid var(--pod-info); outline-offset: 1px; }

.pod-composer-row .pod-icon-button { width: 34px; height: 34px; border-radius: 50%; }
.pod-send { transition: background-color .12s ease, transform .08s ease; }
.pod-send:disabled { opacity: 1; background: color-mix(in srgb, var(--dsw-alias-label-primary) 10%, transparent); color: var(--dsw-alias-label-tertiary); }
.pod-stop-all { border: 0; background: color-mix(in srgb, var(--pod-danger) 9%, transparent); }
.pod-stop-all:hover { background: color-mix(in srgb, var(--pod-danger) 15%, transparent); }
.pod-tag-add { border-radius: 999px; color: var(--dsw-alias-label-secondary); }
.pod-tag-add:hover { border-style: solid; color: var(--dsw-alias-label-primary); }

.pod-round:active, .pod-icon-button:active:not(:disabled), .pod-head-button:active, .pod-button:active:not(:disabled), .pod-send:active:not(:disabled), .pod-chip:active { transform: scale(.96); }
@media (prefers-reduced-motion: reduce) { .pod-round, .pod-icon-button, .pod-button, .pod-send, .pod-head-button { transition: none; } .pod-round:active, .pod-icon-button:active:not(:disabled), .pod-head-button:active, .pod-button:active:not(:disabled), .pod-send:active:not(:disabled), .pod-chip:active { transform: none; } }
`
