# 按需读取可核实的原生子会话历史

Status: resolved
Blocked by: 03

协议增强 · [侧栏规格](../spec.md) · 用户故事 9、10、24

## 交付场景

增强工单。优先验证 Codex 目标子线程的只读分页；Claude Code 的独立子历史仅在本机 CLI 提供可验证的读取路径后接入。

## 验收条件

- [x] 针对拟支持的 Agent 留存并发委派、父轮结束、重启后读取的真实样本，核对父会话、子标识与分页归属。
- [x] 只在用户打开对应子项时读取，按需翻页并去重；打开历史不会启动或续跑子 Agent。
- [x] 已清理、无权限、只拿到委派记录或不支持读取时，继续显示可核实的本地步骤或工具卡。用适配器回放和真实契约验证通过的版本。

## 依据

[子 Agent 归属与消息读取](../../session-workspace-sidebar/research/children.md)。前置交付见[从子 Agent 徽章查看委派记录与已保存步骤](03-children.md)。

## 实现与验证

Windows 上 Codex CLI 0.172.0 已采到并发子线程、父轮结束、重新启动 CLI 后的直接父级核对及带游标的第二页。适配器回放核验越界拒绝；工作台真实契约 TestContractSidebarChildHistoryAfterRestart 通过；Tester 验证按需打开、翻页与返回。父轮缺少工具终态时显示结果未知。未采样 Claude，保留已有工具卡与本地步骤。全量 scripts/check.sh、Windows x64 打包、主窗口启动及退出、Windows 原生文件通知检查、macOS arm64 交叉编译均通过。macOS 真机交互未验证。
