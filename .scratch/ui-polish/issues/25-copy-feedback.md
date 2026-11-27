# 25: 复制后给出“已复制”反馈

Status: ready-for-agent

**What to build:** 点了“复制”以后有一个短暂的反馈，让用户知道内容已经写进剪贴板。

现状：消息悬停工具栏的“复制”（`internal/shell/actions.go:26`）和选择模式的“复制”（`internal/shell/selection.go:163`）都只调用 `c.WriteClipboard`，界面上没有任何变化。12 的“没有验证”里已经记下这一点。文件预览的复制路径（`path_actions.go`）、概览里复制会话 ID（`details.go:369`）也一样。

- [ ] 点击后按钮的图标换成对勾（`checkmark`）约 1.5 秒，Tooltip 改为“已复制”，然后恢复；用 `Shell.later` 定时
- [ ] 选择模式的“复制”同样处理；如果复制后退出了选择模式，就在原位置用一个淡出的“已复制”小提示代替
- [ ] 所有调用 `WriteClipboard` 的按钮用同一个辅助函数，不各写一套
- [ ] 按钮的 Label 不随状态变化，Tester 仍能按原 Label 找到
- [ ] “已复制”文案进 `locales`
- [ ] Tester：点复制后出现“已复制”，过一会儿恢复

## 来源

12 的“没有验证”。用户 2026-11-28 确认要做。
