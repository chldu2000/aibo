# 数据库迁移规则

## 开发与正式数据隔离

启动宿主时先选择数据目录，再初始化 SQLite、Node runtime、插件、附件和恢复数据。
`tauri dev`（包括 `--release`）、debug 构建及测试构建使用应用数据目录下的 `development/`；
正式 release 打包继续使用原应用数据目录。macOS 默认路径为：

- 正式：`~/Library/Application Support/local.aibo.desktop/aibo.sqlite3`
- 开发：`~/Library/Application Support/local.aibo.desktop/development/aibo.sqlite3`

Windows 和 Linux 使用各自的 Tauri 应用数据目录，隔离规则相同。首次开发启动创建空库，
不会复制、迁移或删除原正式库；工作区、会话和插件需在开发环境单独配置。
数据库单元测试继续使用独立临时目录或内存库；原生探针使用独立应用 identifier，
预置数据库也必须放在其 `development/` 目录下。

此隔离保护正式实例免受开发启动时的 migration 和恢复操作影响。
正式 release 新版本启动仍会迁移正式库；隔离不改变下述迁移冻结与追加规则。

## 冻结与追加

迁移一旦提交到 Git，或应用到需要保留数据的数据库，即按原始字节冻结。开发数据库同样适用。
结构和数据修复使用新的 `NNNN_description.sql`，版本号必须大于现有最大版本，且在 SQLx 的正整数版本范围内。
修改注释、空白、换行符、重命名和删除都会破坏冻结规则。SQL 格式化工具应排除以下目录：

- `src-tauri/migrations/`：应用实际执行的迁移。
- `src-tauri/migration-history/`：已知历史版本的原始 SQL。
- `fixtures/migrations/`：用于重建旧数据库的冻结测试样本。

尚在设计中的 SQL 在临时数据库试验；准备应用到持久开发库前先提交迁移。
检查器无法知道某个尚未提交的新文件是否已经在另一台机器或本地数据库执行过，因此这一步不能由 Git 检查代替。
合并并行开发分支时，仅给尚未提交且未应用的草稿调整编号；已经发生的版本冲突按历史兼容问题处理。

## 自动门禁

`pnpm run check:migrations` 已接入 `pnpm run verify`。检查器比较 Git 中的原始 blob 和文件原始字节，
同时检查暂存区、工作目录及未跟踪的新文件。现有文件必须保留原路径和内容；新迁移编号唯一且只向后追加。
历史兼容目录和样本目录允许新增独立历史版本，但不能修改已有文件。符号链接不作为迁移文件接受。

本地始终以 `HEAD` 为基线；设置 `AIBO_BASE_REF` 时额外对比该基线，以发现分支中已提交的历史改写：

```sh
AIBO_BASE_REF=origin/main pnpm run check:migrations
```

CI 的 PR 使用目标分支 SHA，普通 push 使用 push 前的 SHA，新分支首次 push 使用默认分支。
CI 获取完整历史；缺少基线或全零 SHA 会使检查失败，不会静默跳过。遇到无法解析的基线，先获取对应 Git 历史再重跑。
本地只对比 `HEAD` 无法发现已提交到 `HEAD` 的篡改，因此交付前还需对比目标分支，并保留 CI 检查。

仓库管理员应将 `verify` 和 `database-migrations` 两项设为分支保护的必需检查。
工作流文件本身不能启用 GitHub 的分支保护设置。

## 升级回归

0057 增加持久替换记录及撤销失效触发器，0058 补全宿主配置、能力绑定和启用状态变化的失效规则，
0059 覆盖会话重绑、恢复数据、执行配置及队列新增。
替换记录只保存版本/绑定恢复信息，不回滚业务历史；中断在 runtime 启动前恢复，清理任务可重试。
`plugin_replacement_crash_recovery_restores_partially_migrated_sessions` 覆盖部分完成后的重开恢复。
既有冻结 0055 升级回归继续验证升级到最新结构时历史、设置和全部旧 checksum 不变。

0055 增加插件升级策略、历史只读标记、版本迁移记录和可重试的清理任务。
开发库曾应用缺少 `presentation_removals` 和 `plugin_session_candidates` 的 0055 中间版本；
其原始 SQL 冻结于 `migration-history/0055_plugin_lifecycle_initial.sql`，仅按完整 checksum 识别。
0056 为这份历史版本补齐两张表，对完整的 0055 保持幂等，不改写已有迁移记录或用户数据。
`lifecycle_migration_versions_preserve_data_and_checksums` 覆盖两种 0055 的升级和重复打开，
检查历史、草稿、只读标记、升级策略及全部旧 checksum 保留；未知 0055/0056 checksum 仍拒绝。
`plugin_lifecycle_migration_preserves_history_and_policy_across_reopen` 从冻结的 0054 及之前 SQL 建库，
验证升级和重开后的历史、设置、旧校验值、外键及完整性。

`pnpm run test:migrations` 执行 Rust 中名称包含 `migration` 的测试，已作为独立 macOS CI 任务执行，
覆盖空库、历史 0049、初版与正式版 0051 升级、数据及校验值保留、重复启动，以及未知 checksum 拒绝。
`verify` 保持为 Node 检查和前端构建入口；本地涉及迁移的变更还必须执行迁移测试和完整 Rust 库测试：

```sh
pnpm run verify
pnpm run test:migrations
cargo test --manifest-path src-tauri/Cargo.toml --lib
```

新增迁移时，先从已冻结的旧 SQL 或无敏感数据的数据库样本建立升级前状态，写入代表性的会话、消息、草稿或受影响业务记录，
再通过应用真实的 `open_database` 路径升级并再次打开。断言数据内容、旧迁移 checksum、外键及完整性。
禁止从修改后的当前 SQL 重建同一个“旧版本”来替代冻结样本；前置迁移复用受不可变门禁保护的文件。

## 已发生改写时

1. 从原提交或已知发布版本恢复准确的原始 SQL，保留有数据的数据库。
2. 追加新迁移修复结构或数据，并增加旧库升级回归。
3. 若同一编号已有多个实际应用版本，保留每个已知版本的原始 SQL，按完整 checksum 精确识别并通过后续迁移收敛。
   现有 0051 处理见 [全局搜索](global-search.md) 和 `src-tauri/src/database_migrations.rs`。
4. 保持未知 checksum 拒绝；不通过篡改 `_sqlx_migrations`、关闭校验或删除用户数据库消除报错。

历史恢复可能被门禁阻止。此时应单独评审事故修复及其精确兼容证据，不能通过更新样本、改基线或放宽检查来伪装成普通追加迁移。
