/** 设计类模板的样式：幻灯片、海报、原型（含界面组件）。 */

export const SLIDES_CSS = `
.deck{position:fixed;inset:0;display:flex;flex-direction:column;background:var(--page)}
.deck-stage{flex:1;min-height:0;display:grid;grid-template:minmax(0,1fr)/minmax(0,1fr);place-items:center;overflow:hidden}
.slides{position:relative;width:1280px;height:720px;flex:none;transform-origin:center center}
.slide{--plane:var(--surface);position:absolute;inset:0;width:1280px;height:720px;background:var(--surface);border-radius:14px;box-shadow:0 10px 40px rgba(0,0,0,.14);overflow:hidden;display:none;flex-direction:column;padding:64px 72px 64px}
.slide.on{display:flex}
html:not(.js) .deck{position:static}html:not(.js) .deck-stage{display:block;padding:16px}html:not(.js) .slides{width:auto;height:auto}html:not(.js) .slide{position:relative;display:flex;margin:0 auto 24px}html:not(.js) .deck-nav{display:none}
.slide h1{font-size:60px;line-height:1.12;margin:0;font-weight:700;letter-spacing:-.02em}
.s-h{font-size:38px;line-height:1.2;margin:0 0 6px;font-weight:680;letter-spacing:-.01em}
.s-sub{font-size:20px;color:var(--ink-2);margin:0 0 18px}
.s-body{flex:1;min-height:0;display:flex;flex-direction:column;justify-content:flex-start;margin-top:28px}
.slide details.data{display:none}.slide .unit{font-size:14px}
.slide .prose,.slide .list{font-size:22px;line-height:1.6}.slide .list li{margin:.45em 0}
.slide .metric-value{font-size:40px}.slide .metric-label{font-size:15px}.slide table.grid{font-size:16px}
.slide .block-title{font-size:18px}.slide .quote p{font-size:28px}
.l-title{justify-content:center}.l-title::before{content:"";position:absolute;left:72px;top:64px;width:72px;height:6px;border-radius:3px;background:var(--accent)}
.s-kicker{font-size:16px;color:var(--accent);font-weight:650;letter-spacing:.06em;margin-bottom:18px}
.l-title .s-lead{font-size:24px;color:var(--ink-2);margin:22px 0 0;max-width:960px}
.l-title .blocks{margin-top:36px}
.l-section{justify-content:center;background:color-mix(in srgb,var(--accent) 10%,var(--surface))}
.s-num{font-size:20px;font-weight:700;color:var(--accent);font-variant-numeric:tabular-nums}
.l-section h2{font-size:54px;line-height:1.15;margin:10px 0 0;font-weight:700}.l-section .s-lead{font-size:22px;color:var(--ink-2);margin:16px 0 0}
.l-quote{justify-content:center}.s-quote{margin:0;font-size:42px;line-height:1.4;font-weight:650;border-left:6px solid var(--accent);padding-left:36px}.s-quote footer{margin-top:22px;font-size:20px;color:var(--ink-2);font-weight:400}
.l-end{justify-content:center;align-items:center;text-align:center}.l-end .s-lead{font-size:22px;color:var(--ink-2);margin:18px 0 0}
.s-cols{flex:1;min-height:0;display:grid;grid-template-columns:1fr 1fr;gap:48px;align-content:start;margin-top:28px}
.s-foot{position:absolute;left:72px;right:72px;bottom:24px;display:flex;justify-content:space-between;font-size:13px;color:var(--ink-3)}
.deck-nav{flex:none;display:flex;align-items:center;justify-content:center;gap:10px;padding:10px;font-size:13px;color:var(--ink-2)}
.deck-nav button{appearance:none;border:1px solid var(--line);background:var(--surface);color:var(--ink);border-radius:8px;padding:5px 14px;font:inherit;cursor:pointer}
.deck-nav button:hover{background:var(--surface-2)}.deck-nav button:disabled{opacity:.4;cursor:default}
.deck-count{font-variant-numeric:tabular-nums;min-width:64px;text-align:center}
.notes{display:none}
.notes-panel{display:none;flex:none;max-height:26vh;overflow:auto;padding:10px 20px;border-top:1px solid var(--line);background:var(--surface);font-size:13px;color:var(--ink-2);white-space:pre-wrap}
.deck.show-notes .notes-panel{display:block}
.mode-export .deck{position:static;display:block}.mode-export .slides{width:auto;height:auto}
.mode-export.kind-slides .deck-stage{display:block;overflow:visible;padding:24px}
.mode-export.kind-slides .slide{position:relative;display:flex;margin:0 0 24px;box-shadow:none;border:1px solid var(--line)}
.mode-export.kind-slides .slide:last-child{margin-bottom:0}
.mode-export .deck-nav,.mode-export .notes-panel{display:none}
@media print{.mode-export.kind-slides .deck-stage{padding:0}.mode-export.kind-slides .slide{margin:0;border:0;border-radius:0;break-after:page}.mode-export.kind-slides .slide:last-child{break-after:auto}}
`

export const POSTER_CSS = `
.poster-stage{display:flex;justify-content:center;padding:24px;overflow:hidden;min-height:100vh}
.poster-scale{flex:none;transform-origin:top center}
.poster{--plane:var(--surface);position:relative;overflow:hidden;color:var(--ink);background:var(--surface);box-shadow:0 10px 40px rgba(0,0,0,.18)}
.poster.bg-dark{background:#121315;--plane:#121315}
.poster.bg-accent{background:var(--poster-accent);--plane:var(--poster-accent)}
.poster.bg-gradient{background:linear-gradient(140deg,var(--poster-accent),color-mix(in srgb,var(--poster-accent) 50%,#000));--plane:color-mix(in srgb,var(--poster-accent) 75%,#000)}
.poster-inner{position:absolute;inset:0;padding:calc(var(--pu)*.08);display:flex;flex-direction:column;gap:calc(var(--pu)*.03)}
.p-eyebrow{font-size:calc(var(--pu)*.024);font-weight:700;letter-spacing:.14em;color:var(--accent)}
.bg-accent .p-eyebrow,.bg-gradient .p-eyebrow{color:rgba(255,255,255,.86)}
.p-headline{margin:0;font-size:calc(var(--pu)*.088);line-height:1.08;font-weight:800;letter-spacing:-.02em}
.p-sub{margin:0;font-size:calc(var(--pu)*.032);line-height:1.45;color:var(--ink-2)}
.p-body{flex:1;min-height:0;display:flex;flex-direction:column;justify-content:center}
.poster .prose,.poster .list{font-size:calc(var(--pu)*.026)}.poster .metric-value{font-size:calc(var(--pu)*.05)}.poster .metric-label{font-size:calc(var(--pu)*.018)}
.poster .metric{background:var(--surface);border-color:var(--line)}
.p-footer{font-size:calc(var(--pu)*.02);color:var(--ink-3);border-top:1px solid var(--line);padding-top:calc(var(--pu)*.024)}
.mode-export .poster-stage{padding:0;display:block;min-height:0}.mode-export .poster-scale{transform:none!important}.mode-export .poster{box-shadow:none}
`

export const PROTO_CSS = `
.proto{display:flex;height:100vh}
.proto-list{flex:none;width:208px;padding:20px 12px;border-right:1px solid var(--line);background:var(--surface);display:flex;flex-direction:column;gap:2px;overflow:auto}
.proto-list h1{font-size:15px;line-height:1.35;margin:0 8px 4px}.proto-list .meta{margin:0 8px 14px}
.proto-list button{all:unset;padding:7px 10px;border-radius:8px;font-size:13px;color:var(--ink-2);cursor:pointer}
.proto-list button:hover{background:var(--surface-2)}.proto-list button.on{background:color-mix(in srgb,var(--accent) 12%,transparent);color:var(--ink);font-weight:600}
.proto-list button:focus-visible{outline:2px solid var(--accent)}
.proto-stage{flex:1;min-width:0;display:grid;grid-template:minmax(0,1fr)/minmax(0,1fr);place-items:center;overflow:hidden;padding:16px}
.frame{flex:none;position:relative;transform-origin:center center;background:#0f0f10;border-radius:56px;padding:12px;box-shadow:0 24px 64px rgba(0,0,0,.28)}
.device-tablet .frame{border-radius:40px;padding:18px}
.device-desktop .frame{border-radius:12px;padding:30px 0 0;background:#2b2b2d}
.device-desktop .frame::before{content:"";position:absolute;left:16px;top:11px;width:44px;height:8px;background:radial-gradient(circle at 4px 4px,#ff5f57 4px,transparent 4.5px),radial-gradient(circle at 22px 4px,#febc2e 4px,transparent 4.5px),radial-gradient(circle at 40px 4px,#28c840 4px,transparent 4.5px)}
.screen{--plane:var(--page);width:390px;height:844px;background:var(--page);border-radius:44px;overflow:hidden;display:none;flex-direction:column;position:relative}
.device-tablet .screen{width:820px;height:1180px;border-radius:24px}.device-desktop .screen{width:1280px;height:800px;border-radius:0 0 12px 12px}
.screen.on{display:flex}
html:not(.js) .screen{display:flex}html:not(.js) .proto-stage{display:flex;flex-wrap:wrap;gap:24px;overflow:auto}
.sbar{flex:none;height:46px;display:flex;align-items:center;justify-content:space-between;padding:0 30px 0 34px;font-size:15px;font-weight:600;background:var(--surface)}
.sbar i{width:26px;height:12px;border-radius:3px;border:1.5px solid currentColor;opacity:.8}
.device-desktop .sbar,.device-tablet .sbar{display:none}
.screen-body{flex:1;min-height:0;overflow-y:auto;padding:14px 16px 18px}
.screen>.blk{flex:none}
.screen .blocks{gap:12px}
.device-phone .screen .blk{grid-column:span 12}
.ui-appbar{flex:none;display:flex;align-items:center;gap:8px;height:50px;padding:0 12px;border-bottom:1px solid var(--line);background:var(--surface)}
.ui-title{flex:1;text-align:center;font-weight:650;font-size:16px;overflow:hidden;text-overflow:ellipsis;white-space:nowrap}
.ui-side{width:76px;display:flex;align-items:center}.ui-actions{justify-content:flex-end;gap:12px;font-size:14px;color:var(--accent)}
.ui-back svg{width:22px;height:22px;fill:none;stroke:var(--accent);stroke-width:2;stroke-linecap:round;stroke-linejoin:round}
.ui-tabbar{flex:none;display:flex;border-top:1px solid var(--line);background:var(--surface);padding:7px 4px 20px}
.device-desktop .ui-tabbar,.device-tablet .ui-tabbar{padding-bottom:8px}
.ui-tab{flex:1;display:flex;flex-direction:column;align-items:center;gap:3px;font-size:11px;color:var(--ink-3)}
.ui-tab i{width:22px;height:22px;border-radius:7px;background:currentColor;opacity:.3}.ui-tab.on{color:var(--accent)}.ui-tab.on i{opacity:1}
.ui-btn{display:flex;align-items:center;justify-content:center;min-height:46px;padding:0 16px;border-radius:12px;font-weight:650;font-size:15px;user-select:none}
.ui-primary{background:var(--accent);color:#fff}.ui-secondary{background:color-mix(in srgb,var(--accent) 12%,transparent);color:var(--accent)}.ui-ghost{color:var(--accent)}.ui-danger{background:color-mix(in srgb,var(--bad) 12%,transparent);color:var(--bad)}
.ui-input{display:flex;flex-direction:column;gap:6px;font-size:13px;color:var(--ink-2)}
.ui-field{font:inherit;font-size:15px;color:var(--ink);background:var(--surface);border:1px solid var(--line);border-radius:10px;padding:11px 12px;outline:none;resize:none;width:100%}
.ui-field:focus{border-color:var(--accent)}.ui-field::placeholder{color:var(--ink-3)}
.ui-toggle{display:flex;align-items:center;justify-content:space-between;gap:12px;padding:12px 14px;border-radius:12px;background:var(--surface);border:1px solid var(--line)}
.ui-toggle-label{font-size:15px}.ui-sub{font-size:12px;color:var(--ink-3)}
.ui-switch{flex:none;width:46px;height:28px;border-radius:14px;background:var(--axis);position:relative;cursor:pointer;transition:background .15s}
.ui-switch i{position:absolute;top:3px;left:3px;width:22px;height:22px;border-radius:50%;background:#fff;box-shadow:0 1px 3px rgba(0,0,0,.25);transition:transform .15s}
.ui-switch.on{background:var(--ok-mark)}.ui-switch.on i{transform:translateX(18px)}
.ui-card{background:var(--surface);border:1px solid var(--line);border-radius:14px;padding:14px;display:grid;gap:4px;justify-items:start}
.ui-card-title{font-weight:650;font-size:15px}.ui-card-text{font-size:14px;color:var(--ink-2)}
.ui-rows{background:var(--surface);border:1px solid var(--line);border-radius:14px;overflow:hidden}
.ui-row{display:flex;align-items:center;gap:10px;padding:12px 14px;border-bottom:1px solid var(--line)}.ui-row:last-child{border-bottom:0}
.ui-row-main{flex:1;min-width:0}.ui-row-title{font-size:15px}.ui-meta{font-size:13px;color:var(--ink-3)}
.ui-chev{flex:none;width:14px;height:14px;fill:none;stroke:var(--ink-3);stroke-width:2;stroke-linecap:round;stroke-linejoin:round}
.ui-seg{display:flex;padding:3px;border-radius:10px;background:var(--surface-2)}
.ui-seg-item{flex:1;text-align:center;padding:6px 8px;border-radius:8px;font-size:13px;color:var(--ink-2);cursor:pointer}
.ui-seg-item.on{background:var(--surface);color:var(--ink);font-weight:600;box-shadow:0 1px 3px rgba(0,0,0,.08)}
[data-goto]:active{opacity:.7}
.proto-sheet{display:flex;flex-wrap:wrap;gap:40px 32px;justify-content:center;padding:32px}
.sheet-item{display:flex;flex-direction:column;align-items:center;gap:12px}.sheet-item .screen{display:flex}.sheet-title{font-size:14px;font-weight:600;color:var(--ink-2)}
@media print{.mode-export.kind-prototype .page{padding:0}.mode-export.kind-prototype .page-head{display:none}.proto-sheet{display:block;padding:0}.sheet-item{break-after:page;break-inside:avoid}.sheet-item:last-child{break-after:auto}.sheet-item .frame{box-shadow:none}}
`
