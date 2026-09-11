# Git 审批预检执行边界验收

## 问题与修复

旧仓库指纹调用工作区 `status` 和 `diff`。真实仓库测试证明，这些看似只读的
命令能在用户批准前执行 fsmonitor、clean 或 process 程序；缺失的 promisor
对象还可能触发自动取回及外部传输程序。

预检改用固定策略的 Git plumbing 查询，并由宿主流式读取工作区文件计算哈希。
Git 查询禁用 fsmonitor、子模块自动递归、可选锁、交互提示及 lazy fetch。
缓存区的 raw diff 只比较索引与树，禁用重命名识别、外部 diff 和 textconv；
保留它是为了区分 intent-to-add 与已暂存的空文件，不运行工作区内容转换。
Core diff 基线和整轮恢复基线读取共用这一查询策略。

`--no-lazy-fetch` 的行为见 [Git 官方命令说明](https://git-scm.com/docs/git)；
fsmonitor 可运行外部程序的配置见 [Git 官方配置说明](https://git-scm.com/docs/git-config)。
本机验证为 Git 2.50.1（Apple Git-155）。不支持 `--no-lazy-fetch` 的 Git 拒绝
预检，不退回可能执行外部程序的旧路径；本批不据此声明其他平台支持。

## 指纹与限额

审批上下文新增 `repositoryFingerprintSchema: aibo.git-approval-fingerprint/v2`。
指纹覆盖仓库路径、引用、配置、HEAD、管理目录中的 attributes/exclude/sparse
规则、索引及其标志、跟踪文件实际内容和权限，以及未忽略的未跟踪文件。
宿主读取不依赖 assume-unchanged 或 skip-worktree 的状态判断；初始化子模块
递归读取实际内容，避免不同的脏内容得到相同状态摘要。

所有查询共享 15 秒期限，每次 Git 输出最多 8 MiB；未跟踪内容总计最多
16 MiB。跟踪文件使用 64 KiB 堆缓冲流式哈希，不套用未跟踪文件大小上限。
嵌套仓库深度最多 8、仓库总数最多 128；循环、非空未初始化子模块和未登记的
未跟踪嵌套仓库拒绝预检。路径父目录不能穿过符号链接，末端链接按链接本身哈希。

## 行为证据

- `cargo test --manifest-path src-tauri/Cargo.toml`：190 项通过。
- `pnpm run verify`：25 项架构检查、157 项 Node 测试、类型检查及构建通过。
- Rust 真实仓库正向对照先证明 fsmonitor、clean/process 和自动取回程序可执行，
  再证明受控预检没有运行它们。配置了外部 diff/textconv 的仓库同样通过预检。
- 真实 SQLite 写入服务证明批准回调前没有执行程序、拒绝后仍未执行；批准后的
  暂存操作可正常运行 clean 过滤器，持久结果及暂存内容正确。
- 文件测试覆盖两种索引隐藏标志、intent-to-add、子模块内不同脏内容和 20 MiB
  跟踪文件尾部变化；既有未跟踪内容、引用、配置与大小限制回归通过。

## 原生桌面回归

- `node probes/project-task-cancel-native.mjs`：6 次实际原生按钮点击，验证 Git
  拒绝不改索引、批准暂存、请求去重，以及 Git/双皮肤任务取消后保留早期影响、
  停止后代进程。见[原始结果](./git-read-policy-task-native.json)。
- `node probes/core-hunk-native.mjs turn-git`：实际拒绝与批准各一次，验证整轮
  恢复、重命名、请求重放、旧审计与信任撤销后的历史读取；外部核对工作区并确认
  暂存区保持不变。见[原始结果](./git-read-policy-restore-native.json)。

两次探针使用隔离应用实例及临时工作区，外层均退出 0。清理时终止开发子进程
产生的 pnpm ELIFECYCLE 输出不是探针失败。外部程序禁止执行的证据来自上面的
真实仓库 Rust 测试；桌面探针验证生产 IPC 和审批链回归。

## 边界

这不是操作系统沙箱或原子文件系统快照。忽略的未跟踪文件不进入指纹，也没有
冻结配置引用的任意外部脚本或所有外部属性文件；外部进程仍可能在复核后修改
资源。批准后的 Git 写入仍按仓库配置执行过滤器、钩子等程序，并受既有执行器
的期限、输出与取消约束。通用 Capability 写入仍未开放，P4 总体验收未完成。
主包超过 500 KiB 的既有构建警告保留。
