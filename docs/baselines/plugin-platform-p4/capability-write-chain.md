# 插件间写调用验收

## 验证结果

- `cargo test --manifest-path src-tauri/Cargo.toml`：203 项通过。
- `pnpm run verify`：25 项架构检查、158 项 Node 测试、类型检查及构建通过。
- `node probes/capability-write-chain-native.mjs`：两次实际 App 启动，6 次原生
  按钮点击；见[调用链原始结果](./capability-write-chain-native.json)。
- `node probes/project-task-cancel-native.mjs`：既有任务/Git 的 6 次原生审批、
  双皮肤执行历史与停止行为回归通过；见[宿主写入回归](./capability-write-chain-host-regression.json)。

两个原生探针的外层进程均退出 0。清理开发子进程的 pnpm ELIFECYCLE 输出
不是验收失败。主包超过 500 KiB 的既有警告保留，未调整构建阈值。

## Rust 行为证据

测试使用真实安装包、Node 进程、SQLite 和临时工作区追加文件；每个插件另有
独立进程启动标记。新的 `capability-write-chain` fixture 可以组成多层依赖。

- 三层写入分别批准，批准前当前层没有启动。共享根占用期间，同工作区的独立
  写入被拒绝，其他工作区仍可使用。三个 write run 的父/根关系、三个 invocation
  的原始窗口与较早 deadline 对齐，成功后工作区占用释放。
- 为叶子安装较新 release 并修改 UI provider 绑定，调用链仍执行原来固定的
  release。重放根请求不再提示或执行；拿子请求 ID 从窗口单独重放会因身份
  不符被拒绝，不能把内部子请求改造成另一项直接写入。
- 子审批拒绝只留下 rejected 子意图，不创建子 invocation、不启动子进程；父
  已写内容保留，父可在输出中处理拒绝，根重放仍不重复父的写入。
- 根取消、父 deadline、父进程崩溃、独立停止待审批子写入，以及子包停用或
  内容改变，都拒绝未批准子写入。其他窗口不能通过 run ID 取消原窗口的请求。
- 子写后取消、非法输出或崩溃导致根未知；准备忽略子失败的父插件不会收到
  可继续成功执行的机会。重复子 RPC ID 只执行叶子一次。
- 子结果结算触发器失败后，根仍返回未知，未结算子记录保留 busy 占用；恢复
  将该子记录置为未知，不能因父输出成功而丢弃这一失败。
- read → write 和 write → read → write 均在子审批之前拒绝权限扩大；伪造
  generation 或未声明依赖同样不能启动叶子进程。

恢复测试在“父 running、子 awaiting_approval”的真实数据库上执行一致性副本，
原调用正常拒绝收尾。对副本运行启动恢复，验证父未知、子拒绝，父/根 ID 原样
保留；根重放不启动子进程。这是精确状态的数据库恢复测试，并非声称在待审批
时真实强杀了桌面应用。

## 原生桌面证据

隔离 App 使用临时工作区，按生产前端 API → Tauri → Broker → 父进程 → Broker
→ 子进程执行。三次根请求各触发父、子两个原生确认：一次拒绝子请求、一次
完成整链、一次批准子写入后从独立执行记录按子 run ID 停止。

独立历史恰有六条记录：三个 completed、一个 rejected、两个 outcome_unknown，
父/根关系完整。外部脚本核对父文件追加三次、叶子追加两次；父进程启动三次、
原叶子两次，新 UI 绑定的叶子从未启动，取消后的延迟后代效果没有出现。

随后撤销信任、卸载父和两个叶子 release，关闭并重新启动同一隔离 App，重放
三个根请求并读取六条历史。没有新审批、进程或追加内容。此原生证据覆盖终态
跨重启；待审批恢复另由上面的数据库副本验证。

## 范围

本批仅声明 macOS 原生验收，不声明跨平台或任意本机代码沙箱。安装语义视图
写动作、完整工作台与整体交互仍待验收。协议与边界见
[插件间写调用实施说明](../../plugin-platform-p4-write-chain.md)。
