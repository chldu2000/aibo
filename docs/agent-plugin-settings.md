# Agent 插件设置协议 v1

账户、用量及原生扩展等组合管理能力的后续方案见[插件设置与管理面板设计](plugin-management-panels-design.md)。
静态面板和只读动态分区已接入；管理写入、登录挑战和长操作仍待实现。均不改变本文的 v1 配置存储合同。

## 插件独立管理面板

Host SDK **0.1.13** 的源码实现支持可选 `managementPanel` contribution。声明通过安装校验后，
设置导航显示插件自己的入口；插件详情中的配置按钮也可直达该面板。禁用插件仍可编辑静态配置，
静态分区不会启用插件或启动其进程。动态分区仅在插件已启用时调用声明的 provider。旧插件保留原表单入口。

```json
{
  "kind": "managementPanel",
  "id": "dev.example.agent.management",
  "scope": "application",
  "required": false,
  "title": "Example Agent",
  "contractVersion": "1.0.0",
  "relatedContributions": ["dev.example.agent.session"],
  "sections": [{
    "id": "behavior",
    "title": "行为",
    "scopes": ["application", "workspace", "session"],
    "settingsReferences": [{
      "key": "instructions",
      "contributionId": "dev.example.agent.session",
      "scopes": ["application", "workspace", "session"]
    }]
  }]
}
```

这是 manifest 内的局部声明，需要同包声明具有 settings 的 Session Provider。每个引用只能使用
分区和 settings descriptor 都支持的 scope，分区 ID 与本分区引用 key 分别唯一。
一页可含多个分区，一个分区可引用多个表单，各表单独立保存和处理冲突；同一真实 settings target
复用草稿。会话作用域只允许编辑当前会话固定安装和提供者的配置，归档会话不可编辑。

当前最多 16 个分区、每分区 32 个静态引用。静态 1.0.0 拒绝动态 providers；1.1.0 支持下述只读 provider。动作与敏感输入仍不支持，安装时拒绝；
不会把登录或安装伪装为配置保存。新包应声明 hostSdk.min 为 0.1.13；这是源码版本，不表示已发布。
Schema 位于 [management-panel.v1.schema.json](../contracts/management-panel.v1.schema.json)，
类型从 `@aibolabs/plugin-protocol` 导出。双 Agent 声明样本位于
[management-panel fixture](../fixtures/plugins/management-panel/manifest.json)。

验证：`node --test test/management-panels.test.mjs`、Rust `plugin_manifest` 测试，以及
`node probes/management-panel-browser.mjs` 覆盖两套内置外观的导航、多表单、草稿、作用域、只读数据与键盘行为。

### 只读动态分区（1.1.0）

`contractVersion: "1.1.0"` 的分区至少声明 `settingsReferences` 或 `providers` 之一；
两者可组合。`providers.application` 包含同包的 `contributionId` 和 `readOperationId`。
当前仅支持 application，其他 scope 的动态读取尚未实现。

```json
{"id":"account","title":"账户","scopes":["application"],"providers":{"application":{"contributionId":"dev.example.agent.data","readOperationId":"dev.example.agent.read"}}}
```

引用必须指向 application capabilityProvider 上 `effect: "read"`、`permissions: []` 的操作，
输入和输出 schema 必须分别等于 [management-read.v1.json](../contracts/management-read.v1.json)
的 `inputSchema` 与 `outputSchema`。输入只有 `sectionId`；输出提供有界的目标说明、属性、
指标、可用状态和读取时间，各集合的 key 必须唯一。
[声明 schema](../contracts/management-panel.v1.1.schema.json) 与
[数据 schema](../contracts/management-data.v1.schema.json) 为当前实现合同。

宿主 `read_management_section` 只接受安装、面板和分区 ID，解析声明后使用固定绑定调用 Broker，
重新校验安装启用状态和依赖，拒绝跨插件引用以及读取期间被替换的声明。
该入口不接收任意 capability ID。插件必须投影允许显示的字段，不能返回密钥、认证令牌、
原始错误或完整原生响应。宿主展示纯文本，失败显示通用错误，不缓存账户数据到草稿。
切换分区、关闭窗口或禁用插件清除当前视图；迟到的读取结果被丢弃。手动刷新重新读取，
不轮询；关闭视图不立即取消原生读取，原生连接在成功、失败、取消或 25 秒截止时间后关闭。

Codex 2.0.20 使用独立 app-server 连接读取 `account/read`（`refreshToken:false`）以及
`account/rateLimits/read`。账户页显示登录状态、类型及 ChatGPT 邮箱和套餐；用量页显示
主要/次要额度的使用百分比及重置时间。这是额度快照，不是账单或历史消费统计。
当前使用 Codex 默认环境，不选择多账户或修改原生配置，也不创建聊天线程。
登录、退出、Codex 插件管理、原生草稿、contextEpoch 和后台长操作监督仍待后续实现。

验证补充：`node --test test/management-data.test.mjs` 覆盖独立连接、敏感字段过滤、超时、取消、
缺失可执行文件和过期响应；Rust `management` 测试覆盖引用约束与安装准入；浏览器探针覆盖
只读属性、额度、失败清空和重试。

Agent 能力提供者可以在 Manifest v2 的 session `capabilityProvider` 上声明 `settings`。
宿主在「工作台设置 → 插件与能力 → 插件 → 设置」提供表单，并将解析后的配置放进每次
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
切换设置分类或关闭设置窗口保留本次运行中的草稿；未保存时显示提示，不会自动提交。
表单的「使用继承值」和「全部使用继承值」先改变草稿，点击保存后才持久化。

宿主使用原子 compare-and-swap 校验 revision；成功保存递增 revision，清空也不删除
修订号。并发冲突返回 `settings_conflict`，界面保留用户草稿，由用户明确重新加载。
字段或大小错误返回 `invalid_settings`；卸载、不匹配的会话、已归档会话或不存在的
项目返回 `settings_unavailable`。禁用的已安装插件仍可以编辑配置，无需启动进程。

配置按 plugin ID、贡献 ID、设置版本和作用域身份隔离。安装 ID 用于验证目标 release，
同一设置版本的正常升级或同版本替换继续使用配置；显式降级重装会清除全局和工作区配置。改变字段含义、删除字段或收紧约束时必须
递增 `settings.version`；新版本使用独立配置，回滚仍能读旧版本。v1 不自动迁移配置。
卸载清除该 release 的程序包和私有数据；其他安装版本仍使用的共享配置保留。
最后一个版本卸载时清除全局和工作区配置，保留会话配置快照作为业务历史。
不修改插件在 Aibo 管理目录之外的 Agent 原生配置文件或工作区文件。
已有会话在迁移成功前仍绑定原 release；设置编辑本身不迁移绑定。
独立的[会话迁移流程](plugin-boundaries-and-regression.md#插件卸载与会话迁移)在单版本替换提交前恢复旧会话；普通启用不会自动迁移。

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
- `node probes/agent-settings-browser.mjs`：内置 Material 3 与 ak-ui 两套外观表单编辑、保存、重置和错误展示。
- 交付前运行 `pnpm run verify`。
