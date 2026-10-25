/** 页面的基础样式和组件样式。颜色全用样式变量，深浅色由 theme.ts 切换。 */

export const BASE_CSS = `
*,*::before,*::after{box-sizing:border-box}
html{-webkit-text-size-adjust:100%}
body{margin:0;--plane:var(--page);background:var(--page);color:var(--ink);font:14px/1.6 -apple-system,BlinkMacSystemFont,"Segoe UI","PingFang SC","Hiragino Sans GB","Microsoft YaHei","Noto Sans CJK SC",system-ui,sans-serif;-webkit-font-smoothing:antialiased}
a{color:var(--accent);text-decoration:none}a:hover{text-decoration:underline}
code{font-family:ui-monospace,SFMono-Regular,Menlo,Consolas,monospace;font-size:.9em;background:var(--surface-2);padding:1px 5px;border-radius:4px}
.page{margin:0 auto;padding:40px 32px 64px}
.k-report{max-width:944px}.k-dashboard,.k-tracker{max-width:1344px}.k-diagram{max-width:1264px}
.page-head{margin-bottom:24px}
.eyebrow{font-size:12px;font-weight:600;color:var(--accent);letter-spacing:.04em}
.page-head h1{margin:4px 0 6px;font-size:28px;line-height:1.25;font-weight:650;letter-spacing:-.01em}
.k-dashboard .page-head h1,.k-tracker .page-head h1{font-size:24px}
.subtitle{margin:0;color:var(--ink-2);font-size:15px;max-width:760px}
.meta{margin-top:8px;color:var(--ink-3);font-size:12px}
.blocks{display:grid;grid-template-columns:repeat(12,minmax(0,1fr));gap:20px;align-items:start}
.k-report .blocks{gap:24px 20px}
.blk{grid-column:span 12;min-width:0}
.w-half{grid-column:span 6}.w-third{grid-column:span 4}.w-two-thirds{grid-column:span 8}.w-quarter{grid-column:span 3}
.card{--plane:var(--surface);background:var(--surface);border:1px solid var(--line);border-radius:12px;padding:16px 16px 12px}
.heading{margin:12px 0 0;font-weight:650;line-height:1.3}h2.heading{font-size:20px}h3.heading{font-size:17px}h4.heading{font-size:15px}
.block-title{margin:0 0 10px;font-size:14px;font-weight:600}
.prose{font-size:15px;line-height:1.75}.k-dashboard .prose,.k-tracker .prose{font-size:14px}
.prose p{margin:0 0 .8em}.prose>:last-child{margin-bottom:0}
.prose h3,.prose h4,.prose h5{margin:1.2em 0 .4em;line-height:1.35}.prose h3{font-size:17px}.prose h4{font-size:15px}.prose h5{font-size:14px}
.prose ul,.prose ol{margin:0 0 .8em;padding-left:1.4em}.prose li{margin:.2em 0}
.prose blockquote{margin:0 0 .8em;padding:2px 0 2px 14px;border-left:3px solid var(--line);color:var(--ink-2)}
.note{margin:8px 0 0;color:var(--ink-3);font-size:12px}
.dim{color:var(--ink-3)}
.scroll{overflow-x:auto}
[data-goto]{cursor:pointer}
.chart-head{display:flex;align-items:baseline;justify-content:space-between;gap:12px}
.unit{font-size:12px;color:var(--ink-3);white-space:nowrap}
.legend{display:flex;flex-wrap:wrap;gap:4px 14px;margin:0 0 6px;font-size:12px;color:var(--ink-2)}
.key{display:inline-flex;align-items:center;gap:6px}
.sw{display:inline-block;flex:none;background:var(--k)}.sw-rect{width:10px;height:10px;border-radius:2px}.sw-line{width:14px;height:2px;border-radius:1px}
svg.chart{display:block;width:100%;height:auto;overflow:visible}
.chart-fit{container-type:inline-size}.chart-fit>.fit{display:none}.chart-fit>.fit-w{display:block}
@container (max-width:1139px){.chart-fit:has(>.fit-l)>.fit-w{display:none}.chart-fit>.fit-l{display:block}}
@container (max-width:859px){.chart-fit:has(>.fit-m)>:is(.fit-w,.fit-l){display:none}.chart-fit>.fit-m{display:block}}
@container (max-width:599px){.chart-fit>:is(.fit-w,.fit-l,.fit-m){display:none}.chart-fit>.fit-s{display:block}}
svg text{font-family:inherit}
svg.chart:focus{outline:none}svg.chart:focus-visible{outline:2px solid var(--accent);outline-offset:4px;border-radius:4px}
.tick{font-size:11px;fill:var(--ink-3)}
.grid{stroke:var(--line);stroke-width:1}.base{stroke:var(--axis);stroke-width:1}
.ln{fill:none;stroke-width:2;stroke-linejoin:round;stroke-linecap:round}
.wash{fill-opacity:.12;stroke:none}
.dot{stroke:var(--plane);stroke-width:2}
.end,.val{font-size:11px;fill:var(--ink-2)}
.hit{fill:transparent}.hit:hover{fill:var(--ink);fill-opacity:.04}
.xhair{stroke:var(--axis);stroke-width:1;opacity:0;pointer-events:none}.xy.hover .xhair{opacity:1}
.pie-wrap{display:flex;align-items:center;gap:24px;flex-wrap:wrap}
svg.pie{flex:none;max-width:100%;height:auto}
.slice{stroke:var(--plane);stroke-width:2}.slice:hover{opacity:.85}
.pie-total{font-size:20px;font-weight:650;fill:var(--ink)}.pie-caption{font-size:12px;fill:var(--ink-3)}
.pie-keys{list-style:none;margin:0;padding:0;display:grid;gap:6px;font-size:13px;min-width:160px;flex:1}
.pie-keys li{display:flex;align-items:center;gap:8px}.pie-name{flex:1;color:var(--ink-2)}.pie-share{font-variant-numeric:tabular-nums}
details.data{margin-top:6px;font-size:12px;color:var(--ink-3)}details.data summary{cursor:pointer;width:max-content}
details.data table{margin-top:6px;border-collapse:collapse;font-variant-numeric:tabular-nums}
details.data th,details.data td{padding:3px 10px;border-bottom:1px solid var(--line);text-align:right;white-space:nowrap;font-weight:400}details.data th:first-child{text-align:left}
.spark{display:block;width:100%;height:32px;margin-top:6px}.spark path{fill:none;stroke:var(--ink-3);stroke-width:1.5;vector-effect:non-scaling-stroke}.spark circle{fill:var(--accent)}
.tip{position:fixed;z-index:50;pointer-events:none;max-width:300px;padding:8px 10px;border-radius:8px;background:var(--surface);color:var(--ink);border:1px solid var(--line);box-shadow:0 6px 24px rgba(0,0,0,.14);font-size:12px;line-height:1.5;white-space:pre-line}
.tip-head{color:var(--ink-3);margin-bottom:2px}
.tip-row{display:flex;align-items:center;gap:8px}.tip-row b{font-weight:650;font-variant-numeric:tabular-nums}.tip-row span{color:var(--ink-2)}
.tip-key{flex:none;width:12px;height:2px;border-radius:1px;background:var(--k)}
table.grid{width:100%;border-collapse:collapse;font-size:13px}
table.grid th{position:sticky;top:0;background:var(--plane);text-align:left;font-weight:600;color:var(--ink-2);border-bottom:1px solid var(--axis);padding:0;white-space:nowrap}
table.grid th button{all:unset;display:flex;align-items:center;gap:4px;padding:8px 10px;cursor:pointer;width:100%;box-sizing:border-box}
table.grid th button:focus-visible{outline:2px solid var(--accent);outline-offset:-2px}
th.num button{justify-content:flex-end}
.sort{font-style:normal;font-size:10px;color:var(--ink-3)}.sort::after{content:"\\2195"}th[aria-sort="ascending"] .sort::after{content:"\\2191"}th[aria-sort="descending"] .sort::after{content:"\\2193"}
table.grid td{padding:8px 10px;border-bottom:1px solid var(--line);vertical-align:top}
td.num,th.num{text-align:right;font-variant-numeric:tabular-nums}
table.grid tbody tr:hover td{background:color-mix(in srgb,var(--ink) 3%,transparent)}
.cell-meter{display:inline-block;width:64px;height:6px;border-radius:3px;background:color-mix(in srgb,var(--accent) 16%,transparent);vertical-align:middle;margin-right:8px;overflow:hidden}.cell-meter i{display:block;height:100%;background:var(--accent);border-radius:3px}
.tag{display:inline-block;padding:0 8px;margin:1px 4px 1px 0;border-radius:999px;font-size:12px;line-height:20px;background:var(--surface-2);color:var(--ink-2);white-space:nowrap}
.status{display:inline-flex;align-items:center;gap:4px;font-size:12px;line-height:20px;padding:0 8px 0 6px;border-radius:999px;white-space:nowrap;font-weight:500}
.ico{width:12px;height:12px;fill:none;stroke:currentColor;stroke-width:1.8;stroke-linecap:round;stroke-linejoin:round}
.st-ok{color:var(--ok);background:color-mix(in srgb,var(--ok) 12%,transparent)}.st-info{color:var(--info);background:color-mix(in srgb,var(--info) 12%,transparent)}.st-warn{color:var(--warn);background:color-mix(in srgb,var(--warn) 14%,transparent)}.st-bad{color:var(--bad);background:color-mix(in srgb,var(--bad) 12%,transparent)}.st-neutral{color:var(--ink-2);background:var(--surface-2)}
.metrics{display:grid;grid-template-columns:repeat(auto-fit,minmax(170px,1fr));gap:12px}
.metric{--plane:var(--surface);background:var(--surface);border:1px solid var(--line);border-radius:12px;padding:14px 16px;min-width:0}
.metric-label{font-size:12px;color:var(--ink-2)}
.metric-value{margin-top:4px;font-size:26px;font-weight:650;line-height:1.2;letter-spacing:-.01em;overflow-wrap:anywhere}
.metric-unit{margin-left:3px;font-size:13px;font-weight:500;color:var(--ink-2)}
.delta{display:inline-flex;align-items:center;gap:3px;margin-top:4px;font-size:12px;font-weight:600}.delta i{font-style:normal;font-size:9px}
.d-good{color:var(--ok)}.d-bad{color:var(--bad)}.d-flat{color:var(--ink-3)}
.metric-note{margin-top:6px;font-size:12px;color:var(--ink-3)}
.timeline{list-style:none;margin:0;padding:0}
.tl-item{position:relative;display:grid;grid-template-columns:96px 1fr;gap:4px 16px;padding:0 0 18px 22px}
.tl-item::before{content:"";position:absolute;left:4px;top:16px;bottom:0;width:2px;background:var(--line)}.tl-item:last-child::before{display:none}
.tl-dot{position:absolute;left:0;top:6px;width:10px;height:10px;border-radius:50%;background:var(--plane);border:2px solid var(--ink-3)}
.tl-done .tl-dot{background:var(--ok);border-color:var(--ok)}.tl-active .tl-dot{background:var(--info);border-color:var(--info)}.tl-risk .tl-dot{background:var(--warn);border-color:var(--warn)}
.tl-date{font-size:12px;color:var(--ink-3);padding-top:2px;font-variant-numeric:tabular-nums}
.tl-title{font-weight:600;display:flex;flex-wrap:wrap;gap:6px;align-items:center}
.tl-note{margin-top:2px;color:var(--ink-2);font-size:13px}
table.heatmap{border-collapse:separate;border-spacing:2px;font-size:12px}
table.heatmap th{font-weight:500;color:var(--ink-2);padding:4px 6px;white-space:nowrap}table.heatmap tr th:first-child{text-align:right}
td.hm{min-width:44px;height:32px;text-align:center;border-radius:4px;font-variant-numeric:tabular-nums}
table.heatmap.dense td.hm{min-width:18px;height:22px}
td.hm:hover{outline:2px solid var(--ink);outline-offset:-2px}
td.hm-empty{background:var(--surface-2);border-radius:4px}
.hm-legend{display:flex;align-items:center;gap:8px;margin-top:8px;font-size:11px;color:var(--ink-3)}.hm-scale{display:inline-flex;gap:2px}.hm-scale i{width:22px;height:8px;border-radius:2px}
.board{display:grid;grid-auto-flow:column;grid-auto-columns:minmax(220px,1fr);gap:12px;overflow-x:auto;padding-bottom:4px}
.kcol{background:var(--surface-2);border-radius:10px;padding:10px;min-width:0}
.kcol-head{display:flex;justify-content:space-between;font-size:13px;font-weight:600;margin-bottom:8px;color:var(--ink-2)}.count{color:var(--ink-3);font-weight:500}
.kcard{background:var(--surface);border:1px solid var(--line);border-radius:8px;padding:10px;margin-bottom:8px}.kcard:last-child{margin-bottom:0}
.kcard-title{font-weight:600;font-size:13px}.kcard-note{font-size:12px;color:var(--ink-2);margin-top:4px}
.kcard-meta{display:flex;flex-wrap:wrap;gap:6px;align-items:center;margin-top:8px}.kcard-meta:empty{display:none}.owner{font-size:12px;color:var(--ink-3)}
.meters{display:grid;gap:14px}
.meter-head{display:flex;justify-content:space-between;gap:12px;font-size:13px}.meter-value{font-variant-numeric:tabular-nums;color:var(--ink-2)}
.meter{height:8px;border-radius:4px;background:color-mix(in srgb,var(--accent) 16%,transparent);margin-top:6px;overflow:hidden}.meter i{display:block;height:100%;border-radius:4px;background:var(--accent)}
.meter-note{font-size:12px;color:var(--ink-3);margin-top:4px}
.callout{border-radius:10px;padding:12px 14px;display:grid;gap:4px;background:var(--surface-2)}
.co-info{background:color-mix(in srgb,var(--info) 9%,var(--plane))}.co-ok{background:color-mix(in srgb,var(--ok) 9%,var(--plane))}.co-warn{background:color-mix(in srgb,var(--warn) 10%,var(--plane))}.co-danger{background:color-mix(in srgb,var(--bad) 9%,var(--plane))}
.callout>.status{background:none;padding:0;font-weight:650;font-size:13px}
.callout .prose{font-size:14px}
.list{margin:0;padding-left:1.4em;font-size:14px}.list li{margin:.3em 0}
.checklist{list-style:none;padding-left:0}.checklist li{display:flex;gap:8px;align-items:flex-start}
.check{flex:none;width:16px;height:16px;margin-top:3px;border-radius:4px;border:1.5px solid var(--axis)}
.checklist li.done .check{background:var(--ok);border-color:var(--ok)}
.checklist li.done .check::after{content:"";display:block;width:4px;height:8px;margin:1px 0 0 4.5px;border:solid #fff;border-width:0 2px 2px 0;transform:rotate(45deg)}
.checklist li.done{color:var(--ink-3)}
.quote{margin:0;padding:6px 0 6px 18px;border-left:3px solid var(--accent)}.quote p{margin:0;font-size:18px;line-height:1.6}.quote footer{margin-top:6px;font-size:13px;color:var(--ink-3)}
pre.code{margin:0;padding:14px 16px;border-radius:10px;background:var(--surface-2);overflow-x:auto;font-size:12.5px;line-height:1.6}pre.code code{background:none;padding:0}
.figure{margin:0}.figure img{display:block;max-width:100%;width:100%;object-fit:cover;border-radius:10px}.figure figcaption{margin-top:6px;font-size:12px;color:var(--ink-3);text-align:center}
.img-ph{display:grid;place-items:center;min-height:140px;border-radius:10px;background:repeating-linear-gradient(135deg,var(--surface-2) 0 10px,var(--plane) 10px 20px);color:var(--ink-3);font-size:12px;border:1px dashed var(--axis)}
.divider{border:0;border-top:1px solid var(--line);margin:4px 0}
.free{overflow-x:auto}
.graph-wrap{overflow-x:auto}svg.graph{display:block;max-width:100%;height:auto;margin:0 auto}.mode-export svg.graph,.slide svg.graph,.poster svg.graph{min-width:0!important}@media print{svg.graph{min-width:0!important}}
.nd{fill:var(--surface);stroke:var(--axis);stroke-width:1.2}.nd-accent{fill:color-mix(in srgb,var(--accent) 12%,var(--surface));stroke:var(--accent)}.nd-cloud{stroke-dasharray:5 4}.nd-rim{fill:none;stroke:var(--axis);stroke-width:1.2}.nd-glyph{fill:var(--ink-3)}
.nd-label{font-size:13px;fill:var(--ink);font-weight:500}.nd-note{font-size:11px;fill:var(--ink-3)}
.grp{fill:color-mix(in srgb,var(--accent) 5%,transparent);stroke:color-mix(in srgb,var(--accent) 35%,transparent);stroke-width:1}.grp-label{font-size:12px;font-weight:600;fill:var(--ink-2)}
.edge{fill:none;stroke:var(--ink-3);stroke-width:1.4}.edge-dashed{stroke-dasharray:5 4}.arrow{fill:var(--ink-3)}
.edge-bg{fill:var(--plane)}.edge-label{font-size:11px;fill:var(--ink-2)}
.k-diagram .b-diagram,.k-diagram .b-flow{padding:8px 0}
@media (max-width:720px){.blk{grid-column:span 12!important}.page{padding:24px 16px 48px}.tl-item{grid-template-columns:1fr}}
.mode-export details.data{display:none}
@media print{body{background:#fff}.page{padding:0;max-width:none}.card,.metric,.kcard{break-inside:avoid}details.data{display:none}}
`
