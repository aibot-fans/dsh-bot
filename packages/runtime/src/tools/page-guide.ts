import { PAGE_KIND_LABELS, type PageKind } from 'pod-domain'

/**
 * page_guide 给 bot 看的写法说明：页面结构、组件清单和每种页面的模板。
 * 放在工具里按需读，不塞进人设，平时不占上下文。
 */

const BASICS = [
  '页面存的是组件数据，不是 HTML：dsh-bot 负责排版、配色（跟着 dsh-bot 的深浅色自动切换）和交互（悬停看数值、表格排序、幻灯片翻页、原型跳转）。你只填数据和文字。',
  'save_page 的参数：title、kind、note（这一版改了什么）、subtitle（副标题，可选）、accent（主色：blue / teal / green / orange / red / purple / gray，默认 blue），再加按种类要写的 blocks、slides、screens、poster。',
  '更新已有页面：先 get_page 读出当前内容，改好后 save_page 带上 id 整份保存（不是只传改动的部分）。每次保存都是新的一版，用户能看旧版本、能回滚。',
  '保存失败会告诉你哪个组件哪个字段有问题（比如 blocks[3]（chart）：没有 series），照着改了再存。',
].join('\n')

const BLOCKS = `组件（blocks 里的每一项）都写 type，再加各自的字段。看板和跟踪表里用 width 排版：full 整行、half 半行、third 三分之一、two-thirds 三分之二、quarter 四分之一，默认 full。
- heading：{"type":"heading","text":"小标题","level":2}
- text：{"type":"text","text":"Markdown 正文：**粗体**、*斜体*、[链接](https://example.com)、- 列表、## 小标题"}
- metrics（一排指标卡）：{"type":"metrics","items":[{"label":"本月收入","value":"128.4","unit":"万","delta":"+12%","good":"up","trend":[90,96,110,128],"note":"对比上月"}]}
  good：up 表示涨是好事，down 表示跌是好事，none 不分好坏；trend 是小折线，可以不写
- chart：{"type":"chart","chart":"line","title":"每周新增","labels":["W1","W2","W3"],"series":[{"name":"渠道 A","values":[3,4,6]},{"name":"渠道 B","values":[2,2,3]}],"unit":"千人"}
  chart 是 line / bar / area / pie；只有一组数据时直接写 values；stacked: true 堆叠，horizontal: true 横向柱
  最多 8 组数据，颜色按顺序自动分配；单位不同的数据拆成两张图，不要两个纵轴；饼图只表示占比，超过 8 块的自动并成“其他”
- table：{"type":"table","title":"明细","columns":[{"label":"项目"},{"label":"金额","type":"money"},{"label":"状态","type":"status"}],"rows":[["官网改版",12000,"进行中"]]}
  列的 type：text、number、money、percent（写 12.5 表示 12.5%）、date、status（完成、进行中、有风险、受阻这类词自动配图标和颜色）、progress（0 到 100）、tag。表头能点击排序
- timeline：{"type":"timeline","title":"里程碑","items":[{"date":"7月","title":"新版上线","status":"done","note":"首页改版"}]}；status 是 done / active / todo / risk
- heatmap：{"type":"heatmap","title":"月度收益","rows":["2024","2025"],"columns":["1月","2月"],"values":[[1.2,-0.8],[0.3,2.1]],"unit":"%"}；有正有负时自动用两种颜色
- board（任务栏）：{"type":"board","title":"任务","columns":[{"title":"进行中","cards":[{"title":"支付回调","tag":"后端","owner":"小王","status":"有风险","note":"等对方接口"}]}]}
- progress：{"type":"progress","title":"整体进度","items":[{"label":"后端","value":80},{"label":"测试用例","value":12,"max":40}]}
- callout：{"type":"callout","tone":"warn","title":"注意","text":"渠道 B 的成本连续两个月上升"}；tone 是 info / ok / warn / danger
- list：{"type":"list","style":"check","items":[{"text":"整理数据","done":true},"更新投放策略"]}；style 是 bullet / number / check
- quote：{"type":"quote","text":"先把一件事做到极致。","by":"团队共识"}
- code：{"type":"code","code":"print(1)","language":"python"}
- image：{"type":"image","src":"charts/funnel.png","alt":"转化漏斗","caption":"十月数据"}
  src 写工作区里的图片文件（相对路径先按你的文件夹找），PNG / JPG / GIF / WebP / SVG，单张 2 MB 以内；页面不联网，不能写网址，网上的图先下载下来
- divider：{"type":"divider"}
- flow（流程图）和 diagram（架构图、关系图）：{"type":"diagram","title":"系统架构","direction":"right","groups":[{"id":"svc","label":"服务层"}],"nodes":[{"id":"api","label":"API 网关","group":"svc"},{"id":"db","label":"MySQL","shape":"database"}],"edges":["api -> db",{"from":"api","to":"mq","label":"异步","dashed":true}]}
  不用写坐标，自动排版；shape 是 box / round / database / person / cloud / start / end / decision；direction 是 down（从上到下）或 right（从左到右）；节点 40 个以内最清楚
- html：{"type":"html","html":"<table>…</table>"}；只在别的组件都表达不了时用，不能有脚本、样式表和外部资源`

const KINDS: Readonly<Record<PageKind, string>> = {
  report: `报告（report）：一列排版，适合周报、分析、调研结论。写 blocks。
建议结构：结论先行（callout 或 text）→ 关键数字（metrics）→ 图表加一两句解读 → 明细表 → 下一步（list，style 用 check）。
模板：{"title":"十月增长复盘","kind":"report","subtitle":"新增、留存和下一步","blocks":[{"type":"callout","tone":"info","title":"结论","text":"新增 12.4 万，环比 +18%；留存持平。"},{"type":"metrics","items":[{"label":"新增用户","value":"12.4","unit":"万","delta":"+18%"},{"label":"次月留存","value":"41","unit":"%","delta":"0%","good":"none"}]},{"type":"chart","chart":"line","title":"每周新增","labels":["W1","W2","W3","W4"],"values":[2.6,2.9,3.3,3.6],"unit":"万"},{"type":"text","text":"## 原因\\n渠道 A 的投放……"},{"type":"list","style":"check","items":["调整渠道 B 预算","上线新手引导"]}]}`,
  dashboard: `看板（dashboard）：卡片网格（12 栏），适合指标监控、经营数据。写 blocks，用 width 排。
建议结构：最上面一排 metrics（4 到 6 个关键数字）→ 主图 two-thirds 加辅图 third → 两张 half 并排 → 明细表 full。每张图只回答一个问题，标题直接写结论或问题。
模板：{"title":"销售看板","kind":"dashboard","subtitle":"每天 9 点更新","blocks":[{"type":"metrics","items":[{"label":"本月销售额","value":"328","unit":"万","delta":"+12%","trend":[210,240,280,328]},{"label":"订单数","value":"4,210","delta":"+6%"},{"label":"客单价","value":"779","unit":"元","delta":"-2%"},{"label":"退款率","value":"1.8","unit":"%","delta":"-0.3%","good":"down"}]},{"type":"chart","chart":"area","title":"每日销售额","width":"two-thirds","labels":["1日","2日","3日"],"values":[9.8,11.2,10.5],"unit":"万"},{"type":"chart","chart":"pie","title":"渠道占比","width":"third","labels":["线上","门店","分销"],"values":[52,31,17],"unit":"%"},{"type":"table","title":"重点客户","columns":[{"label":"客户"},{"label":"金额","type":"money"},{"label":"状态","type":"status"}],"rows":[["华东一部",128000,"正常"]]}]}`,
  tracker: `跟踪表（tracker）：项目和任务进度。写 blocks，常用 progress、board、table（带 status 列）、timeline。
模板：{"title":"发布跟踪","kind":"tracker","blocks":[{"type":"progress","title":"整体进度","width":"third","items":[{"label":"后端","value":80},{"label":"前端","value":55}]},{"type":"board","title":"任务","width":"two-thirds","columns":[{"title":"待办","cards":[{"title":"支付回调","owner":"小王"}]},{"title":"进行中","cards":[{"title":"订单页","status":"有风险","note":"等设计稿"}]},{"title":"完成","cards":[{"title":"登录"}]}]},{"type":"timeline","title":"里程碑","items":[{"date":"11-01","title":"提测","status":"active"},{"date":"11-15","title":"上线","status":"todo"}]}]}`,
  slides: `幻灯片（slides）：16:9（1280×720），写 slides 数组，每页 {layout, title, subtitle, blocks, right, notes}。
layout：title 封面、section 章节页、content 标题加内容、two-column 左右两栏（blocks 在左，right 在右）、quote 金句、end 结束页。不写时第一页是封面，有 right 的是两栏，其他是 content。
每页只讲一件事：不超过 6 行字，或一张图，或一排 metrics；notes 写演讲备注（放映时可以打开看）。第一页用 title，最后一页用 end。
模板：{"title":"Q4 产品规划","kind":"slides","slides":[{"layout":"title","title":"Q4 产品规划","subtitle":"三个重点和时间表"},{"layout":"content","title":"三个重点","blocks":[{"type":"list","items":["会员体系上线","海外试点","首屏 1 秒内"]}],"notes":"先讲会员"},{"layout":"two-column","title":"数据","blocks":[{"type":"metrics","items":[{"label":"日活","value":"42 万","delta":"+8%"}]}],"right":[{"type":"chart","chart":"bar","labels":["7月","8月","9月"],"values":[36,39,42],"unit":"万"}]},{"layout":"quote","title":"先把一件事做到极致。","subtitle":"团队共识"},{"layout":"end","title":"谢谢","subtitle":"欢迎提问"}]}`,
  poster: `海报（poster）：一张图，写 poster 和可选的 blocks（放在中间，适合一排 metrics、一个 list 或一张 image）。
poster：size（a4 794×1123、portrait 1080×1350、square 1080×1080、landscape 1600×900、story 1080×1920）、eyebrow（顶上的小字）、headline（大标题，20 字以内最好）、subheadline（时间地点等）、footer（底部一行）、background（accent 主色、light 浅色、dark 深色、gradient 渐变）。配色用 accent。
模板：{"title":"黑客松招募","kind":"poster","accent":"purple","poster":{"size":"portrait","eyebrow":"HACKATHON 2026","headline":"48 小时，做出你的第一个 AI 应用","subheadline":"11 月 15-16 日 · 线下 + 线上","footer":"扫码报名 · 截止 11 月 10 日","background":"gradient"},"blocks":[{"type":"metrics","items":[{"label":"参赛队伍","value":"120+"},{"label":"奖金","value":"10 万"}]}]}`,
  prototype: `原型（prototype）：可点击的界面原型。写 screens 数组（每屏 {id, title, blocks}）和 device（phone / tablet / desktop，默认 phone）。
界面组件：appbar {title, back: 返回到的屏 id, actions: ["筛选"]}（放最前，固定在顶上）、tabbar {items: [{label, goto, active}]}（放最后，固定在底部）、button {label, variant: primary / secondary / ghost / danger}、input {label, placeholder, value, multiline}、toggle {label, on, note}、card {title, text, meta, tag}、rows {items: [{title, subtitle, meta, goto}]}、segmented {items, active}；也能用 metrics、list、image、chart、text。
任何组件写 goto: 屏 id，点了就跳过去；所有 goto 和 back 都要指向存在的屏。
模板：{"title":"记账 App","kind":"prototype","device":"phone","screens":[{"id":"home","title":"首页","blocks":[{"type":"appbar","title":"本月账单","actions":["筛选"]},{"type":"metrics","items":[{"label":"本月支出","value":"¥3,240","delta":"-12%","good":"down"}]},{"type":"rows","items":[{"title":"午餐","subtitle":"餐饮 · 今天","meta":"-¥32","goto":"detail"}]},{"type":"button","label":"记一笔","goto":"add"},{"type":"tabbar","items":[{"label":"账单","active":true,"goto":"home"},{"label":"我的","goto":"me"}]}]},{"id":"add","title":"记一笔","blocks":[{"type":"appbar","title":"记一笔","back":"home"},{"type":"input","label":"金额","placeholder":"0.00"},{"type":"button","label":"保存","goto":"home"}]},{"id":"detail","title":"详情","blocks":[{"type":"appbar","title":"午餐","back":"home"},{"type":"card","title":"¥32.00","text":"公司楼下的面馆","meta":"10-24 12:10"}]},{"id":"me","title":"我的","blocks":[{"type":"appbar","title":"我的"},{"type":"rows","items":[{"title":"预算设置"}]},{"type":"tabbar","items":[{"label":"账单","goto":"home"},{"label":"我的","active":true}]}]}]}`,
  diagram: `图示（diagram）：架构图、流程图、关系图。写 blocks，放一张或几张 diagram / flow，配 text 或 callout 说明。
架构图用 groups 分层（接入层、服务层、数据层），同组的节点框在一起；流程图用 flow，开始和结束用 start / end，判断用 decision，连线写 label 说明条件（是 / 否）。流程长的用 direction: right，层级多的用 down。
模板：{"title":"系统架构","kind":"diagram","blocks":[{"type":"diagram","direction":"right","groups":[{"id":"edge","label":"接入层"},{"id":"svc","label":"服务层"},{"id":"data","label":"数据层"}],"nodes":[{"id":"user","label":"用户","shape":"person"},{"id":"gw","label":"API 网关","group":"edge"},{"id":"order","label":"订单服务","group":"svc"},{"id":"db","label":"MySQL","shape":"database","group":"data"}],"edges":["user -> gw",{"from":"gw","to":"order","label":"HTTP"},"order -> db"]},{"type":"flow","title":"下单流程","nodes":[{"id":"s","label":"开始","shape":"start"},{"id":"c","label":"库存够吗？","shape":"decision"},{"id":"o","label":"创建订单"},{"id":"e","label":"结束","shape":"end"}],"edges":["s -> c",{"from":"c","to":"o","label":"够"},"o -> e"]}]}`,
}

const OVERVIEW = `七种页面：${Object.entries(PAGE_KIND_LABELS)
  .map(([kind, label]) => `${kind}（${label}）`)
  .join('、')}。
- 报告、看板、跟踪表、图示写 blocks；幻灯片写 slides；原型写 screens；海报写 poster。
- 用户要设计类的东西（幻灯片、海报、原型、架构图）时，先想清楚给谁看、要传达什么，再选模板填内容；用 page_guide 加 kind 看对应种类的模板。`

/** 某种页面的写法；不给种类时给总览和组件清单。 */
export function pageGuide(kind: PageKind | undefined): string {
  return kind === undefined ? [BASICS, OVERVIEW, BLOCKS].join('\n\n') : [BASICS, KINDS[kind], BLOCKS].join('\n\n')
}
