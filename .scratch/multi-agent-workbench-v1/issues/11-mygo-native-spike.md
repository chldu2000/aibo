# 用 MyGO 验证会话视图的原生渲染

Type: task
Status: open

## Question

“MyGO 原生 UI 能否渲染 Agent 会话”的结论只来自阅读源码，没有实际运行过。在本机用 MyGO 写一个一次性的会话视图（假数据，不接 Agent），实测以下几点：
1. `ui/markdown` 的 Stream 能否流畅渲染流式追加的 Markdown 回复，包括代码块高亮。
2. `ui.List` 在数千条变高消息下的滚动、贴底和 `HoldPlace` 表现。
3. 着色器 glass 在 macOS 上的实际观感，内容在玻璃下方滚动时的效果和性能。
4. 用 `ListState.Selection` 按整条消息选中，从数据模型复制，能否覆盖“选定引用范围”和“跨消息复制”两种需求。
5. 超大的工具输出用截断、折叠或编辑器视图展示的效果。

把结论、截图和遇到的坑记下来，代码放到一次性分支，不合并。
