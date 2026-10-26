/**
 * 第三版界面的新部件：侧栏条目和菜单、成员拼成的群图标、@ 名字、日期分隔、空对话的介绍、
 * 群聊详情的成员格子、成员卡片、每页顶上的说明。颜色都取 dsh 的主题变量。
 */
export const V3_CSS = `
.pod-app { --pod-mention: color-mix(in srgb, #2563eb 82%, var(--dsw-alias-label-primary)); }
.pod-side-item { position: relative; display: flex; align-items: center; border-radius: 10px; }
.pod-side-item:hover { background: var(--pod-soft); }
.pod-side-item-active, .pod-side-item-active:hover { background: color-mix(in srgb, var(--dsw-alias-label-primary) 8%, transparent); }
.pod-side-item .pod-side-row { flex: 1; min-width: 0; background: none; }
.pod-side-item .pod-side-row:hover { background: none; }
.pod-side-item:hover .pod-side-row, .pod-side-item:focus-within .pod-side-row, .pod-side-item-menu .pod-side-row { padding-right: 34px; }
.pod-side-more { appearance: none; position: absolute; top: 50%; right: 4px; display: grid; place-items: center; width: 28px; height: 28px; padding: 0; border: 0; border-radius: 8px; background: none; color: var(--dsw-alias-label-tertiary); cursor: pointer; opacity: 0; transform: translateY(-50%); }
.pod-side-more:hover { background: color-mix(in srgb, var(--dsw-alias-label-primary) 8%, transparent); color: var(--dsw-alias-label-primary); }
.pod-side-more:focus-visible { opacity: 1; outline: 2px solid var(--pod-info); outline-offset: -2px; }
.pod-side-item:hover .pod-side-more, .pod-side-item:focus-within .pod-side-more, .pod-side-item-menu .pod-side-more { opacity: 1; }
.pod-side-group { display: flex; flex-direction: column; gap: 1px; }
.pod-side-folder { gap: 2px; padding-right: 2px; }
.pod-side-folder-toggle { appearance: none; flex: 1; display: flex; align-items: center; gap: 5px; min-width: 0; padding: 2px 0; border: 0; background: none; color: var(--dsw-alias-label-secondary); font: inherit; font-size: 12px; cursor: pointer; }
.pod-side-folder-toggle:hover { color: var(--dsw-alias-label-primary); }
.pod-side-count { flex: none; color: var(--dsw-alias-label-tertiary); }
.pod-side-toggle { appearance: none; display: flex; align-items: center; gap: 6px; width: 100%; padding: 6px 10px; border: 0; border-radius: 8px; background: none; color: var(--dsw-alias-label-tertiary); font: inherit; font-size: 12.5px; text-align: left; cursor: pointer; }
.pod-side-toggle:hover { background: var(--pod-soft); color: var(--dsw-alias-label-secondary); }
.pod-side-archived { margin-top: 10px; }
.pod-rename { width: 100%; min-width: 0; padding: 3px 8px; font-size: 14px; }
.pod-menu { z-index: 60; display: flex; flex-direction: column; gap: 1px; min-width: 200px; max-width: 300px; padding: 6px; border: 1px solid var(--pod-line); border-radius: 12px; background: var(--dsw-alias-bg-layer-1, #fff); box-shadow: 0 12px 32px color-mix(in srgb, #000 14%, transparent); color: var(--dsw-alias-label-primary); font-size: 13px; }
.pod-menu-wide { width: 310px; max-width: calc(100vw - 16px); }
.pod-menu .pod-menu-item { width: 100%; min-height: 32px; text-align: left; }
.pod-menu-icon { flex: none; display: inline-grid; place-items: center; width: 16px; color: var(--dsw-alias-label-secondary); }
.pod-menu-danger .pod-menu-icon { color: inherit; }
.pod-menu-text { flex: 1; min-width: 0; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
.pod-menu-hint { flex: none; max-width: 110px; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; font-size: 11.5px; color: var(--dsw-alias-label-tertiary); }
.pod-menu-form { display: flex; flex-direction: column; gap: 8px; padding: 4px; }
.pod-group-mark { flex: none; display: grid; grid-template-columns: 1fr 1fr; grid-template-rows: 1fr; gap: 1px; border-radius: 30%; background: var(--dsw-alias-bg-layer-1, #fff); overflow: hidden; }
.pod-group-mark-3, .pod-group-mark-4 { grid-template-rows: 1fr 1fr; }
.pod-group-mark-3 > :first-child { grid-column: 1 / 3; }
.pod-group-cell { display: grid; place-items: center; min-width: 0; min-height: 0; overflow: hidden; background: color-mix(in srgb, var(--pod-name) 24%, var(--dsw-alias-bg-layer-1, #fff)); }
.pod-group-more { color: var(--dsw-alias-label-secondary); font-weight: 600; line-height: 1; background: color-mix(in srgb, var(--dsw-alias-label-primary) 10%, var(--dsw-alias-bg-layer-1, #fff)); }
.pod-botname { display: inline-flex; align-items: center; gap: 4px; min-width: 0; max-width: 100%; vertical-align: -3px; }
.pod-botname-text { overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
.pod-bot-picker { display: flex; flex-wrap: wrap; gap: 6px; }
.pod-bot-picker .pod-chip { display: inline-flex; align-items: center; gap: 6px; padding: 3px 12px 3px 4px; font-size: 13px; }
.pod-mention { appearance: none; display: inline-flex; align-items: center; gap: 3px; margin: 0 1px; padding: 0 7px 0 2px; border: 0; border-radius: 999px; background: color-mix(in srgb, var(--pod-mention) 12%, transparent); color: var(--pod-mention); font: inherit; font-weight: 600; line-height: 1.5; vertical-align: baseline; cursor: pointer; }
.pod-mention:hover { background: color-mix(in srgb, var(--pod-mention) 20%, transparent); text-decoration: underline; }
.pod-mention:focus-visible { outline: 2px solid var(--pod-mention); outline-offset: 1px; }
.pod-mention .pod-avatar { align-self: center; }
.pod-mention-plain, .pod-mention-plain:hover { padding: 0 2px 0 0; background: none; font-weight: 500; }
.pod-line-text { display: inline-flex; align-items: center; gap: 6px; min-width: 0; }
.pod-day { display: flex; justify-content: center; margin: 14px 0 6px; }
.pod-day span { padding: 2px 10px; border-radius: 999px; background: var(--pod-soft); font-size: 11.5px; color: var(--dsw-alias-label-tertiary); }
.pod-intro { display: flex; flex-direction: column; align-items: center; gap: 6px; max-width: 440px; margin: 56px auto 16px; text-align: center; }
.pod-intro strong { font-size: 17px; }
.pod-intro p { margin: 0; font-size: 14px; line-height: 1.6; color: var(--dsw-alias-label-secondary); }
.pod-intro-members { display: flex; flex-wrap: wrap; justify-content: center; gap: 14px; margin-bottom: 4px; }
.pod-intro-member { display: flex; flex-direction: column; align-items: center; gap: 4px; max-width: 76px; font-size: 12.5px; color: var(--dsw-alias-label-secondary); text-align: center; }
.pod-panel-top-back { justify-content: space-between; align-items: center; gap: 8px; }
.pod-back { appearance: none; display: inline-flex; align-items: center; gap: 4px; min-width: 0; max-width: 70%; padding: 6px 12px 6px 6px; border: 0; border-radius: 999px; background: none; color: var(--dsw-alias-label-secondary); font: inherit; font-size: 13.5px; cursor: pointer; }
.pod-back:hover { background: var(--pod-soft); color: var(--dsw-alias-label-primary); }
.pod-hero-plain { font-size: 20px; }
.pod-hero-title { appearance: none; display: inline-flex; align-items: center; gap: 6px; max-width: 100%; padding: 2px 8px; border: 0; border-radius: 8px; background: none; color: inherit; font: inherit; cursor: text; }
.pod-hero-title strong { overflow: hidden; text-overflow: ellipsis; white-space: nowrap; font-size: 20px; }
.pod-hero-title .pod-icon { flex: none; color: var(--dsw-alias-label-tertiary); opacity: .55; }
.pod-hero-title:hover { background: var(--pod-soft); }
.pod-hero-title:hover .pod-icon { opacity: 1; }
.pod-hero-rename { max-width: 260px; font-size: 16px; text-align: center; }
.pod-hero-sub { max-width: 340px; font-size: 13px; line-height: 1.5; color: var(--dsw-alias-label-tertiary); }
.pod-tab-hint { margin: -4px 0 0; font-size: 12.5px; line-height: 1.5; text-align: center; color: var(--dsw-alias-label-tertiary); }
.pod-member-grid { display: grid; grid-template-columns: repeat(auto-fill, minmax(74px, 1fr)); gap: 2px; padding: 4px 8px 10px; }
.pod-member-tile { appearance: none; position: relative; display: flex; flex-direction: column; align-items: center; gap: 4px; min-width: 0; padding: 8px 4px 6px; border: 0; border-radius: 12px; background: none; color: inherit; font: inherit; cursor: pointer; }
.pod-member-tile:hover { background: var(--pod-soft); }
.pod-member-tile:focus-visible { outline: 2px solid var(--pod-info); outline-offset: -2px; }
.pod-member-name { display: -webkit-box; max-width: 100%; overflow: hidden; -webkit-line-clamp: 2; -webkit-box-orient: vertical; font-size: 12.5px; line-height: 1.35; text-align: center; word-break: break-all; }
.pod-member-role { font-size: 10.5px; color: var(--dsw-alias-label-tertiary); }
.pod-member-plus { display: grid; place-items: center; width: 44px; height: 44px; border: 1px dashed var(--pod-line); border-radius: 50%; color: var(--dsw-alias-label-tertiary); }
.pod-member-add .pod-member-name { color: var(--dsw-alias-label-tertiary); }
.pod-member-grid-pick { padding: 0; }
.pod-member-tile-on { background: color-mix(in srgb, var(--pod-info) 10%, transparent); box-shadow: inset 0 0 0 1.5px var(--pod-info); }
.pod-member-tile-on:hover { background: color-mix(in srgb, var(--pod-info) 14%, transparent); }
.pod-member-check { position: absolute; top: 6px; right: 8px; display: grid; place-items: center; width: 18px; height: 18px; border-radius: 50%; background: var(--pod-info); color: #fff; }
.pod-member-actions { display: flex; flex-wrap: wrap; justify-content: center; gap: 8px; }
.pod-pick-main { display: flex; flex: 1; flex-direction: column; min-width: 0; }
.pod-pick-on { background: color-mix(in srgb, var(--pod-info) 8%, transparent); }
.pod-form-split { justify-content: space-between; flex-wrap: wrap; }
.pod-usage-name { display: flex; align-items: center; gap: 6px; min-width: 0; }
.pod-usage-icon-blank { flex: none; width: 20px; }
`
