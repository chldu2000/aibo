# MyGO 原生 UI 能否渲染 Agent 会话

Type: research
Status: resolved

## Question

MyGO 的原生 `ui` 包能否胜任 Agent 会话视图：Markdown 渲染、代码块语法高亮、可选择/复制的文本、变高条目的虚拟列表与流式追加、长会话性能、macOS 上 glass 插件效果？缺失的部分有无现成库或可行的自绘路径？若原生不足，WebView 混合方案（会话视图用 Web、外壳用原生）的代价是什么？

Findings: ../research/02-mygo-rendering.md

## Answer

可以，原生 `ui` 足以承载会话视图，不需要 WebView 混合方案。`ui/markdown` 的 `Stream`/`View` 负责流式 Markdown（支持自定义块、内置 37 种语言高亮），`editor.DiffView` 显示 diff，`ui.List` 提供变高虚拟列表和贴底滚动；glass 使用插件默认的着色器 glass。唯一的缺口是 `List` 内的文本选择只覆盖已构建的行，因此跨消息复制改为通过 `ListState.Selection` 按整条消息选取、从数据模型里复制，这与引用范围的选取方式一致。超大的工具输出需要截断、折叠或改用编辑器视图。详见 [调研结果](../research/02-mygo-rendering.md)。
