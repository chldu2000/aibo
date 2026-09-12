# @aibo/capability-sdk

Node 22+ Capability Runtime 2.0 helper，当前仅本地打包。`serveCapability` 使用标准输入/输出 JSON-RPC；日志请写入 stderr。每个实例注册一个 contribution 及明确的 capability/version/operationId 列表。

```js
import { serveCapability } from '@aibo/capability-sdk/stdio';
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
