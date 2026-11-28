# aibo 界面与交互打磨

对照 Claude 桌面端、Codex App、Cursor、VS Code Chat 等 Agent 工作台，检查外壳（`internal/shell`）在面板尺寸、展开收起、列表长度、会话流和侧栏标签页结构上的欠缺。结论来自读代码，没有运行应用；工单里标“先核实”的要先跑起来确认。

## 约定

- 界面文字进 `locales/`，两种语言同时写；新控件的 Label 在同一画面内唯一。
- 需要跨重启保留的界面状态（宽度、收起、上次的标签页）用工作台的 `Pref` / `SetPref`（`internal/workbench/settings.go`），外壳不碰 `store`。
- 新快捷键用 `ui.Cmd`：macOS 上是 ⌘，Windows 上是 Ctrl。`ui.Super` 在 Windows 上是 Win 键，会和系统快捷键冲突（Win+↓ 最小化窗口），不要用。也不要和 MyGO 已有的快捷键冲突。
- 提示里的快捷键用 `cmdKey`、`shiftCmdKey` 和 `locales.WithShortcut` 拼出来，按平台显示，文案里不写死 ⌘。
- 交互用 MyGO Tester 测；涉及工作台的新状态（未读等）测在工作台层。

## 工单

第一批，改动小、体感最明显：

- [01 侧栏可以收起](issues/01-sidebar-collapse.md)
- [02 记住侧栏宽度并限制范围](issues/02-sidebar-width.md)
- [03 详情面板可以拖动宽度](issues/03-inspector-width.md)
- [04 消息底部留白跟随输入区](issues/04-composer-clearance.md)
- [05 回到底部](issues/05-jump-to-bottom.md)
- [06 详情面板记住上次的标签页](issues/06-inspector-memory.md)
- [07 会话搜索不在每帧查库](issues/07-search-debounce.md)

第二批，会话流：

- [08 连续的工具调用合成一组](issues/08-group-tool-calls.md)
- [09 展开的工具调用限高](issues/09-tool-output-caps.md)
- [10 改文件的调用显示差异（Claude Code、Codex）](issues/10-edit-diff.md)
- [11 一轮结束后留下耗时](issues/11-turn-summary.md)
- [12 消息的悬停操作](issues/12-message-actions.md)
- [13 输入区上方的横幅合并](issues/13-banner-stack.md)
- [14 序号列只在需要时显示](issues/14-seq-gutter.md)
- [23 改文件的调用显示差异（ACP）](issues/23-acp-edit-diff.md)

第三批，结构：

- [15 会话行显示时间、状态点和未读](issues/15-session-row.md)
- [16 新会话的总入口](issues/16-new-session.md)
- [17 工作区分组可折叠，长列表收起](issues/17-sidebar-lists.md)
- [18 详情标签页显示数量并分组](issues/18-inspector-tabs.md)
- [19 概览只放信息，去掉重复的入口](issues/19-dedupe-actions.md)
- [20 详情面板里的长列表](issues/20-inspector-lists.md)
- [21 文件预览的操作](issues/21-file-preview-actions.md)
- [22 空会话的引导](issues/22-empty-session.md)

第四批，第二、三批做完后发现的小问题（2026-11-28）：

- [24 详情面板里的大输出贴合面板高度](issues/24-inspector-output-fit.md)
- [25 复制后给出“已复制”反馈](issues/25-copy-feedback.md)
- [26 “显示参数”和“思考”的折叠标签不重复](issues/26-collapsible-labels.md)
- [27 徽章行和横幅跟输入区一样宽](issues/27-badges-width.md)

进度（2026-11-28）：全部完成。

## 不做

- 编辑工作区文件、Git 写操作、向终端或子 Agent 发输入：属于只读侧栏之后的规划（`../session-workspace-sidebar/map.md`）。
- 每轮的 token 用量：适配器目前不报告用量事件，需要先做协议调研。
