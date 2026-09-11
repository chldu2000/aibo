# 通用能力直接写入验收

## 验证命令

- `cargo test --manifest-path src-tauri/Cargo.toml`：197 项通过。
- `pnpm run verify`：25 项架构检查、157 项 Node 测试、类型检查及构建通过。
- `node probes/capability-write-native.mjs`：两次实际 App 启动、3 次原生按钮点击，
  见[写入原始结果](./capability-write-native.json)。
- `node probes/call-chain-native.mjs`：两次实际 App 启动，回归原有只读调用链，
  见[只读调用链原始结果](./capability-write-read-chain-native.json)。

主包仍有超过 500 KiB 的既有警告，没有调整阈值。两种原生探针均以外层退出码
0 和 JSON 断言为准；主动清理开发子进程会输出 pnpm ELIFECYCLE。

## Rust 真实行为

新 fixture 声明非幂等写入，将输入追加到临时工作区文件。测试使用实际安装包、
Node 进程、SQLite、可观察的启动标记及独立子进程，不靠 mock 写入成功证明。

- 宿主确认前已有 awaiting_approval 意图，但没有 invocation、插件启动或文件
  修改；拒绝及重复拒绝均不执行。旧无批准入口不能调用写操作。
- 可执行依赖的版本脚本先由安装/启用产生正向标记，再清掉标记，证明审批预检
  没有运行它；批准后该脚本确实运行。修改后的慢版本脚本可被取消，后代延迟
  文件写入停止，插件入口未启动，结果保守记录为未知。
- 同请求重复、同工作区冲突返回 busy；不同工作区可独立写入。成功只追加一次，
  原 caller、权限和调用链由宿主注入。
- 信任、路径、绑定、包文件、会话归档变化，以及原窗口取消/停用插件，阻止等待
  审批的写入。其他窗口不能通过取消 API 停止原窗口请求。
- 真正写入后取消、超时、崩溃、非法输出均保留早期内容，写入记录为未知；不会
  自动回滚或重试，进程组后代的延迟效果停止。
- 卸载、撤销信任和新建 Broker 后仍能读取原成功/拒绝结果。改变输入或窗口
  不能冒用已有请求 ID。
- 会话作用域遵守固定安装与工作区身份；关联写入的 running invocation 在恢复
  时记为 outcome_unknown。旧只读 invocation 保留原 interrupted 恢复语义。
- 数据库触发器拒绝结算时，返回未知、保留未结算占用；启动恢复后原请求不再执行。

## 原生桌面证据

写入探针使用独立 identifier、数据库和临时工作区，通过生产前端 API 与 Tauri
IPC 调用新入口。实际点击一次拒绝和两次批准，完成一次普通写入与一次运行中
撤销信任/取消。独立宿主执行历史包含 rejected、completed、outcome_unknown。
随后卸载插件，关闭并重新启动同一隔离 App，重放三种请求并读取历史。

外部脚本检查文件恰有两次追加、插件恰好启动两次，没有后代延迟写入。重启阶段
没有原生审批或新进程启动。只读探针另验原始调用者、权限交集、固定依赖 release、
过期 generation 拒绝、跨重启调用与禁用依赖，无 Agent session。

## 验收范围

本批只开放窗口直接调用的 workspace/session 写入。插件间写入、安装语义视图
写动作和完整页面生命周期交互仍待后续验收。原生结果仅证明 macOS，Windows
写入尚未激活；不宣称任意本机代码受操作系统沙箱限制。详细协议和限制见
[实施说明](../../plugin-platform-p4-capability-writes.md)。
