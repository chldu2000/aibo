# Agent 插件设置协议 v1

Agent 能力提供者可以在 Manifest v2 的 session `capabilityProvider` 上声明 `settings`。
宿主在「管理中心 → 扩展 → 插件 → 设置」提供表单，并将解析后的配置放进每次
`capability.invoke` 的 `context.settings`。插件无需提供前端代码或申请 application 写权限。

协议类型：[`packages/plugin-protocol/src/settings.ts`](../packages/plugin-protocol/src/settings.ts)。
声明 schema：[`contracts/agent-settings.v1.schema.json`](../contracts/agent-settings.v1.schema.json)。
可运行实现：内置 [Pi](../src-tauri/capability-plugins/pi/plugin.json) 和
[Codex](../src-tauri/capability-plugins/codex/plugin.json) 都提供「附加指令」设置，
由[会话提供者](../src-tauri/capability-plugins/session-provider.mjs)在每次发送时使用。

## 声明

在已有 `aibo.session.open` 等 Runtime 2.1 操作的贡献中增加：

```json
{
  "settings": {
    "schema": "aibo.agent-settings/v1",
    "version": 1,
    "title": "Agent 设置",
    "description": "在下一次调用时应用。",
    "scopes": ["application", "workspace", "session"],
    "fields": [
      { "key": "additionalInstructions", "label": "附加指令", "type": "multiline", "default": "", "maxLength": 8000 },
      { "key": "verbosity", "label": "回答长度", "type": "select", "default": "normal", "options": [
        { "value": "brief", "label": "简短" },
        { "value": "normal", "label": "正常" }
      ] },
      { "key": "includeSummary", "label": "附带摘要", "type": "boolean", "default": true },
      { "key": "resultLimit", "label": "结果数量", "type": "number", "default": 10, "min": 1, "max": 100 }
    ]
  }
}
```

这是贡献中的局部声明，不能单独作为完整 manifest 安装。字段由插件定义和消费；
只有内置示例的 `additionalInstructions` 有内置行为，其余示例字段需要插件自行实现。

- 控件类型：`text`、`multiline`、`boolean`、`number`、`select`。
- 所有字段必须提供合法默认值；`false`、`0` 和空字符串都是明确的值。
- `min`/`max` 只用于数字，`maxLength` 只用于文本，`options` 只用于选择项。
- 最多 64 个字段、64 个选项；字段 key 唯一，默认值、范围和选项在安装时校验。
- 文本默认上限为 16384 个 Unicode 码点。声明和每个作用域的保存值各不超过 64 KiB UTF-8 JSON。
- 不接受 HTML、脚本、任意 JSON Schema 引用或插件 CSS。
- v1 是普通配置协议，不提供密码字段或密钥存储。凭据仍由 Agent 自身的认证机制管理。

## 作用域和保存

优先级为：字段默认值 → 全局 → 项目 → 当前会话。只应用声明在 `scopes` 中的层。
会话项目由宿主数据库解析，调用方不能指定另一个项目路径。

桌面 API：

```ts
const target = {
  installationId: installation.id,
  contributionId: 'dev.example.agent',
  scope: { kind: 'application' } as const,
};
const snapshot = await readAgentSettings(target);
await saveAgentSettings({
  ...target,
  version: snapshot.descriptor.version,
  expectedRevision: snapshot.revision,
  values: { additionalInstructions: '请优先给出结论。' },
});
```

对应 IPC 为 `read_agent_settings({ target })`、`save_agent_settings({ request })`。
前端封装位于 `src/lib/api.ts`，这些是宿主调用，不是插件可执行的能力。

读取返回 `target`、`descriptor`、`revision`、本层 `values`、包含本层覆盖的
`effectiveValues` 和不含本层覆盖的 `inheritedValues`。初始 revision 为 0。
保存替换本层整个 overrides 对象；省略某个 key 表示继承，`values: {}` 清空本层覆盖。
表单的「使用继承值」和「全部使用继承值」先改变草稿，点击保存后才持久化。

宿主使用原子 compare-and-swap 校验 revision；成功保存递增 revision，清空也不删除
修订号。并发冲突返回 `settings_conflict`，界面保留用户草稿，由用户明确重新加载。
字段或大小错误返回 `invalid_settings`；卸载、不匹配的会话、已归档会话或不存在的
项目返回 `settings_unavailable`。禁用的已安装插件仍可以编辑配置，无需启动进程。

配置按 plugin ID、贡献 ID、设置版本和作用域身份隔离。安装 ID 用于验证目标 release，
同一设置版本的插件升级/重装继续使用配置。改变字段含义、删除字段或收紧约束时必须
递增 `settings.version`；新版本使用独立配置，回滚仍能读旧版本。v1 不自动迁移配置。
卸载保留配置，不修改插件包文件、Agent 原生配置文件或工作区文件。
已有会话仍绑定原插件 release；原 release 未声明设置时不会收到新配置，需要使用
新版提供者创建会话。协议不会为了更新设置而迁移会话绑定。

## 插件如何消费

```ts
async function invoke(request: CapabilityInvocation) {
  const settings = request.context.settings;
  if (settings?.schema === 'aibo.agent-settings/v1' && settings.version === 1) {
    const instructions = settings.values.additionalInstructions;
    // 在对应操作中消费插件自己声明的设置。
  }
}
```

宿主只向声明了设置的对应贡献传递 `context.settings`，没有声明的旧插件不增加此字段。
字段包含完整有效值及设置版本，不包含其他插件设置、配置文件路径或 UI 草稿。
`input` 无法覆盖此宿主上下文；插件间调用也由宿主为被调用贡献单独解析。

生效边界是**下一次 capability invocation 的快照**。已经运行的调用及其 control
继续使用原来的快照。保存不会中断运行中的回合或强制重启 Agent。插件需要在每次调用
消费值；只能在启动时应用的参数必须在描述中明确说明，并由插件在后续启动操作处理。
内置「附加指令」在下一条发送消息前添加，不改写用户已保存的原始消息或审批策略。

## 验证

- `node --test test/agent-settings.test.mjs`：schema 一致性、草稿隔离、并发错误、两个
  内置提供者真实子进程中的配置消费及无需重启的恢复。
- `cargo test --lib agent_settings`（在 `src-tauri`）：字段校验、继承、原子冲突、重置、
  数据库重开、升级与版本隔离、卸载与会话身份。
- `cargo test --lib capability_session_projects_tools_and_recovers_after_process_restart`：
  实际安装包、Broker、SQLite、Pi 提供者进程与假 SDK 的完整发送链路。
- `node probes/agent-settings-browser.mjs`：双皮肤表单编辑、保存、重置和错误展示。
- 交付前运行 `pnpm run verify`。
