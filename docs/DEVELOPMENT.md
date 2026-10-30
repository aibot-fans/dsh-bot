# 开发说明

## 目录

```
packages/
  domain/   pod-domain   领域类型和规则（计划校验、打分、中文切分、cron、站点规则、读写判断、评分卡……），纯 TypeScript
  store/    pod-store    node:sqlite 表结构、迁移和读写
  runtime/  pod-runtime  宿主插件：/api/pod 接口、会话和工具、编排、记忆、搜索、例程、共用浏览器、页面、aibot、自我优化
  ui/       pod-ui       浏览器插件：侧栏入口和主页面（React，由 dsh web 外壳提供）
  bundle/   pod-bundle   组合包：cordis.patch.yml 插入上面两个插件和 dsh-bot 的 agent 预设
dev/mock-llm/               开发用的脚本化模型（只装进开发用的 DSH_HOME），demo.js 和 demo-browser.js 是 README 截图用的演示剧本，剧本的中英文内容在 demo-zh.js、demo-en.js
dev/demo-oa.mjs             浏览器截图用的示例 OA（一个会议室预订页，加 --en 是英文版）
scripts/dev-home.mjs        在隔离的 DSH_HOME 里装上并启动 dsh-bot
scripts/pack-npm.mjs        打 npm 包 @aibot_fans/dsh-bot：把 runtime、ui、bundle 合成一个包，输出到 dist/
scripts/set-version.mjs     改版本号：POD_VERSION 和各包 package.json 一起改
scripts/github-release.mjs  按 CHANGELOG 建和更新 GitHub Release（推送后由 .github/workflows/release.yml 运行）
scripts/changelog.mjs       取 CHANGELOG 里一个版本的说明：GitHub Release 的正文和 npm 包里的更新说明都用它
scripts/version.mjs         上面几个脚本共用的仓库路径和版本号读法
docs/                       使用说明、开发说明；images/ 是 README 的截图
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

英文截图：先在设置的「通用」里把语言改成 English（或者用英文的浏览器打开，语言保持“跟随 dsh”），剧本就换成英文版。三个 bot 叫 Data Researcher、Growth Analyst 和 Designer（设计师预设的英文版），跟主管说 “Put together our Q3 growth review: core metrics and new-user retention, plus a one-page dashboard for Friday’s meeting.”。英文截图放在 `docs/images/en/`，文件名和 `docs/images/` 里对应的中文截图一样，`README.en.md` 用的是这些。

浏览器那张用 `dev/mock-llm/demo-browser.js`：建一个「行政助理」bot（研究档案，人设以“角色：行政助理”开头），跟它说订会议室。它在示例 OA 上打开预订页、一项一项填好，点“提交预订”时 dsh-bot 转成审批，等你批准。英文版的助理叫 Office Assistant，人设以“Role: office assistant”开头，跟它说订 meeting room，示例 OA 用 `--en` 起英文版。示例 OA 用保留给文档的域名 `oa.example.com`，截图前先在本机起预订页：

```bash
node dev/demo-oa.mjs
```

再写一个 Chrome 启动脚本，在演示环境设置的「浏览器」页把 Chrome 路径换成它。`--host-resolver-rules` 把这个域名指到本机 8125 端口；本机开了代理时，Chrome 会把请求交给代理，映射就不生效，所以还要加 `--no-proxy-server`：

```sh
#!/bin/sh
exec "/Applications/Google Chrome.app/Contents/MacOS/Google Chrome" --no-proxy-server --host-resolver-rules="MAP oa.example.com 127.0.0.1:8125" "$@"
```

试新版本提醒和一键更新：`pnpm dev:install` 装的是源码（`link:`），弹窗里只给命令，不给按钮。要试一键更新，在临时的 DSH_HOME 里装打好的 tgz（见「发版本」），本机起一个假的 npm 源放几个版本的 tgz：启动 dsh web 时设 `POD_UPDATE_REGISTRY` 把查新版本指到它（多个源用逗号隔开），profile 目录（`$DSH_HOME/profiles/web`）的 `.npmrc` 也写上 `registry=` 这个源，dsh 才会从那里装。版本号比装着的大、发布满一天的才能一键更新（pnpm 的 `minimumReleaseAge`），不满的弹窗里只说什么时候能装。要试关了热更新、装好要重启的那条路，`--patch` 的文件里加一项：

```yaml
- id: hmr
  disabled: true
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
- 打 npm 包用 `pnpm pack:npm`：先构建，再把 runtime、ui、bundle 合成一个包 `@aibot_fans/dsh-bot`，输出 `dist/aibot_fans-dsh-bot-<版本>.tgz`。包里浏览器插件那一行就叫 `@aibot_fans/dsh-bot`（dsh 只按精确的包名找 `./client`），宿主插件和 agent 是 `@aibot_fans/dsh-bot/runtime`、`@aibot_fans/dsh-bot/agent`；各行的 id 和源码装的一样。各包的版本号和 `POD_VERSION` 对不上时会停下。包里的 package.json 带上 CHANGELOG 里这个版本的一节（`releaseNotes` 字段），dsh-bot 的更新弹窗显示的就是它，所以要先写好 CHANGELOG 再打包；没有这一节就不带，弹窗里让去 GitHub 上看。
- 发布前可以在隔离环境里装这个 tgz 试一遍：`DSH_HOME=<临时目录> dsh plugin --profile web add <tgz 的绝对路径>`，启动时记得用 `--patch` 把 `workspaceRoot` 也指到临时目录，不然 bot 的工作区会用 `~/Pod`。

### 发布步骤

一个版本的 git 标签 `v<版本>`、npm 包和 GitHub Release 都指向同一个提交。

1. 在 `CHANGELOG.md` 最上面加这个版本的一节，标题写成 `## <版本> - <日期>`：新功能、修复、升级时要注意的。平时的改动先记在最上面的「## 未发布」一节里，发版时把这个标题改成版本号和日期。
2. `pnpm version:set <版本>`，提交 `chore(release): v<版本>`，再打标签：`git tag -a v<版本> -m "v<版本>"`。
3. `pnpm release:pack`：构建并打包，输出 `dist/aibot_fans-dsh-bot-<版本>.tgz`。工作区有没提交的改动、当前提交没有 `v<版本>` 标签、版本号对不上，或者 CHANGELOG 里没有这一节，都会停下。
4. 推送提交和标签：`git push origin main --follow-tags`。推上去以后 GitHub Actions（`.github/workflows/release.yml`）自动给新标签建 Release：标题是 `v<版本>`，正文取 main 上 CHANGELOG 里这一节，版本号最大的标成 Latest。之后改了 CHANGELOG 里哪个版本的说明，推送后那个 Release 的正文也跟着改（在 Release 页面上手改的会被覆盖），标题和 Latest 不动。推送前想先看会建、会改什么，本机跑 `node scripts/github-release.mjs --dry`（按工作区里的 CHANGELOG）。
5. 发到 npm：先 `npm login`，再 `npm publish ./dist/aibot_fans-dsh-bot-<版本>.tgz --access public`（路径前面的 `./` 不能省，不然 npm 会把它当成 GitHub 仓库的简写；带作用域的包默认是私有的，要 `--access public`，包里的 package.json 也写了 `publishConfig`）。npm 要求发包的账号开两步验证：登录、发布和 `npm deprecate` 时命令行会给一个网址，在浏览器里确认，几分钟内不确认就失效，要重跑。

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
- **读写 X**（`packages/runtime/src/x/`）：接口目录、发请求、传文件和读加密聊天用 npm 上的 aibot-x-post（不开源），tsdown 把它和 jq-wasm 打进 lib/index.js，jq.wasm 拷到 lib/x/。dsh-bot 这边是接入的部分：账号和不在面板里显示的标签页（`account.ts`，aibot-x-post 要的 addInitScript、evaluate、goto 用共用浏览器的标签页实现）、写操作审批（`writes.ts`、`actions.ts`）、附件（`media.ts`）、存响应和 jq 过滤（`responses.ts`）；x_ 工具在 `tools/x.ts`，给 bot 的说明是 `guide.ts` 的补充加上 aibot-x-post 带的用法。
- **名字颜色**：存 `#rrggbb`，在 OKLCH 里随机取（`packages/domain/src/bot-colors.ts`）：色相随便，明暗限在 0.56 到 0.64、饱和度限在 0.09 到 0.16；界面上再按 3:1 和文字颜色调一调，任何色相在白底和深色底上的对比度都在 4.7 以上。接口传进来的颜色也会拉回看得清的范围。换配法时改 `BOT_COLOR_SCHEME`，启动时老 bot 全部重新随机一次。
- **页面**：bot 交的是组件数据（JSON），dsh-bot 在服务端画成 HTML 和 SVG，由 `/api/pod/page/view` 提供；响应头的 CSP 只放行内联样式和按哈希认的组件脚本，不许任何网络请求，页面放在 `sandbox="allow-scripts"`（不同源）的 iframe 里，深浅色用 postMessage 告诉它。PDF 和长图用共用浏览器的隐藏标签页生成（`/api/pod/page/export`）。
- **浏览器端打包**：tsdown 输出 CommonJS，外面包一层 `window.__ModuleLoader__.load({ id: 'pod-ui', factory })`；react 由外壳提供。
- **新版本和一键更新**（`packages/runtime/src/update/`）：宿主启动一分钟后问一次 npm，之后每 6 小时一次，查到的版本和各版的 `releaseNotes` 记在数据库里；比正在跑的新、又满足 profile 里 pnpm 的 `minimumReleaseAge`（pnpm 11 默认一天，读 profile 的 `pnpm-workspace.yaml`）的，才算能更新。运行文件往上两级的 package.json 是 `@aibot_fans/dsh-bot` 才算从 npm 装的，源码装的只给命令。一键更新交给 dsh 的插件管理：先 `removeBundle` 卸旧版，再 `installBundle` 装新版；新版没装上就装回旧版。卸旧版时 dsh-bot 自己的上下文就没了，所以用插件管理服务背后的原对象（`Symbol.for('cordis.original')`）接着装，过程写在数据目录的 `update-job.json` 里（不写数据库，那时已经关了），新版（或装回的旧版）起来后按它和正在跑的版本判断结果。dsh 关了热更新时 `removeBundle` 回 `stop-profile`，就直接把新版装在旧版上面，重启 dsh web 后生效；这时 dsh 已经先换上了新版的页面，页面比宿主新，顶部提示重启。进度框直接挂在 `document.body` 上，旧版的页面被拿掉后还在；dsh 换插件时会把面板切走，新版的页面加载后按 sessionStorage 里的记号重新选中 dsh-bot（`packages/ui/src/client/views/update/reopen.ts`）。
