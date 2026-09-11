# P3 第一批：Manifest v2 与统一贡献目录

> 2026-09-11，P3 实施中。第一批完成合同草案、v1 适配与 v2 安装登记；第二批已接通[只读 Broker 运行链](./plugin-platform-p3-broker.md)，第五批已接通 [Git 及语义贡献安装](./plugin-platform-p3-git.md)，P3 完整退出条件仍未完成。

## 已实现

`contracts/plugin-manifest.v2.schema.json` 描述 `agent`、`capabilityProvider`、`semanticView` 三种贡献，以及可信构建期 `presentation` 描述。`plugin_manifest.rs` 将 v1/v2 解析为同一内部贡献目录；Registry 的 Agent 索引和安装列表使用这个目录。原始 manifest 仍按原样存储，v1 的 Agent ID、operation、依赖、runtime/view 协议、session binding 与 recovery 不变。

v2 包可以通过现有本地安装入口登记、列出、卸载及重新安装。纯声明式包不需要执行文件；包含 Agent 或 capabilityProvider 时必须提供实际存在的 entrypoint 和 runtime 协议范围。安装不创建 Agent session，不启动包进程。本地可执行依赖仍使用原有有界版本检查。

第一批对全部 v2 拒绝激活；第二批已允许只读 capabilityProvider 通过实验协议 2.0 运行，第三批补齐[包依赖解析与固定](./plugin-platform-p3-dependencies.md)。第五批允许 workspace.tool 列表/详情视图；尚未支持的 Agent、其他语义类型、presentation 或写入操作继续显示激活原因并禁用启用按钮。Agent Host 仍拒绝将任何 v2 包送入 v1 runtime；直接调用 IPC 也不能绕过此限制。

## 字段和决定

| 字段 | 含义与原因 |
| --- | --- |
| `host` | 宿主版本区间 `[min, maxExclusive)`，与包自身版本和通信协议分开 |
| `protocols.runtime` / `semanticView` | 各自使用包含端点的 major.minor 范围；有执行贡献必须声明 runtime，有语义贡献必须声明 semanticView |
| `executableDependencies` | Node、Git 等本机依赖；沿用 v1 的 kind/name/versionRange/required 解释 |
| `packageDependencies` | 插件包依赖，独立 pluginId/version/required；`contributionIds` 指本包哪些贡献依赖它，为后续局部降级提供范围，不是依赖包导出的 ID |
| `contributions[].id` | 本插件命名空间下的稳定 ID，包内唯一；Agent 映射到原有 agentId，不重新分配会话身份 |
| `scope` | application/workspace/session；Agent 固定 session，workspace.tool 固定 workspace，session.context/session.action 固定 session，settings.page 固定 application；command 可声明三种作用域 |
| `capabilityProvider.operations` | 显式 operation ID、能力 ID/版本、输入输出 schema、读写性质、所需权限、超时与幂等声明；声明不等于授权或幂等保证，Broker 仍须执行验证 |
| `semanticView` | 核心 semanticType、合同版本、扩展点、有限可见性、提供者能力/版本/operation 引用；允许独立视图包引用另一个插件的能力，不携带 CSS/脚本 |
| `presentation` | 仅描述 `host-bundled` 可信呈现与所需核心语义，不接受脚本加载地址；外部 UI 执行加载仍按 P4/P5 边界处理 |

贡献与 operation ID 必须属于声明插件；`aibo.*` 为宿主保留的命名空间，v2 插件不得占用。新 capabilityProvider 在本插件命名空间定义能力合同，不能伪造宿主核心合同；跨插件合同实现和稳定核心能力目录将在 Broker 合同中明确。核心语义类型固定为 collection/detail/settings/inspector，枚举名称登记不等于 settings/inspector 数据及交互合同已实现。

版本必须可解析，区间不能为空；拒绝重复贡献/operation、包自身依赖、重复依赖及指向不存在本地贡献的依赖。第三批已实现必需依赖环检测、可选贡献降级和 release 固定，详见依赖实施记录。

## 限额与 schema 安全边界

- Manifest 1 MiB；贡献最多 128、operation 每个提供者最多 64、包依赖最多 64、本机依赖最多 32、资源最多 128。
- 单个 operation schema 最多 64 KiB、深度 16、schema 节点 2048；按宿主支持的内联 JSON Schema 子集编译并验证。
- 不接受 `$ref`、远程/文件引用、递归引用、任意 vocabulary 或正则表达式；不通过安装包解析器访问网络。支持基本类型、对象/数组、enum/const、有界长度/数量/数值及 allOf/anyOf/oneOf/not。
- operation 超时声明 100–120000ms；能力调用真实 deadline、输出大小、并发和取消仍由后续 Broker 执行。
- 包路径、符号链接、资源摘要、文件数量/大小及复制后摘要复查继续使用原有 Registry 约束。纯声明包只豁免不存在的执行入口，不豁免包完整性检查。

这些是 P3 实施草案。首个稳定语义版本、支持窗口与弃用通知策略在真实 Git 安装链验证后、P3 对外发布前冻结；目前不将草案当作已发布的 1.0 稳定合同。

## 验证与下一步

Rust 覆盖 v1 Echo/Codex/Pi 元数据不变、可执行/声明式正例、版本/命名空间/作用域/依赖/不安全 schema 反例，以及真实 Registry 的安装→列出→拒绝提前启用→卸载→同 ID 重装，断言没有 Agent session。既有 Echo Host 生命周期、审批/恢复、历史迁移测试继续运行。

Node 使用独立 Ajv 验证同一 v2 schema 和结构反例。`probes/plugin-manifest-browser.mjs` 在两套皮肤挂载生产管理面板，验证无 agents 的声明包可显示、原因可见、启用被禁用、v1 创建仍可用及声明包卸载入口可用。浏览器使用确定性安装数据；实际 Registry 安装由 Rust 集成测试验证，不冒充原生桌面端到端测试。

第一批检查：`pnpm run verify` 通过（23 项架构检查、131 项 Node 测试、类型检查与构建）；Rust 全量 110 项通过。管理界面[结果](./baselines/plugin-platform-p3/manifest-results.json)、[shadcn 截图](./baselines/plugin-platform-p3/manifest-shadcn.png)、[Material 截图](./baselines/plugin-platform-p3/manifest-material3.png)已保存。

第二批已开始 [P3.2 Broker](./plugin-platform-p3-broker.md)：明确调用者/作用域与提供者绑定、调用身份与错误合同、权限和取消、依赖与 release 固定；之后接入 P3.3 无 session runtime 和 Git 进程外能力。`platform-v2/provider.json` 仍只描述目标 Git 能力，不包含可工作的 Git worker；第二批另有 `capability-echo` 可执行 fixture 验证 Broker 运行链。
