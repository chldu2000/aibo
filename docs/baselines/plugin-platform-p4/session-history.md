# 独立会话历史验收

- 后端：完整 Rust 168 项通过。`session_history::tests::persisted_pi_history_reads_from_a_read_only_database_without_a_runtime` 在只读数据库中读取停用/安装路径不可用的 Pi 会话：未归档、已归档各 151 条消息，均四页完整返回；进程记录为零，跨工作区/会话游标拒绝。
- 必需检查：`pnpm run verify` 通过，23 项架构检查、153 项 Node 测试、类型检查和生产构建。主 chunk 约 507.4 KB，保留 Vite 默认体积提示，未上调阈值。
- 浏览器组件：`node probes/session-history-browser.mjs` 退出 0；两套皮肤浏览 121 条消息、切换归档会话、搜索、返回最新消息，无页面脚本错误。
- 真实 App 外壳：`node probes/host-shell-browser.mjs` 退出 0；两套皮肤会话历史入口可点击，布局切换/恢复后宿主区域保持 DOM 身份，进入标题与 Escape 返回入口焦点通过。
- 范围：消息内容验证使用数据库 fixture，界面消息验证使用注入端口 fixture；未将两者宣称为真实 Agent 分支重放或本批全链路原生消息回归。读取服务只接收 SqlitePool，IPC 架构检查禁止访问数据库以外的 AppState 端口。
