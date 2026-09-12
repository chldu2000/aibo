# Agent Plugin 开发指南（Runtime v1）

本指南说明如何构建可由 Aibo 本地安装的进程外 Agent 插件。插件与 Aibo 通过 stdin/stdout 上的 LF 分隔 JSON-RPC 通讯；它不是 WebView 扩展，不能注入 HTML、CSS、脚本或 Svelte 组件。

权威 schema 位于 `contracts/`：

- `plugin-manifest.v1.schema.json`
- `agent-runtime-protocol.v1.schema.json`
- `plugin-view-protocol.v1.schema.json`
- `plugin-session-binding.v1.schema.json`

可运行的第三方最小参考实现是 `fixtures/plugins/echo-agent/`。协议回放与进程 harness 在 `test/echo-plugin-process.test.mjs`。

## 包与安装

一个包目录必须包含 `plugin.json` 和 manifest 声明的入口文件。`pluginId` 与 `agentId` 使用反向域名形式；release identity 是 plugin ID、SemVer 版本和整个包的 SHA-256。Aibo 复制包到自己的 Registry，安装默认禁用。

manifest 必须限定 Runtime/View 协议到 `1.0`，声明支持的平台、依赖、每个 Agent 的 capability、权限请求、operation 和 view。包内不允许符号链接、特殊文件、路径逃逸或未声明/摘要不匹配的资源。

`dependencies` 只能声明本机 runtime 或 executable。宿主以清空的环境、无 shell、两秒时限和有界输出运行 `<executable> --version`，并校验 `versionRange`。必需依赖缺失、无法探测或版本不兼容时插件不可启动。

## 生命周期

1. Host 启动入口并发送 `aibo.initialize`，其中包含预期 release、协议版本、已解析权限和 generation ID。
2. 插件返回 `initialized`，且只能返回 manifest 声明能力的子集。
3. Host 调用 `session.create` 或携带先前 binding 的 `session.resume`。插件返回 native session ID 和版本化 recovery data。
4. Host 发送 `turn.send` / `turn.cancel`；插件以 `agent/event` 推送状态和流式输出。
5. 关闭时 Host 发送 `session.close`，随后有界停止进程。Aibo 历史不会因关闭、卸载或缺失包被删除。

`turn.send.input.attachments` 是本次 turn 中受控附件引用的数组。每项只包含 `attachmentId`；插件不得将它解释为主机路径、URL 或任意文件句柄。Host 只会在插件接受该 turn 后将这些引用固定到 turn，发送失败时它们仍保持待发送状态。需要文件内容时，请通过后续版本化的受控资源 capability 请求，不要把附件 ID 转换成未授权的本地文件访问。

每条通知必须带当前 Aibo session ID、Agent ID、native session ID 和 turn ID（适用时）。旧 generation、跨会话消息、无效 schema、重复/倒退 view revision 与未协商 capability 会被拒绝，并会停止该 generation。

恢复 data 必须是自描述、可版本化的 JSON。不要把 session 数据写进插件包；Host 通过 `executionProfile.runtimeDataPath` 提供 package 外的持久目录。升级影响后续会话；活动会话固定在原 release。卸载后历史仍可读取，恢复会提示安装兼容 release。

## Capability 与 operation

应用层按标准 capability 调用，例如 `model.select`、`goal.manage`、`queue.manage` 或 `skill.list`。manifest 将一个 capability 唯一映射到一个 namespaced operation（ID 必须为 `ext.<pluginId>.*`）；Host 在调用前核对固定 release、generation、协商 capability 与 JSON Schema，并验证返回值。

不要提供任意 method 转发。扩展 capability 也必须以 `ext.<pluginId>.*` 声明。需要在活动 turn 中操作队列时使用 `queue.manage`；其他 operation 默认要求会话非运行。

对审批或用户输入，插件应保存 Provider 的原始请求 ID，发出 `approval.requested` 或 `user_input.requested`，并在 `approval.respond` / `user-input.respond` operation 后向 Provider 响应。Host 只接受声明并协商了相应 capability 的互动事件。

## 权限与数据边界

`workspace.read` 可由 Host 作为 agent-native grant 提供可信工作区根。Runtime v1 不会给插件未实现的 workspace-write、命令、网络或凭据代理；必需但无法强制的权限会阻止启动。进程隔离不是系统沙箱，插件应自行遵守 Host grant 和 `executionProfile`。

插件 view 是 `aibo.plugin-view/v1` 声明式树，仅能使用 schema 中的语义节点、props、binding 和 action。不要传递样式、类名、HTML、JavaScript 或任意资源 URL。Renderer 在 shadcn 与 Material 3 skin 中保持外观一致。

## 验证与发布前检查

在仓库外空目录运行：

```sh
node probes/build-echo-plugin.mjs <package-directory>
```

然后从 Aibo 安装包、启用它，并验证创建、Unicode 流式输出、取消、关闭、重启恢复和 view。提交插件或宿主变更前运行：

```sh
pnpm run verify
cargo test --manifest-path src-tauri/Cargo.toml
```

离线 harness 覆盖 Echo 进程、Codex app-server fixture 和 Pi RPC fixture。真实 Provider 验收应单独记录版本、平台、认证状态与日期；fixture 成功不能替代真实 Provider 验收。
