# 模型配置与上下文用量

本文件面向会话提供者与呈现开发者。能力声明、精确输入输出 schema 和执行准入以
[协商规则](session-capability-negotiation.md)及[功能合同](../contracts/session-features.v1.json)为准。
模型、推理强度、服务层级和运行窗口是独立能力，不根据提供者身份推断支持。

## 模型目录与确认

`model.select` 返回模型目录和当前选择；模型引用及参数 ID 是后端不透明值。
按模型提供选项，不将一个模型的参数复制给其他模型。目录可见不等于账号具有调用权限，
Auto 的显示名不能用于推断实际模型或路由。

设置先校验能力和当前状态，再应用到原生会话或实际请求管线；原生确认后返回当前值及
更新后的 `recovery`、`capabilities`。RPC 成功但未确认选择不算设置成功。组合操作部分成功时
保留已确认状态并报告错误；恢复和换模型必须重新核对参数归属，不能串用旧模型的选项。
运行中的配置修改应在普通 invoke 和 control 路径一致拒绝。

## Fast 与服务层级

`model.service-tier` 的输入为 `{ action: "list" }` 或 `{ action: "set", tier: "…" }`。
模型提供 `serviceTiers: [{ id, label, description }]`，目录顶层以 `currentServiceTier` 表示确认值。
操作 ID 使用插件自己的命名空间，并与清单、握手完全一致；不沿用旧 `ext.*` Agent 路由。

当前宿主寻找当前模型中 label 去除首尾空白后、不区分大小写等于 `Fast` 的选项，
同时要求协商 `model.service-tier`。开启提交实际 tier ID，关闭提交 `default`，
不能把显示名当作 ID。插件须将选择用于后续实际请求和恢复；不支持的模型应明确处理旧层级。
它不是通用 settings 字段，也不改变推理强度。

## 模型上下文大小选择

宿主支持独立会话能力 `model.context-window`。插件在自己的命名空间声明操作（如 `<pluginId>.model.context-window`），并仅在真正实现时将 `model.context-window` 加入会话 capabilities。该功能仍须按共享合同完成声明与协商。

模型目录（`model.select` 的 `action: "list"` 返回值）包含以下可选字段。数值仅作格式示例，不代表实际模型规格：

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
  "currentContextWindow": "standard",
  "recovery": null,
  "capabilities": ["model.select", "model.context-window"]
}
```

`id` 是后端不透明选项值，不根据显示标签反推 token 数。`label` 为显示文字，`description`、`tokens` 可选；`tokens` 若提供应为安全范围内正整数。选项必须按模型提供，不能将当前模型的列表复制给所有模型。旧目录缺失字段会归一化为空列表和空当前值，不影响既有模型、推理、Fast 功能。

设置通过绑定插件调用 `<pluginId>.model.context-window`（版本 `1.0.0`），输入为 `{ "action": "set", "contextWindow": "long" }`。操作须按共享功能合同声明 `effect: "read"`、`permissions: ["workspace.read"]`；实际参数由插件验证，不允许利用配置操作绕过工作区写入审批。插件应返回确认结果及更新后的 `recovery` 和 `capabilities`，将选项应用于后续真实请求并在恢复时重放。宿主沿用既有 recovery 持久化机制；随后重新读取模型目录，以 `currentContextWindow` 确认成功，不在通用 execution profile 中假造配置。

Fast 旁的上下文下拉框只有在会话声明能力、当前模型提供非空选项、目录加载完成且会话可修改时才启用。设置前重新读取目录，拒绝已经切换模型的旧选择；设置失败或未确认时读取真实状态并显示错误。运行中宿主拒绝上下文修改。外部呈现的 `selectContextWindow` 是带当前模型与允许值的 `change` 动作，拒绝旧 revision、已移除选项和伪造值。

## 规格来源与验证

选项必须有对应原生目录或已核对的规格来源，并验证 provider、API、端点及实际生效机制。
不能根据模型名或其他服务商同名模型猜测更大窗口；不改变服务端上限或账号权限。
内置适配器的历史规格来源、版本和验证限制见[历史基线](archive/model-context-window-baseline.md)，
它不是第三方提供者应复制的模型白名单。

## 上下文用量

当前上下文占用不同于累计 input/total。宿主优先读取显式 `contextTokens`、`contextUsedTokens`
或 `usedContextTokens`，其次读取 `last.totalTokens`，最后回退到 input 并标记估算。
窗口上限来自 `contextWindow`、`contextLimit` 或 `modelContextWindow`；缺失时保持未知。
呈现须保留估算标记，不能自行用累计 token 数替换上下文占用。
实现入口为 [`session-usage.ts`](../src/lib/app/session-usage.ts)。

## 外部呈现

ModelMatrix 的动作先按 `kind: model | serviceTier` 区分，Fast 缺失时不绘制开关。
整窗工作台使用宿主模型目录与 `selectServiceTier` / `selectContextWindow` 动作；
上下文选择是 change 动作，不是 ModelMatrix 的额外 click kind。只能绑定宿主当前提供的 token，
不能构造参数权限或跳过模型/revision 校验。内部 `ModelContextSelect` 不属于外部 controls 目录。
具体数据类型和动作见[呈现包合同](presentation-package.md)。

## 验证

在 Aibo 仓库按[回归矩阵](plugin-boundaries-and-regression.md#regression-gate)选择验证范围。
模型相关入口包括 `test/model-configuration.test.mjs`、`test/provider-context-window.test.mjs`、
`test/model-context-select.test.mjs`、`test/composer-fast-tier.test.mjs`、`test/session-usage.test.mjs`
和 `test/presentation-conversation.test.mjs`。覆盖缺失/拒绝能力、旧目录、原生未确认、
跨模型隔离、恢复及既有参数保留。模拟或离线请求截获不证明真实额度、百万 token 请求或桌面交互。

## 启动与目录缓存

宿主按不可变的 Aibo session ID 保存最近确认的模型目录，最多 30 个会话、1 MB、7 天。
应用重启或切换会话时先展示该快照，再读取绑定 provider 的实时目录；刷新期间明确标识旧快照，
默认与外部呈现均不提供模型修改动作。缓存不授予能力或执行权限，不能替换原生确认。
实际修改模型配置前重新读取当前目录；同一会话的并发显示读取合并，配置修改会隔离旧请求。
重复点击当前会话不清空已经加载的模型和模式。

内置 Codex 2.0.14 在单个原生进程内共用模型发现请求，目录最多缓存 60 秒，进程关闭时清除，
失败结果不缓存。模型、推理强度和服务层级不再各自重复发现。初始额度查询最多等待 5 秒，
在后台进行且不阻塞 session open；结果仍经过当前会话和进程身份检查。没有活动 invocation 时，
共享 provider 将用量事件保留到下一次调用，不发送无所属的事件。
