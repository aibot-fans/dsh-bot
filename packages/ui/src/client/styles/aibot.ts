/** 0.7：aibot（X 数据和监控）的设置行、用量卡片、首次引导那句，以及「X 监控」群里的动态卡片。 */
export const AIBOT_CSS = `
.pod-aibot-detail { display: block; margin-top: 2px; }
.pod-aibot-alert { color: var(--pod-danger); }
.pod-aibot-ok { color: var(--pod-ok); }
.pod-aibot-code { padding: 1px 7px; border-radius: 6px; background: var(--pod-soft); color: var(--dsw-alias-label-primary); font: 600 13px/1.6 ui-monospace, SFMono-Regular, Menlo, monospace; letter-spacing: .08em; }
.pod-settings-control a.pod-button { text-decoration: none; }

.pod-aibot-usage { gap: 8px; }
.pod-aibot-usage p { margin: 0; }
.pod-aibot-numbers { display: flex; flex-wrap: wrap; align-items: baseline; justify-content: space-between; gap: 4px 12px; font-size: 13px; }
.pod-aibot-numbers strong { font-size: 20px; font-weight: 600; font-variant-numeric: tabular-nums; }
.pod-aibot-meter { height: 6px; border-radius: 999px; background: var(--pod-soft); overflow: hidden; }
.pod-aibot-meter > span { display: block; height: 100%; min-width: 2px; border-radius: inherit; background: var(--pod-info); }
.pod-aibot-meter-low > span { background: var(--pod-warn); }

.pod-aibot-intro { margin: 0; padding: 10px 12px; border-radius: 10px; background: color-mix(in srgb, var(--pod-info) 8%, transparent); color: var(--dsw-alias-label-primary); }

.pod-xevent { display: flex; flex-direction: column; gap: 8px; max-width: 540px; margin-top: 2px; padding: 12px 14px; border: 1px solid var(--pod-line); border-radius: 12px; background: var(--dsw-alias-bg-layer-2); }
.pod-xevent-head { display: flex; align-items: center; gap: 10px; min-width: 0; }
.pod-xevent-avatar { flex: none; display: inline-grid; place-items: center; width: 32px; height: 32px; border-radius: 50%; object-fit: cover; background: var(--pod-soft); color: var(--dsw-alias-label-secondary); font-size: 13px; font-weight: 600; }
.pod-xevent-who { flex: 1; min-width: 0; display: flex; flex-direction: column; line-height: 1.3; }
.pod-xevent-who strong { overflow: hidden; text-overflow: ellipsis; white-space: nowrap; font-size: 13.5px; }
.pod-xevent-who span { overflow: hidden; text-overflow: ellipsis; white-space: nowrap; color: var(--dsw-alias-label-tertiary); font-size: 12px; }
.pod-xevent-type { flex: none; padding: 1px 8px; border-radius: 999px; background: var(--pod-soft); color: var(--dsw-alias-label-secondary); font-size: 11.5px; }
.pod-xevent-title { margin: 0; font-weight: 600; }
.pod-xevent-summary { margin: 0; color: var(--dsw-alias-label-secondary); font-size: 13px; }
.pod-xevent-tweet { margin: 0; padding: 2px 0 2px 10px; border-left: 3px solid var(--pod-line); white-space: pre-wrap; overflow-wrap: anywhere; font-size: 13.5px; }
.pod-xevent-media { display: grid; grid-template-columns: repeat(2, minmax(0, 1fr)); gap: 4px; border-radius: 10px; overflow: hidden; }
.pod-xevent-media-1 { grid-template-columns: minmax(0, 1fr); }
.pod-xevent-media a { display: block; aspect-ratio: 16 / 10; background: var(--pod-soft); }
.pod-xevent-media-1 a { aspect-ratio: auto; max-height: 320px; }
.pod-xevent-media img { display: block; width: 100%; height: 100%; object-fit: cover; }
.pod-xevent-foot { display: flex; align-items: center; gap: 12px; color: var(--dsw-alias-label-tertiary); font-size: 12px; }
`
