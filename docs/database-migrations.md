# 数据库迁移规则

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
