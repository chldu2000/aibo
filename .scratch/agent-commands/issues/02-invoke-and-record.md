# 用户怎样调用 Agent 命令、会话怎样记录

Type: grilling
Label: wayfinder:grilling
Status: open
Blocked by: 01

## Question

按 01 的结论，决定输入框里 `/` 补全的内容与排序（名称、说明、来源），界面统一的 `/名字 参数` 如何由适配器翻译成 Claude 和 Codex 各自的调用方式，以及调用后会话时间线上出现什么：用户消息原样记录；Claude 本地命令（`/context`、`/usage` 等）的 `<synthetic>` 回复和 `local_command_*` 事件怎样显示；命令无回复或报错时怎样显示。说明 `/Users/...` 这样的路径和不在清单中的 `/单词` 如何处理。
