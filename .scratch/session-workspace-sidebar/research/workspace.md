# 工作区文件与 Git 差异的来源

文件树、预览和 Git 状态都可以由 aibo 按工作区读取。两种 Agent 使用同一份工作区事实。以下是锁定源码和官方命令契约的核查，尚未做 MyGO 真机交互或大仓库性能实测。[依赖版本](../../../go.mod) · [工作台分层与并发约定](../../../docs/agents/conventions.md)

## 文件树、预览与刷新

- `files.List` 优先调用 `git ls-files -z --cached --others --exclude-standard`，产出排序后的相对路径并从文件反推父目录。普通目录或 Git 调用失败时退回磁盘遍历。它为文件提及设计，省略空目录和无法枚举的项，最多保留 20 万个文件名，索引中已从磁盘删除的文件仍可能入列。Git 返回零项时当前实现还会退回遍历，可能显示已忽略文件。工作台现有 `MatchFiles` 缓存 30 秒且包含会话获准读取的其他工作区。侧栏可复用路径表达和忽略约定，按当前工作区单独列目录，按需枚举空目录、报告读取失败或截断，并让刷新绕过缓存。[枚举实现](../../../internal/files/files.go) · [工作台缓存与搜索范围](../../../internal/workbench/files.go)
- 锁定版 MyGO 的 `ui.Tree/TreeItem` 由调用者提供子节点和展开状态。普通树会构建全部已展开行，`Outline` 只构建视口行。文本用 `editor.View` 配 `State.ReadOnly=true`，支持选择和复制。差异用 `DiffView` 配 `DiffState.Editable=false`，可展示两份文本，或用 `ParsePatch/SetPatch` 展示 Git 返回的补丁；后者只有补丁中的上下文。纯改名、权限变化、二进制都可能没有文本块，仍可显示状态及路径。[树](https://github.com/egoist/mygo/blob/641de1523c72/docs/ui/tree.md) · [只读编辑器](https://github.com/egoist/mygo/blob/641de1523c72/ui/editor/state.go) · [差异视图](https://github.com/egoist/mygo/blob/641de1523c72/docs/ui/diff-viewer.md) · [补丁解析](https://github.com/egoist/mygo/blob/641de1523c72/ui/editor/patch.go)
- `mygo.WatchFiles` 启动后才报告变化，批次可能合并多次写入，也可能看不到两次扫描之间出现又消失的项。`HintsOnly` 通常只给出受影响的目录。递归监听跳过符号链接和 Windows junction 的目标，条目上限或根目录消失都会终止监听。建议后台监听成功后做首次读取，变化时合并刷新；面板重开、重新获得焦点或手动刷新时重新查询 Git。仅监听工作区文件会漏掉纯暂存、分支移动和工作树外 Git 管理目录的变化。关闭或切换时取消旧任务，按工作区和请求代次接收结果。监听失败时仍可手动刷新。[MyGO 文件通知](https://github.com/egoist/mygo/blob/641de1523c72/watch.go) · [Git 多工作树目录](https://git-scm.com/docs/git-worktree#_details)

## Git 状态与所选变化

先验证工作区目录可访问，用 `git -C <目录> rev-parse --show-toplevel` 定位所属工作树。工作区是子目录时，以工作树根解析 Git 路径，再按工作区范围筛选；跨边界改名可保留方向和状态，限制范围外的内容读取。可浏览的普通目录显示“此工作区未使用 Git”；Git 缺失、目录失效、权限或仓库错误应保留各自的原因，不能把所有非零退出都归为普通目录。仅工作树正常且成功读取状态后才显示“无更改”。[Git 仓库定位](https://git-scm.com/docs/git-rev-parse) · [工作台错误与文案约定](../../../docs/agents/conventions.md)

后台在工作树根运行 `git --no-optional-locks status --porcelain=v2 --branch --find-renames --untracked-files=all -z`。分支来自 `branch.head`，分离 HEAD 用 `branch.oid`，无首次提交时为 `(initial)`。普通记录中的 X 表示暂存状态，Y 表示未暂存状态，`MM` 要有两个独立可选项。按 NUL 保留原始路径，类型 2 在目标路径之后另有原路径。未跟踪用 `?`，冲突用 `u` 并保留各阶段，子模块有独立标志。关闭可选锁可避免后台状态查询写回索引的统计缓存。[Git 状态与机器格式](https://git-scm.com/docs/git-status)

| 所选项 | 旧侧 | 新侧 | 获取与显示 |
| --- | --- | --- | --- |
| 已暂存 | HEAD | 索引 | `git diff --cached`。已暂存新增的旧侧为空，已暂存删除的新侧为空。无首次提交时省略显式 HEAD。 |
| 未暂存的跟踪文件 | 索引 | 磁盘工作树 | `git diff`。删除时新侧为空。例如同一文件先暂存 B 又改成 C，未暂存项只显示 B → C。 |
| 未跟踪 | 空 | 磁盘工作树 | `status` 提供路径，工作区读取器提供新侧。普通 `git diff` 不含未跟踪文件。 |
| 重命名 | 发生改名那一侧比较的原路径 | 对应目标路径 | 暂存改名读 HEAD 原路径与索引目标。若目标又有未暂存修改，另读索引目标与磁盘目标。仅 Git 认定改名时配对；工作树移动也可能报告删除加未跟踪。 |

Git 可直接生成上述跟踪文件的权威补丁，命令使用独立参数、`--literal-pathspecs`、路径前的 `--`；重命名在需要时传入两个路径。建议关闭外部 diff 和 textconv。需要完整对象时，普通记录提供 HEAD 和索引 blob ID，可用 `git cat-file blob <oid>` 读取，相当于相应的 `HEAD:<path>` 或 `:0:<path>`；工作树字节可能受换行和过滤规则影响，展示 Git 所认定的变动时优先采用它的补丁。类型、权限或读取错误不能当成空文件。冲突可先展示状态和路径，避免把 stage 1/2/3 压成普通双侧修改。[比较端点及选项](https://git-scm.com/docs/git-diff) · [Git 路径参数](https://git-scm.com/docs/git) · [对象读取](https://git-scm.com/docs/git-cat-file) · [索引阶段](https://git-scm.com/docs/gitrevisions)

工作台读取层识别越界路径、符号链接、特殊文件、二进制、编码不支持、超限、文件消失或无权限；文件树保留条目，外壳用本地化文字呈现原因。可用工作区根约束文件打开，对符号链接显示链接信息，设备与管道仅显示类型，普通文件和 Git 输出限定读取量。保留原始路径作为选择键，转义控制字符仅用于显示。验收至少覆盖部分暂存、改名后再修改、空文件新增、脱离分支、尚无提交、带空格及通配符的文件名、非仓库和监听失效后手动刷新。[Go 根目录约束](https://pkg.go.dev/os#Root) · [Git 路径与状态格式](https://git-scm.com/docs/git-status) · [aibo 分层约定](../../../docs/agents/conventions.md)
