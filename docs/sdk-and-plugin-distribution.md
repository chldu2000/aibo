# SDK 公开发布与按仓库安装插件：迁移计划

状态：提案，未实施。本文不改变现行安装、授权与版本规则；现行规则见
[宿主 SDK](host-sdk.md)、[插件开发指引](plugin-development_zh.md)与
[宿主和插件边界](plugin-boundaries-and-regression.md#插件卸载与会话迁移)。

## 背景与问题

### SDK 只能从宿主源码获取

宿主 SDK 分两层：

| 层 | 内容 | 现状 |
| --- | --- | --- |
| 运行时 | `packages/plugin-host/sdk.json` 快照，嵌入原生应用；插件以 `hostSdk` 声明兼容范围，安装包不携带 SDK | 随 Aibo 发布，当前 0.1.8 |
| 开发时 | `@aibo/plugin-protocol`、`capability-runtime`、`acp-adapter`、`web-presentation`、`presentation-tools`、`presentation-workbench` 的类型与本地工具，作为插件的 devDependencies | 全部 `private: true`，不发布 |

插件作者因此必须拿到 Aibo 源码：`aibo-plugins` 的构建从相邻的 `../aibo` 现场打包 tarball，
再离线安装到独立构建目录。外部作者没有可声明的依赖版本，也没有可锁定的 lockfile。

npm 包版本与宿主 SDK 版本也互不对应：SDK 已是 0.1.8，而 `capability-runtime` 为 0.1.1、
`acp-adapter` 为 0.1.1、`plugin-protocol` 为 0.1.0。作者无法从依赖版本推出应写的
`hostSdk.min`；0.1.7 的 ACP 用量映射就曾在未升级 SDK 版本的情况下进入快照。

### 插件只能从本机目录安装

`preview_plugin_install` / `install_agent_plugin` 与 `install_presentation_package` 只接受本机路径。
用户需要自行获取、解压构建产物，再在对话框中选目录；版本更新也要重复这一过程。
宿主不记录插件来自哪里，因此无法提示更新，也无法在升级时确认发布者没有变化。

现有安装流程本身已经完整：预览引用并签发确认 token、首次安装默认禁用、
同一 pluginId 走可撤销替换、包内容按摘要固定、拒绝符号链接、安装时不执行 npm。
缺的只是“从哪里取得包”这一步。

## 目标与非目标

目标：

- 插件作者通过公共包注册表获取 SDK，按版本声明依赖，不需要 Aibo 源码。
- 宿主运行时提供的 SDK 包版本与宿主 SDK 版本一致，作者可直接推出 `hostSdk.min`。
- 用户只需提供插件所在的 Git 仓库（或点击网页上的安装链接），即可预览并安装与当前平台、
  宿主版本兼容的插件；之后可从同一来源检查和安装更新。
- 下载与解压不放宽现有的包校验、确认、替换与授权规则。

非目标：

- **不在用户机器上从源码构建插件。** 现场构建需要用户具备 npm 与构建工具链，会在用户确认前
  执行仓库中的任意脚本，结果也不可复现；这与“安装不执行 npm”和不可变 release 相冲突。
  例外仅限无需构建的纯配置插件，见 D3。
- 不建设中心化插件市场或评分体系。Git 仓库只是来源，不是信任背书。
- 不改变运行时 SDK 的分发方式：插件安装包仍不携带宿主 SDK 包（`@aibo/*` 或改名后的 `@aibolabs/*`）。
- 不改变能力协商、执行授权与会话迁移规则。

## 设计

### 一、SDK 发布

**注册表与包名。** 发布到 npm 组织 `aibolabs`（`@aibolabs` scope），GitHub 组织使用同名 `aibolabs`（两者已于 2026-10-01 注册），
使 npm provenance 与按仓库安装显示的发布者一致。npm 与 GitHub 上的 `aibo` 均已被占用，
`@aibo` 无法注册，因此现有包名在首次发布前改为 `@aibolabs/*`，例如
`@aibo/acp-adapter` → `@aibolabs/acp-adapter`。改名同时涉及：

- 两个仓库中的包名、import 与 devDependencies（约 52 个文件）；
- 宿主 SDK resolver 的保留前缀（`packages/plugin-host/loader.mjs` 的 `@aibo/`）与 `sdk.json` 导出映射；
- 宿主 SDK 文档、插件开发指引与 `aibo-plugins` 中禁止携带 `node_modules/@aibo` 的检查。

已安装插件按旧前缀导入运行时 SDK，宿主 resolver 在 0.x 期间同时接受 `@aibo/` 与 `@aibolabs/`，
旧前缀在文档中标为弃用，移除另行决定。发布的包移除 `private`，补齐 `repository`、
`license` 与 `publishConfig.access: public`。

**两条版本线：**

| 包 | 版本规则 |
| --- | --- |
| `@aibolabs/plugin-protocol`、`@aibolabs/capability-runtime`、`@aibolabs/acp-adapter` | 等于宿主 SDK 版本（`scripts/build-host-sdk.mjs` 的 `version`）。由宿主在运行时提供的包，开发依赖版本即 `hostSdk.min` |
| `@aibolabs/web-presentation`、`@aibolabs/presentation-tools`、`@aibolabs/presentation-workbench` 及皮肤包 | 各自独立的语义化版本，按呈现包合同与 hostApi 演进 |

第一类包首次对齐时直接发布为 0.1.8；已有的 0.1.0 / 0.1.1 未公开发布，不需要兼容。

**一致性检查。** `pnpm run verify` 增加检查：第一类包的 `package.json` 版本必须等于 SDK 快照版本；
快照内容变化而版本未变时失败。这样“改了运行时行为却没升 SDK”会在合并前被发现。
检查只比较版本与已生成快照，不在 CI 中访问注册表。

**发布流程。** 推送 `sdk-v<version>` tag 时由 GitHub Actions 执行：

1. 运行 `pnpm run verify` 与 `node scripts/build-host-sdk.mjs --check`。
2. 构建 `plugin-protocol`（tsc），按依赖顺序 `npm publish --provenance` 第一类包。
3. 呈现类包使用各自的 `presentation-*-v<version>` tag，流程相同。

带有新 SDK 快照的 Aibo 应与 npm 包同时或更早发布。旧宿主遇到 `hostSdk.min` 更高的插件，
会在激活诊断中拒绝启用，这一机制已存在。

**插件仓库迁移。** `aibo-plugins` 改为从注册表安装 SDK 开发依赖并提交 lockfile，构建不再读取
`../aibo` 源码；本地联调仍可用 `AIBO_ROOT` 覆盖为源码 tarball。

### 二、发布产物与索引（插件仓库侧约定）

插件仓库在打 tag 时由 CI 构建并上传 GitHub Release：

- 每个插件、每个目标平台一个归档（`.tar.gz` 或 `.zip`），解压后根目录即
  `plugin.json` 或 `presentation.json` 所在目录，不含符号链接。
- 一个索引文件 `aibo-index.json`，描述该 Release 中的全部插件：

```json
{
  "schema": "aibo.plugin-index/v1",
  "packages": [
    {
      "kind": "capability",
      "id": "dev.example.agent",
      "version": "0.4.3",
      "displayName": "Example Agent",
      "platforms": ["darwin-arm64"],
      "hostSdk": { "min": "0.1.8", "maxExclusive": "0.2.0" },
      "host": { "min": "0.1.0", "maxExclusive": "0.2.0" },
      "asset": "example-agent-0.4.3-darwin-arm64.tar.gz",
      "size": 18234567,
      "sha256": "…"
    }
  ]
}
```

`kind` 为 `capability` 或 `presentation`；一个仓库可以包含多个插件。`asset` 是同一 Release 内的
文件名，不接受任意外部 URL。索引字段只用于筛选和预览，安装时仍以解压后的清单为准；
两者不一致时拒绝安装。

打包与生成索引提供可复用工具（GitHub Action 或 `aibo-plugin pack` 脚本），沿用现有产物检查：
缺失依赖、开发机路径与符号链接（见 [`build-external-plugin.mjs`](../probes/build-external-plugin.mjs)），
以及 `aibo-plugins` 构建中不得携带 `node_modules/@aibolabs`（及旧前缀 `@aibo`）的检查。
新增 `contracts/plugin-index.v1.schema.json` 作为索引合同。

### 三、宿主侧安装流程

```mermaid
flowchart LR
  input[仓库地址或 aibo:// 链接] --> resolve[解析最新 Release 与索引]
  resolve --> pick[按平台、宿主与 SDK 版本筛选并选择]
  pick --> fetch[下载归档：HTTPS、大小上限、sha256]
  fetch --> extract[安全解压到临时目录]
  extract --> existing[现有 preview → 确认 token → 安装/替换]
  existing --> record[记录来源：仓库、tag、归档摘要]
```

1. **输入。** 插件页新增“从仓库安装”，接受 `github.com/<owner>/<repo>`、`owner/repo`，
   可选附带 tag。首版只支持 GitHub；其他托管平台按同一索引约定另行接入。
2. **解析。** 读取指定 tag（默认最新非预发布 Release）的 `aibo-index.json`，按当前平台、
   宿主版本与 SDK 版本筛选。不兼容的条目显示原因但不可选。
3. **下载。** 新增 `src-tauri/src/plugin_sources.rs`，复用 `node_runtime.rs` 已验证的下载与解压实现：
   仅 HTTPS、有限重定向、连接与总超时、流式大小上限（不超过 `MAX_PACKAGE_BYTES`），
   下载完成后校验 sha256；解压只接受普通文件和目录，拒绝符号链接、绝对路径与 `..`。
   可从 `node_runtime.rs` 抽出公共函数，两处共用。
4. **安装。** 解压目录交给现有 `preview_plugin_install` / `install_agent_plugin`
   （呈现包交给 `install_presentation_package`），确认、默认禁用、替换与撤销规则全部不变。
   临时目录在安装完成或取消后清理。
5. **来源记录。** 新迁移为安装记录增加来源字段：托管平台、仓库、tag、归档 sha256，
   以及 D4 的发布者公钥指纹。来源不参与包摘要，也不授予任何权限。
6. **深链接。** 接入 Tauri deep-link，注册 `aibo://install?repo=<owner>/<repo>[&tag=…][&id=…]`。
   链接只打开安装预览，不跳过确认；应用未运行时启动后进入同一流程。
7. **更新。** 有来源记录的插件可“检查更新”：重新解析该仓库，版本更高且兼容时提供升级，
   升级走现有可恢复替换事务。首版只做手动检查，不做后台自动更新。

### 四、信任与完整性

- **来源不等于可信。** 预览突出显示仓库所有者、可执行依赖、平台与请求的能力；首次从某来源安装时
  明确提示“来自第三方仓库”。插件安装后默认禁用，这一规则保留。
- **完整性。** sha256 来自同一 Release 的索引，只保证归档与索引一致，不证明发布者身份。
- **发布者身份（D4）。** 索引附带签名（例如 ed25519 / minisign）。首次安装时记住公钥指纹（TOFU），
  之后同一插件的更新必须由同一密钥签名；密钥变化时阻止自动升级并要求用户重新确认。
  也可评估 GitHub artifact attestations，但不让宿主依赖 GitHub 专有服务才能校验。
- **网络边界。** 下载由原生宿主执行，呈现层和插件进程不获得新的网络能力；仅在用户触发
  安装或检查更新时联网，启动时不访问网络。

### 五、纯配置插件的源码安装

只有 `plugin.json`、`acp.json` 和一行 `worker.mjs` 的 ACP 插件（如 `acp-template`）无需构建。
对这类插件，允许不经 Release 直接安装：按 tag 或 commit 下载仓库归档，取出索引或用户指定的
子目录，要求目录内只有清单、配置与不含第三方依赖的入口，否则拒绝并提示使用 Release 产物。
来源记录固定到 commit SHA。

## 阶段

### D1：SDK 公开发布

- 包名改为 `@aibolabs/*`，宿主 resolver 同时接受新旧前缀。
- 第一类包版本对齐宿主 SDK，`verify` 增加版本一致性检查。
- 发布工作流与 tag 约定；首次发布 0.1.8。
- `aibo-plugins` 改为从注册表安装 SDK，更新其 README 与构建脚本。

验收：仓库外的新目录只依赖注册表即可构建 `acp-template` 与能力示例，安装到同版本 Aibo 后
握手与会话流程通过；以旧前缀 `@aibo/` 构建的已安装插件仍能启动；修改 SDK 快照而不升版本时 `verify` 失败。

### D2：从归档 URL 安装

- `plugin_sources.rs`：下载、大小与 sha256 校验、安全解压，接入现有安装流程。
- 内部入口先支持“归档 URL + sha256”，用于打通链路和测试，不作为最终用户界面。

验收：Rust 测试覆盖超限、摘要不符、符号链接、路径穿越、重定向超限与中断清理；
真实归档经现有预览与替换流程安装、撤销。

### D3：按仓库安装与深链接

- 索引合同、打包工具（Action 或脚本）；`aibo-plugins` 的 Release 工作流产出索引。
- 插件页“从仓库安装”、平台与版本筛选、多插件选择；`aibo://install` 深链接。
- 来源记录迁移；纯配置插件的源码安装。

验收：输入 `aibo-plugins` 仓库地址，可在 macOS arm64 上看到并安装 Cursor、Claude Code、
模板与能力示例；不兼容平台的条目显示原因；深链接只打开预览；数据库迁移遵守
[迁移规则](database-migrations.md)。

### D4：更新与签名

- 基于来源记录的“检查更新”，复用替换事务。
- 索引签名与发布者公钥固定；密钥变化时的确认流程。

验收：新版 Release 发布后可检查并升级、撤销；篡改索引或换用其他密钥签名时拒绝升级。

## 风险与缓解

| 风险 | 缓解 |
| --- | --- |
| 改名遗漏或破坏已安装插件 | 首次发布前一次完成改名；resolver 同时接受新旧前缀并有回归测试；`verify` 检查仓库内不再出现旧包名 |
| 包版本与 SDK 版本再次脱节 | `verify` 强制一致；快照变化必须伴随版本变化 |
| 下载内容被替换或损坏 | HTTPS、sha256、大小上限；D4 增加签名与发布者固定 |
| 解压逃逸或链接攻击 | 只接受普通文件与目录，拒绝符号链接、绝对路径与 `..`；解压后再经现有包校验 |
| 用户把仓库地址误当作信任 | 预览显示来源与能力，首次来源提示，安装默认禁用 |
| GitHub API 速率限制或不可用 | 只在用户操作时请求；失败时保留“从目录安装”入口；可配置 token 不在首版范围 |
| 预构建产物平台覆盖不全 | 索引显式列出平台，筛选时说明缺失原因；不回退到现场构建 |

## 待决问题

1. 已决定：npm 组织与 GitHub 组织均为 `aibolabs`，包名为 `@aibolabs/*`。
2. 第一类包是否另发一个元包（例如 `@aibolabs/host-sdk`）统一锁定版本？
3. 旧前缀 `@aibo/` 的兼容期多长，何时从 resolver 移除？
4. 签名方案：minisign / ed25519 自管密钥，还是基于 Sigstore 的 attestations？宿主离线校验能力如何保证？
5. 是否支持 GitHub 以外的托管平台；首批是否需要 GitLab？
6. 来源记录是否展示在会话或插件详情中，以及卸载后是否保留供重新安装？

## 验证

- 每个阶段宿主运行 `pnpm run verify`；涉及下载、解压、数据库与安装的阶段运行对应
  `cargo test --manifest-path src-tauri/Cargo.toml --lib`，数据库迁移另跑完整 `--lib`。
- 插件仓库运行其 `pnpm run verify`，并在仓库外的干净目录验证只依赖注册表的构建。
- 真实网络下载、深链接与桌面安装需在隔离数据目录中做 macOS arm64 原生验收；
  浏览器替身 IPC 不能证明下载、解压与原生安装行为。
