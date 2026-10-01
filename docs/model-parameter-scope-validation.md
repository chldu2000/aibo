# 模型参数范围验证（2026-09-28）

基线提交：宿主 `842b151`、插件仓库 `e2edac0`；本记录对应其后的 SDK 0.1.7 扩展。
目标平台 macOS arm64，宿主私有 Node 24.18.0（当时随包携带；2d86a1f 起发布包不再内置 Node，改为优先使用本机 Node 并按需下载）；Claude Code 插件 0.4.1，Cursor 插件 0.2.3。
合同见[模型配置](model-configuration.md)。

## 改动与证据

- 新输出合同声明 `parameterScope: current-model | all-models`，保留旧输出变体；
  缺失字段沿用矩阵，未知值拒绝，缓存保留合法范围。
- Claude 配置与 Cursor extension 声明 current-model，最低 SDK 0.1.7。
  参数仅用于当前模型，换模型后重新获取；强度修改不重复切模型，并核对原生确认。
- Composer 与操作通知读取 label；外部工作台展示顺序选择，动作目录拒绝跨模型强度。
  默认顺序选择复用公开 Select，原 ModelMatrix 保持供完整目录和旧插件使用。

验证入口与实际范围：

| 验证 | 结果 |
| --- | --- |
| 两仓库 `pnpm run verify` | 宿主 518 项 Node 测试、架构、类型和构建；插件 46 项测试、打包及 Worker smoke |
| `cargo test --manifest-path src-tauri/Cargo.toml --lib` | 270 passed，3 ignored |
| `node probes/model-configuration-browser.mjs` | 旧矩阵在 Material 3 / ak-ui 浅深主题的选择、保留、重挂载通过 |
| `AIBO_MODEL_ONLY=1 node probes/presentation-full-skins-browser.mjs` | 实际 App 的顺序选择通过；另用 `AIBO_BUILTIN_KIT`、`AIBO_BUILTIN_THEME` 覆盖两 kit 的浅深主题 |
| 同一探针加 `AIBO_MODEL_EXTERNAL=1` | 两个独立构建的外部工作台（shadcn、Material 3）均完成模型与强度选择；浏览器原生 IPC 为替身 |
| 插件仓库 `PROBE_CONFIG_ONLY=1 CLAUDE_PLUGIN_PATH=<package> node scripts/probe-claude-code.mjs` | 打包 Claude Worker → ACP 0.81.2 → Claude 2.1.280，5 模型、6 推理选项；真实切换、恢复原模型和参数隔离通过 |
| 插件仓库 `node scripts/probe-cursor-models.mjs` | 真实 Cursor 返回 40 模型；current-model 声明、切换到 Auto 与跨进程恢复通过 |
| `AIBO_EXPECT_PARAMETER_SCOPE=current-model node probes/default-session-profile-native.mjs <claude-package>` | 隔离桌面安装 0.4.1、默认 Plan 打开、Rust IPC 模型投影保留范围、关闭通过 |
| `pnpm tauri build --bundles app` | macOS arm64 Aibo.app 构建完成 |

真实 CLI 验证只读取或切换配置，不发送模型 prompt，不证明各模型的账号额度或实际生成能力。
原用户数据库及插件安装没有被这些隔离探针修改。旧会话仍固定原 release。

## 未通过与未覆盖

完整 `presentation-full-skins-browser.mjs` 曾在顺序选择之后的审阅布局检查失败：
外部工作台重绘期间 `boundingBox()` 返回 null。记录在 `/tmp/aibo-sequential-full-skins.log`；
未移除该断言。新增聚焦模式独立完成本次模型选择验收，不宣称完整布局回归通过。

未验证其他 OS/架构、代码签名及公证。本次没有新增认证引导，也没有修改旧会话的绑定。
