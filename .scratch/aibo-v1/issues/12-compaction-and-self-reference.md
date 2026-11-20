# 12: 上下文压缩与自引用

**What to build:** Agent 压缩上下文时（自动或由用户手动触发），会话里在对应位置出现一条分隔线，例如“上下文已压缩 · 自动 · 19.7k → 6.3k tokens”，分隔线上方的消息照常显示。用户可以在会话菜单或快捷指令里手动压缩。用户可以把压缩之前的一段内容引用回同一个会话，让 Agent 找回细节。输入 `/clear` 这类 Agent 自带的斜杠命令时，aibo 不转发，提示“暂不支持”。

规格：[aibo v1 规格](../../multi-agent-workbench-v1/spec.md)（会话运行时 · 斜杠命令、压缩事件；引用概要 · 自引用）。

**Blocked by:** 02（在 aibo 里和 Claude Code 对话）、03（在 aibo 里和 Codex 对话）、04（把整个会话推送为引用）

**Status:** ready-for-agent

- [ ] Claude 的 `compact_boundary`（带 trigger 和前后 token 数）和 Codex 的 `contextCompaction` 条目（只有时间戳）都转换为压缩标记，挂在“第 N 条消息之后”，不占序号
- [ ] 手动压缩：Claude 发送 `/compact`，Codex 调用 `thread/compact/start`
- [ ] 以 `/` 开头的 Agent 斜杠命令不转发，提示“暂不支持”
- [ ] 可以把引用发给当前会话自己；自引用概要的首句改为“这是本会话较早的一段内容，你的上下文中可能已不再保留其细节”，省略来源和源工作区两行
- [ ] 读取工具的输出不包含压缩标记
- [ ] 主接缝测试覆盖压缩标记的位置、自引用的概要和读取
- [ ] 契约测试（环境变量开启）覆盖两家的压缩事件
