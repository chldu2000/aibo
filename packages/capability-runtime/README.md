# @aibo/capability-runtime

Node 22+ Capability Runtime 2.0 helper，开发包当前仅本地打包。声明 `hostSdk` 的插件由宿主提供此包，开发时安装为 `devDependencies`，发布时不携带 SDK。版本、公开入口和迁移见[宿主 SDK](../../docs/host-sdk.md)。`serveCapability` 使用标准输入/输出 JSON-RPC；日志请写入 stderr。每个实例注册一个 contribution 及明确的 capability/version/operationId 列表。

```js
import { serveCapability } from '@aibo/capability-runtime/stdio';
serveCapability({
  pluginId: 'dev.example.echo', pluginVersion: '1.0.0',
  contributionId: 'dev.example.echo.worker',
  operations: [{capability:'dev.example.echo.read',version:'1.0.0',operationId:'read'}],
  invoke: async (request, tools) => request.input,
});
```

`tools.initialization` 提供宿主传入的私有数据目录；`tools.signal` 表示本地 deadline、transport 关闭或调用结束。`tools.call({pluginId,contributionId,capability,version,input})` 经宿主 Broker 调用声明依赖，自动附带当前 invocation/generation，不允许传入 scope、权限或批准身份。子错误拒绝 Promise；没有自动重试。

默认入口 `createCapabilityRuntime` 可接入自定义消息传输，通过 `receive` 接收消息、`send` 发出 JSON、`close` 关闭。公开类型只依赖纯数据协议包；取消接口使用结构类型，不需要 DOM/Node 类型库。

宿主仍执行所有权限、schema、资源限制、原生批准、持久去重与最终结果判定。SDK 取消信号需要业务代码合作；它不能撤销文件修改或停止任意外部进程。宿主保留本机进程终止边界。此 helper 不包含 Agent Runtime v1，不装载前端代码。
## Interactive protocol migration

The runtime helper accepts explicit `protocol: '2.1'` for invocation streams and
controls. The default remains `2.0`. During `invoke`, `tools.emit(json)` sends an
ordered invocation event. A `control(request, { invocation, signal })` handler can
answer a host-authorized control while the invocation is pending. Controls must
be declared in `operations`; they cannot change the original scope or permissions.
Only one control runs at a time. Handlers must cooperate with `signal`, including
after invocation completion; cancellation cannot undo side effects.

Stream emission ends with the invocation. It cannot be used for detached background
notifications. The host validates identity, sequence and size and owns durable
history. Built-in Codex and Pi sessions now use this capability protocol. See
`docs/capability-session-migration.md` in the host repository for current support
and validation limits, and `docs/plugin-development.md` for the development guide.

`serveCapabilities(options[])` lets one package declare multiple contribution configurations.
The first capability initialization selects one declared contribution for the process generation;
later initialization cannot switch it. Each configuration still uses the same runtime dispatcher
and its exact operation allowlist. Aibo supervises separate scoped instances, so a workspace
catalog does not open or borrow a conversation instance.

Handler exceptions can carry a supported `kind` (for example `unsupported`,
`permission_denied`, or `invalid_input`). The dispatcher preserves that category
in JSON-RPC `error.data.kind`, bounds the error message, and maps unknown native
categories to `provider_unavailable`. This applies to invocation and control
handlers; it does not grant authority or turn failures into successful outputs.
