# Aibo plugin development

[English](plugin-development.md) | [简体中文](plugin-development_zh.md) | [Project README](../README.md)

## Choose an extension path

| Goal | Extension | Starting point |
| --- | --- | --- |
| Add an operation, external service or domain data | Capability provider | [Standalone example](../examples/capability-plugin/) |
| Show plugin data and actions in the workbench | Capability provider plus semantic view | The same example; no frontend code required |
| Integrate a coding Agent | Session capability provider using Runtime 2.1 | [Built-in providers](../src-tauri/capability-plugins/) |
| Change layout, rendering or skin | Installable isolated presentation package | [Presentation package contract](presentation-package.md) |

For capability packages, use Manifest v2. Agent Runtime v1 and its archived development guide are no longer
an executable extension path. A capability declaration describes behavior; it does not
itself grant access to the workspace. See the [support matrix](plugin-platform-support-matrix.md)
for exact accepted versions and platforms.

## Build and install the working example

Run from the Aibo repository root after `pnpm install`, with Node.js 22+ and `tar` available:

```sh
node --input-type=module -e 'import { buildExternalPlugin } from "./probes/build-external-plugin.mjs"; const result = await buildExternalPlugin(); console.log(JSON.stringify({ developmentRoot: result.root, installPath: result.packagePath }, null, 2));'
```

This builds local SDK tarballs, copies the example into a temporary directory outside
the repository, installs those tarballs offline, compiles the worker and bundles its
runtime dependencies. It prints an unpacked `installPath` containing `plugin.json`,
`dist/worker.js`, and the required `node_modules`. It does not launch Aibo or call a model.
The returned development directory is retained for inspection; copy it somewhere durable
if you plan to keep working on it.

In the desktop app, open **Plugins**, enter `installPath`, install the package, and enable
it. The example contributes a command semantic view titled **External SDK greeting**;
open it from the command entry. Its content is `EXTERNAL_SDK_OK`, with a refresh action.
Direct capability invocations require a host-selected provider binding.

For automated macOS desktop acceptance, use:

```sh
node probes/external-plugin-native.mjs
```

That probe builds its own package and uses an isolated app identifier and temporary
workspace. It requires the Tauri development environment. Merely running `node` on the
worker is not an end-to-end test: the worker expects a host protocol handshake on stdin.

## Author a capability package

The [example manifest](../examples/capability-plugin/plugin.json) and
[worker](../examples/capability-plugin/worker.ts) are a complete, matching pair. Keep these
parts consistent when copying the example:

1. Choose your own `pluginId`, contribution ID, operation ID and capability namespace.
   Keep the manifest version and worker `pluginVersion` identical.
2. Declare `host`, `platforms`, and exact supported runtime versions. The example uses
   Runtime 2.0 and Semantic View 1.0; do not infer protocol versions from SDK package versions.
3. Declare each operation's scope, input/output JSON schemas, effect, permissions,
   timeout and idempotency. Use `application` for operations that need no workspace;
   select `workspace` or `session` when their identity is required.
4. Implement only the operations in the allowlist. Return schema-valid data, write logs
   to stderr, and reserve stdout for protocol messages.
5. Cooperate with `tools.signal`. Use `tools.call` for declared provider dependencies;
   the Broker supplies scope, invocation identity and authorization. Do not retry writes
   automatically after cancellation, rejection or an unknown outcome.

A semantic view references a declared provider operation. The greeting query receives
`{ actionId: "refresh", itemId: null, offset: 0 }`, not an empty object. Its output contains
`state`, `view` and `actions`; the host supplies snapshot identity and revision. Semantic
views express content and intent, without HTML, CSS, skin IDs or executable UI code.

For writes, declare a write effect and the required permissions. The host owns approval,
workspace admission and durable outcomes. The execution profile selected for a session
authorizes that session's top-level turns without a second broad-permission prompt; it is
not general authorization for arbitrary plugin or nested dependency writes. Reference [write](../fixtures/plugins/capability-write/) and
[semantic write](../fixtures/plugins/semantic-write/) fixtures alongside the contracts.
The host persists the semantic `approvalReviewer` (`user`, `auto-review`, or `none`);
native adapters translate it to provider-specific review routing and permission grants.

## Package your own changes

The external builder demonstrates the full process in
[`probes/build-external-plugin.mjs`](../probes/build-external-plugin.mjs). For a maintained
plugin project, repeat these stages in your own development directory:

1. Build `packages/plugin-protocol` with TypeScript, then locally pack it and
   `packages/capability-runtime` with `npm pack --ignore-scripts`.
2. Install both local tarballs in your plugin project. These packages are not available
   from a public registry; do not start with a registry-only installation command.
3. Compile `worker.ts` using `tsc -p tsconfig.json`. Keep runtime dependency versions in
   the final `package.json`; do not ship machine-specific tarball paths.
4. Run `npm pack --ignore-scripts` in the plugin project. The example's
   `bundledDependencies` includes both SDK packages. Inspect the archive for the manifest,
   compiled entrypoint and runtime dependencies; exclude workspace symlinks and app imports.
5. Unpack the archive into a directory, then install that directory through Aibo.
   For each changed release, increment the plugin version and worker version together.

Releases are immutable and sessions remain pinned to their provider installation.
Installing another version does not silently migrate active sessions or recovery data.
Test disable/re-enable, missing dependencies, incompatible versions and recovery behavior
before treating an upgrade as supported.

## Implement a session provider

The new-session wheel discovers enabled, runnable session-scoped `aibo.session.open` providers whose contribution dependencies are ready. Each `capabilityProvider` supplies its `displayName` and optional `icon`, for example `"icon": { "path": "M12 2L22 12L12 22L2 12Z" }`. The icon is monochrome SVG path data in a fixed 24 × 24 viewBox, limited to 8192 characters; multiple subpaths are supported. The host validates the data and the skin owns color and status effects. Full SVG markup, URLs, scripts and styles are not accepted. Missing icons use a generic diamond. Disabling or uninstalling a provider removes its launcher. Multiple session providers in one package may each declare their own name and icon.

Start with the current [Codex](../src-tauri/capability-plugins/codex/worker.mjs) or
[Pi](../src-tauri/capability-plugins/pi/worker.mjs) provider, plus their shared
[session provider implementation](../src-tauri/capability-plugins/session-provider.mjs).
That shared file is an in-repository implementation reference, not a published SDK API.

- Use Runtime 2.1 explicitly for invocation streams and controls; the helper defaults to 2.0.
- Implement the shared [session capability contracts](../contracts/session-capabilities.v1.json),
  [session events](../contracts/session-event.v1.schema.json) and
  [recovery binding](../contracts/session-binding.v2.schema.json).
- Keep native engine IDs inside native bindings. The host owns session and turn identity,
  first-message naming, permission decisions, event validation and durable history.
- Declare controls in the operation allowlist. Emit events only while the invocation is
  active; handle cancellation and reject controls that no longer belong to that invocation.
- Do not claim an enforcement backend by adding manifest fields. External providers without
  negotiated host enforcement receive a restricted profile; native sandbox support requires
  host integration and verification.

## Extend presentation

Create a separate `presentation.json` package to customize themes, controls, core semantic
views or the workbench. Start with the [package contract](presentation-package.md),
[build tools](../packages/presentation-tools/), and the independent
[shadcn](../packages/presentation-shadcn/) or [Material 3](../packages/presentation-material3/) examples.
The [0.3.0 release guide](presentation-release-0.3.0.md) describes installation and offline SDKs.

Executable packages return restricted visual trees from a terminable Worker; a trusted
iframe bridge renders them and forwards host-validated actions. Packages cannot directly
access DOM, network, storage or Tauri IPC. Unprovided surfaces inherit host defaults;
management, approvals and recovery remain with the host. Capability Manifest v2 presentation
metadata does not grant this execution path: capability data views still use semantic contributions.

For a host-integrated presentation, start with
[`default-presentation.ts`](../src/lib/workbench/plugins/default-presentation.ts),
[workbench adapters](../src/lib/workbench/presentation-adapters.ts) and
[`@aibo/web-presentation`](../packages/web-presentation/). Preserve core collection, detail,
settings and inspector semantics, declared snapshot compatibility, and a core fallback for
optional renderers. Dispose local views without losing host-owned execution state.

Use `UiKitAdapter` and the [UI kit registry](../src/lib/ui-kit/registry.ts) for skin changes.
App components import visuals only through `$lib/ui-kit`; business controllers do not depend
on Svelte or concrete API implementations. Layout and icon placement belong to presentation;
authorization, action meaning and business results belong to the host.

## Validate before sharing

```sh
pnpm run verify
cargo test --manifest-path src-tauri/Cargo.toml
pnpm run probe:session:capabilities
```

`verify` includes protocol packaging and architecture checks. Session workflow tests use
fake engines and do not establish real-model compatibility. Run relevant native probes
separately; see the [probe guide](native-engine-probes.md). Never publish raw credentials or
unredacted provider logs in a package, fixture or bug report.

## Agent settings

Session providers can contribute editable, scoped settings through the host-owned
`aibo.agent-settings/v1` descriptor. See the [protocol and working built-in examples](agent-plugin-settings.md).

## Host waiting queue and optional steering

Standard Runtime 2.1 providers declaring open/turn/cancel/close receive a host-owned durable waiting queue without a native queue implementation. Running delivery requires separately negotiated steering. Host-projected capabilities never replace provider negotiation data; uncertain delivery is never automatically retried. See [message queue](message-queue.md) for the contract and compatibility rules.


## 模型上下文大小选择

宿主支持独立会话能力 `model.context-window`。插件在自己的命名空间声明操作（如 `<pluginId>.model.context-window`），并仅在真正实现时将 `model.context-window` 加入会话 capabilities。Cursor 插件不因本次宿主变更自动获得此能力。

模型目录（`model.select` 的 `action: "list"` 返回值）新增可选字段：

```json
{
  "models": [{
    "id": "example-model",
    "displayName": "Example",
    "contextWindows": [
      { "id": "standard", "label": "128K", "tokens": 128000 },
      { "id": "long", "label": "1M", "tokens": 1000000, "description": "Extended context" }
    ]
  }],
  "current": "example-model",
  "currentContextWindow": "standard"
}
```

`id` 是后端不透明选项值，不根据显示标签反推 token 数。`label` 为显示文字，`description`、`tokens` 可选；`tokens` 若提供应为安全范围内正整数。选项必须按模型提供，不能将当前模型的列表复制给所有模型。旧目录缺失字段会归一化为空列表和空当前值，不影响既有模型、推理、Fast 功能。

设置通过绑定插件调用 `<pluginId>.model.context-window`（版本 `1.0.0`），输入为 `{ "action": "set", "contextWindow": "long" }`。操作可参照模型设置声明 `effect: "read"`、`permissions: ["workspace.read"]`；实际参数由插件验证，不允许利用配置操作绕过工作区写入审批。插件应返回确认结果及更新后的 `recovery`，将选项应用于后续真实请求并在恢复时重放。宿主沿用既有 recovery 持久化机制；随后重新读取模型目录，以 `currentContextWindow` 确认成功，不在通用 execution profile 中假造配置。

Fast 旁的上下文下拉框只有在会话声明能力、当前模型提供非空选项、目录加载完成且会话可修改时才启用。设置前重新读取目录，拒绝已经切换模型的旧选择；设置失败或未确认时读取真实状态并显示错误。运行中宿主拒绝上下文修改。外部呈现的 `selectContextWindow` 是带当前模型与允许值的 `change` 动作，拒绝旧 revision、已移除选项和伪造值。


### 内置 Codex / Pi 的上下文规格来源

`model.context-window` 表示选择经过来源核对的运行窗口，不表示插件能够提升服务端的硬上限。
内置实现不会根据模型名称相似性为其他服务商推导长上下文规格，也不修改用户全局配置。

- **Codex 2.0.9**：先通过 `model/list` 获取当前目录，再读取同一 `CODEX_HOME` 下原生维护的
  `models_cache.json`，按精确 `slug` 匹配 `context_window` / `max_context_window`。
  仅提供默认和最大两个不同的正整数窗口；缓存超过 24 小时、缺失、格式不支持、使用自定义
  provider/endpoint 或 `model_catalog_json` 时关闭该模型的选择。没有硬编码 1M 或 API 产品页上限。
  当前 app-server 的公开 `model/list` 不包含窗口字段，因此该缓存格式属于有保护的版本兼容依赖。
- **Codex 应用路径**：对已加载线程的 `thread/resume.config` 实测会忽略窗口变更，因此停止该会话
  专用进程，以 `-c model_context_window=...` 和窗口 90% 的自动压缩阈值重新启动，然后恢复线程。
  读取运行进程的 `config/read` 核验结果，失败尝试恢复旧运行配置。恢复前重新核验目录；切换模型会
  清掉上个模型的选择。尚无首条 rollout 的空线程沿用原有重建逻辑，当前宿主绑定的事件身份保持稳定。
- **Pi 2.0.5**：默认规格来自 SDK `ModelRuntime` 的实际模型目录（内置数据、远程目录及用户覆盖的
  合成结果）。额外档位只针对当前 SDK 0.84.4 的 `docs/models.md` 明确记录的
  `openai/gpt-5.6-sol`、`openai/gpt-5.6-terra`、`openai/gpt-5.6-luna`：272K / 1.05M。
  同时要求 API 为 `openai-responses`、模型地址和认证解析后的地址均为官方 OpenAI v1 地址。
  OpenAI 官方模型页面确认三者支持 1,050,000 tokens。Codex 订阅、代理、其他服务商和不匹配的
  自定义窗口不继承该档位；未知模型不猜测上限。
- **Pi 应用路径**：调用真实 `AgentSession.setModel`，将窗口应用到运行中 Agent 使用的模型对象，
  保留推理强度、目录原始定价和请求参数；确认后再发布状态和恢复信息。SDK 的压缩决策和请求管线
  使用该模型对象。原生 API 没有单独的“申请 1M”参数，服务端根据实际输入执行已有窗口限制。
  选择长窗口意味着允许 SDK 保留更多上下文，并不改变 API 服务端规格或账号权限。
  会话恢复、资源重载和发送前均检查已选配置；模型切换时清除旧选择。

验证：Codex CLI 0.153.4 实际短请求中，872K→272K 切换对应原生
`tokenUsage.modelContextWindow` 828,400→258,400（95% 有效窗口）。Pi 使用真实 SDK 和模型目录的
离线传输截获测试验证 1.05M→272K 进入请求管线并保留历史；未发送百万 token 的付费请求，
这些测试不证明账号拥有额外权限。协议测试覆盖规格缺失、过期、自定义端点、认证地址重定向、
失败回滚、跨进程恢复、运行中拒绝修改及切换模型隔离。

来源：[Codex 配置参考](https://learn.chatgpt.com/docs/config-file/config-reference)、
[Codex App Server](https://learn.chatgpt.com/docs/app-server)、
[GPT-5.6 Sol](https://developers.openai.com/api/docs/models/gpt-5.6-sol)、
[Terra](https://developers.openai.com/api/docs/models/gpt-5.6-terra)、
[Luna](https://developers.openai.com/api/docs/models/gpt-5.6-luna)、
本仓库锁定的 `@earendil-works/pi-coding-agent@0.84.4` 的 `docs/models.md` 与
`dist/core/{agent-session,sdk,model-runtime}.js`。
