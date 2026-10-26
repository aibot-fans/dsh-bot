# 开发说明

## 目录

```
packages/
  domain/   pod-domain   领域类型和规则（计划校验、打分、中文切分、cron、站点规则、读写判断、评分卡……），纯 TypeScript
  store/    pod-store    node:sqlite 表结构、迁移和读写
  runtime/  pod-runtime  宿主插件：/api/pod 接口、会话和工具、编排、记忆、搜索、例程、共用浏览器、页面、aibot、自我优化
  ui/       pod-ui       浏览器插件：侧栏入口和主页面（React，由 dsh web 外壳提供）
  bundle/   pod-bundle   组合包：cordis.patch.yml 插入上面两个插件和 dsh-bot 的 agent 预设
dev/mock-llm/            开发用的脚本化模型（只装进开发用的 DSH_HOME），demo.js 和 demo-browser.js 是 README 截图用的演示剧本
dev/demo-oa.mjs          浏览器截图用的示例 OA（一个会议室预订页）
scripts/dev-home.mjs     在隔离的 DSH_HOME 里装上并启动 dsh-bot
scripts/pack-npm.mjs     打 npm 包 @aibot_fans/dsh-bot：把 runtime、ui、bundle 合成一个包，输出到 dist/
scripts/set-version.mjs  改版本号：POD_VERSION 和各包 package.json 一起改
scripts/version.mjs      上面两个脚本共用的版本号读法
docs/                    使用说明、开发说明；images/ 是 README 的截图
```

## 构建和检查

需要 Node 24 和 pnpm。

```bash
pnpm install
```

```bash
pnpm build
```

```bash
pnpm typecheck
```

```bash
pnpm test
```

`pnpm build` 用 tsdown 把各包打到 `packages/*/lib`，每次先清空。

## 在隔离环境里试

不碰 `~/.dsh`，也不占用平时的 3080 端口。开发用的 dsh 目录默认在 `.dev/`，可以用 `POD_DEV_ROOT` 换位置，端口用 `POD_DEV_PORT` 换（默认 3190）。开发环境装了脚本化模型 `pod-mock/scripted`，不连外部服务也能跑通委派、组队、等你处理、浏览器审批、复盘等流程。

```bash
pnpm dev:install
```

```bash
pnpm dev:web
```

启动后终端会打印带 `?token=` 的地址，用它打开页面。设 `POD_DEBUG=1` 可以在终端里看到 dsh-bot 的警告。

README 的截图用的是演示剧本（`dev/mock-llm/demo.js`）：先建好「数据研究员」「增长分析师」和「设计师」（设计师预设）三个 bot，再跟主管说“帮我做第三季度的增长复盘”。主管会组一个临时小组，两个成员同时整理数据和做留存分析，设计师接着做看板，主管验收后交付；每一步停几秒，任务卡上看得到进度。数字都是编的示例数据。

浏览器那张用 `dev/mock-llm/demo-browser.js`：建一个「行政助理」bot（研究档案，人设以“角色：行政助理”开头），跟它说订会议室。它在示例 OA 上打开预订页、一项一项填好，点“提交预订”时 dsh-bot 转成审批，等你批准。示例 OA 用保留给文档的域名 `oa.example.com`，截图前先在本机起预订页：

```bash
node dev/demo-oa.mjs
```

再写一个 Chrome 启动脚本，在演示环境设置的「浏览器」页把 Chrome 路径换成它。`--host-resolver-rules` 把这个域名指到本机 8125 端口；本机开了代理时，Chrome 会把请求交给代理，映射就不生效，所以还要加 `--no-proxy-server`：

```sh
#!/bin/sh
exec "/Applications/Google Chrome.app/Contents/MacOS/Google Chrome" --no-proxy-server --host-resolver-rules="MAP oa.example.com 127.0.0.1:8125" "$@"
```

## 从源码装进平时用的 dsh web

构建以后，把组合包以 `link:` 装进 `web` profile，路径换成仓库的绝对路径：

```bash
dsh plugin --profile web add link:/仓库的绝对路径/packages/bundle
```

之后改完代码 `pnpm build`，重启 dsh web 就生效。源码装的叫 `pod-bundle`，从 npm 装的叫 `@aibot_fans/dsh-bot`（改名前叫 `ds-pod`），两边各行的 id 一样，同一个 profile 里只能装一个，换之前先 `dsh plugin --profile web remove` 掉另一个。

## 发版本

- 版本号的源头是 `packages/domain/src/version.ts` 的 `POD_VERSION`，宿主和页面各打包一份，npm 包的版本号也取它；各包 package.json 的版本号跟着它，用 `pnpm version:set <版本>` 一起改。页面发现宿主报的版本和自己不一样，就在顶部提示刷新：dsh web 重启以后，之前打开的标签页还是旧页面，旧页面调的接口可能已经换了。
- 改了表结构就在 `packages/store/src/migrations.ts` 里加一版迁移，启动时自动迁移。
- 改完 `pnpm build`，重启 dsh web。宿主和页面的代码都是启动时读进内存的，不重启不生效。
- 打 npm 包用 `pnpm pack:npm`：先构建，再把 runtime、ui、bundle 合成一个包 `@aibot_fans/dsh-bot`，输出 `dist/aibot_fans-dsh-bot-<版本>.tgz`。包里浏览器插件那一行就叫 `@aibot_fans/dsh-bot`（dsh 只按精确的包名找 `./client`），宿主插件和 agent 是 `@aibot_fans/dsh-bot/runtime`、`@aibot_fans/dsh-bot/agent`；各行的 id 和源码装的一样。各包的版本号和 `POD_VERSION` 对不上时会停下。
- 发布前可以在隔离环境里装这个 tgz 试一遍：`DSH_HOME=<临时目录> dsh plugin --profile web add <tgz 的绝对路径>`，启动时记得用 `--patch` 把 `workspaceRoot` 也指到临时目录，不然 bot 的工作区会用 `~/Pod`。

### 发布步骤

一个版本的 git 标签 `v<版本>`、npm 包和 GitHub Release 都指向同一个提交。

1. 在 `CHANGELOG.md` 最上面加这个版本的一节，标题写成 `## <版本> - <日期>`：新功能、修复、升级时要注意的。
2. `pnpm version:set <版本>`，提交 `chore(release): v<版本>`，再打标签：`git tag -a v<版本> -m "v<版本>"`。
3. `pnpm release:pack`：构建并打包，输出 `dist/aibot_fans-dsh-bot-<版本>.tgz`。工作区有没提交的改动、当前提交没有 `v<版本>` 标签、版本号对不上，或者 CHANGELOG 里没有这一节，都会停下。
4. 推送提交和标签：`git push origin main --follow-tags`。
5. 发到 npm：先 `npm login`（npm 要求发包的账号开两步验证，发布时会要验证码），再 `npm publish ./dist/aibot_fans-dsh-bot-<版本>.tgz --access public`（路径前面的 `./` 不能省，不然 npm 会把它当成 GitHub 仓库的简写；带作用域的包默认是私有的，要 `--access public`，包里的 package.json 也写了 `publishConfig`）。
6. 在 GitHub 仓库的 Releases 里选 `v<版本>` 标签新建发布，标题写 `v<版本>`，正文贴 CHANGELOG 里这一节。

## 给其他插件的接口

dsh-bot 以 `ctx.pod` 提供服务：

- `ctx.pod.bots`：读取 bot；`ctx.pod.teams`：读取团队。
- `ctx.pod.rooms.post(roomId, { author, kind, body, data })`：往房间里发消息。
- `ctx.pod.createTask({ bot, title, brief, acceptance?, deliverable? })`：以主管的名义把一件事交给某个 bot；用 `pod/task-updated` 事件跟踪（每次任务变化都会发）。
- `ctx.pod.registerTool({ applies, create })`：给 bot 会话加工具，只出现在 bot 会话里。
- `ctx.pod.registerTemplate(template)`：注册团队模板，出现在“按模板新建”里。

## 实现说明

- **前后端通信**：页面调 `/api/pod/*`，路由注册在 dsh connection 的 `/api` 通道上，先过 dsh 自己的来源和登录校验。宿主不认识的地址回纯文字的 404，页面据此提示刷新。实时推送用 SSE（`/api/pod/events`，浏览器画面另有 `/api/pod/browser/frames`）；宿主重启后页面收到 resync，整页重新拉数据。
- **bot 会话**：`ctx.sessionController.create` 在 dsh-bot 登记的工作区（`~/Pod`）里建会话；`agent/created` 时按会话装人设、工具、拒绝规则和技能（技能用 dsh 技能注册表在 agent 作用域注册）。
- **不安装 dsh 的包**：用到的 dsh 接口写成最小的结构类型，在 `packages/runtime/src/dsh.ts` 和 `packages/ui/src/client/dsh.ts`；dsh 升级时先核对这两个文件。启动时检查接口，缺了就进只读模式。
- **共用浏览器**：直接用 CDP 驱动本机 Chrome，走 `--remote-debugging-pipe`，不开调试端口。
- **名字颜色**：存 `#rrggbb`，在 OKLCH 里随机取（`packages/domain/src/bot-colors.ts`）：色相随便，明暗限在 0.56 到 0.64、饱和度限在 0.09 到 0.16；界面上再按 3:1 和文字颜色调一调，任何色相在白底和深色底上的对比度都在 4.7 以上。接口传进来的颜色也会拉回看得清的范围。换配法时改 `BOT_COLOR_SCHEME`，启动时老 bot 全部重新随机一次。
- **页面**：bot 交的是组件数据（JSON），dsh-bot 在服务端画成 HTML 和 SVG，由 `/api/pod/page/view` 提供；响应头的 CSP 只放行内联样式和按哈希认的组件脚本，不许任何网络请求，页面放在 `sandbox="allow-scripts"`（不同源）的 iframe 里，深浅色用 postMessage 告诉它。PDF 和长图用共用浏览器的隐藏标签页生成（`/api/pod/page/export`）。
- **浏览器端打包**：tsdown 输出 CommonJS，外面包一层 `window.__ModuleLoader__.load({ id: 'pod-ui', factory })`；react 由外壳提供。
