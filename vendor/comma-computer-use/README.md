# 用电脑的小助手（Comma Computer Use）

dsh-bot 的用电脑（computer_use 工具和电脑面板）靠这个 macOS 小助手在后台读写别的应用的窗口、推窗口画面。

- 来源：开源项目 Comma（https://github.com/AFK-surf/Comma），提交 `66ab3dc92475005aea9afd123df36a28e4ef86ab`，
  原路径 `systems/connector/salix-connect` 下的 `native/macos/` 和 `scripts/package-computer-use-helper.sh`。
- 授权：GNU Affero General Public License v3.0，全文见本目录的 LICENSE。不适用 dsh-bot 的 Apache License 2.0。
- 改动：没有，文件和上游一模一样。它是单独的程序，dsh-bot 只通过本机的 Unix 套接字和它通信。
- 依赖：编译时 SwiftPM 会取 PermissionFlow（https://github.com/EYHN/PermissionFlow，MIT License），
  版本钉在 `native/macos/ComputerUseHost/Package.resolved`。

## 编译

在仓库根目录运行 `pnpm build:computer-use`（scripts/build-computer-use.mjs）：用上游的打包脚本编成
`packages/runtime/assets/computer-use/dsh-bot Computer Use.app`（本机临时签名），打 npm 包时跟着 `runtime/assets` 一起发。
只能在 macOS 上编，要 Xcode 命令行工具。
