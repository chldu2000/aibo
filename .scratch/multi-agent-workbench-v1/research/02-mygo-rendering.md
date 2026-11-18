# 调研：MyGO 原生 UI 能否渲染 Agent 会话

对应任务：`../issues/02-mygo-rendering.md`
来源：MyGO 仓库 https://github.com/egoist/mygo ，commit `400ba3b`（2026-11-18），下文路径都相对于仓库根目录。只读了文档和源码，没有在本机跑基准，性能数字引自官方文档。

## 结论

**原生 `ui` 可以胜任，不需要 WebView 混合方案，也不需要 goldmark / chroma。** MyGO 自带一套专门为"流式 LLM 回复 + 聊天列表"设计的组件：`ui/markdown`（含增量解析器）、`ui/editor`（语法高亮、DiffView、patch 解析）、带变高行和跟随末尾的 `ui.List`、可选择文本，以及 glass 插件。真正要在设计里处理的缺口只有一个：**跨消息选择不能覆盖虚拟列表里没有构建的行**（见第 3 节）。

## 1. Markdown 渲染

- `markdown.View`（已完成的消息）和 `markdown.Stream`（流式消息）。按 token 追加时只重新解析最外层仍未闭合的块，已经完成的块不会再解析或重新排版，所以每个 token 的开销和回复长度无关。来源：`docs/ui/markdown.md` "Streaming replies"。
- 消息尚未写完时，按最可能的最终语法显示：未闭合的 `**`、代码栅栏、链接、表头都会预先处理，避免闪烁。Reveal 支持逐词、逐行等节奏和淡入效果（`AtOnce` 可以关掉）。
- 支持 CommonMark 0.31.2 全部 652 个用例、GFM 表格、任务列表、删除线、自动链接、脚注和数学公式。对中文强调规则做了放宽（`**结论。**后文` 能正确加粗）。解析器在 `ui/markdown/parser`，只依赖标准库。来源：`docs/ui/markdown.md` "The parser"。
- 扩展点：`Block`、`CodeBlock` / `Code[lang]`、`HTML`（可接 `<details>`/`<think>`）、`LinkMenu`、`OnLink`、`LinkIcon`、`InlineMath`、`LoadImage`、`Theme`。工具调用、思考块这类自定义块可以从这里接入。原始 HTML 一律按文本显示，安全。
- 示例：`examples/markdown-chat/main.go`，即 `ui.List` + `FollowEnd` + `markdown.Stream`/`View` 切换。

## 2. 代码高亮与 Diff

- Markdown 代码块直接复用代码编辑器的分词器和配色，逐行增量高亮；流式输入的代码块只高亮新增的行，并按块分段排版。代码块自带语言标签和 Copy 按钮。来源：`docs/ui/markdown.md` "Code"。
- 内置 37 种语言，包括 Go/TS/Python/Rust/Shell/YAML/SQL/Diff/Dockerfile 等，可以自定义 `Tokenizer`，也可以接 tree-sitter 风格的 `Highlighter`。来源：`docs/ui/code-editor.md` "Languages and highlighting"，`ui/editor/languages.go`。
- `editor.DiffView`：支持并排或统一视图、词级高亮、折叠未改动行，只绘制可见区域；超过 1 万行或 1 MB 时在后台比较。`editor.ParsePatch` / `SetPatch` 可以直接显示 unified diff（Agent 工具输出的 patch 正好适用）。来源：`docs/ui/diff-viewer.md`（"Patches" 一节）。
- 不需要 chroma；只有内置语言不够时才需要自己写 Tokenizer。

## 3. 可选择 / 复制的文本（唯一的实质缺口）

- `Selectable` 容器内的 `Text`/`RichText` 共享同一个选区，可以跨段落拖选，复制支持纯文本、HTML 和 Markdown；"Copy as Markdown"（Shift+Cmd+C）会补全被截断的语法；流式增长时选区保持不变。来源：`docs/ui/markdown.md` "Selecting and copying"，`docs/ui/text.md` 第 98–138 行。
- `markdown.Options.ShareSelection` 可以把多条消息交给外层同一个 `Selectable`，实现跨消息选择（`ui/markdown/view.go:126`）。
- **限制**：`docs/ui/text.md:131` 写明："A virtualized list only includes the paragraphs it has built, so use a regular scroll container when selecting an entire document." 也就是说，在 `ui.List` 中，跨消息拖选和 Select All 只能覆盖已构建的行（可见行加少量预渲染行）。
- 建议：单条消息内可以完整选择；跨消息复制改为由工作台的数据模型提供，例如"复制此消息/复制为 Markdown"按钮，或者用 `ui.List` 的 `Selection` 选中多行消息再导出。这正好和"引用范围 = 一段连续消息"的交互对得上：用行选择选范围，而不是用文本拖选。

## 4. 虚拟列表、变高条目、流式追加

- `ui.List` 只构建可见行，行高由内容决定、可以各不相同（未测量的行按已测量的估算）；滚动位置按"行"记录而不是按偏移量，所以上方行长高或插入时视图不会跳。来源：`docs/ui/list.md` 开头和 "List state"。
- 和会话视图直接相关的字段：`Key`（行状态跟随消息 ID，向上加载历史时位置保持）、`FollowEnd` + `FollowAnimation`（跟随末尾，用户上滚后停止跟随，回到底部后恢复）、`HoldPlace`（展开工具调用折叠块时不跳动）、`Justify(ui.End)`、`AtEnd`/`ScrollToEnd`（"回到最新"按钮）。
- 折叠块：`ui.Collapsible`（`docs/ui/collapsible.md`），可用于工具调用和思考块。

## 5. 长会话性能

官方数据（Apple M5，`GOMAXPROCS=1`，CPU 测量），来源：`docs/ui/performance.md`、`docs/ui/markdown.md` "Performance"：

| 场景 | 每帧 |
|---|---:|
| 百万行 List 的可见行 | 14.5 µs |
| 50 KB Markdown 回复完整显示 | 1.3 ms |
| 同一回复流式输入，每帧 16 B | 0.8 ms |
| 3,000 行放在 List 里，其中一行变化 | 0.2 ms |
| 3,000 行放在普通 Scroll 里，其中一行变化 | 11 ms |

- 即时模式，每帧会重新运行整个 view，开销和"构建了多少元素"成正比。所以长会话**必须**用 `ui.List`（每条消息一行），不能用 `Scroll`。
- 文档提醒，一个 `markdown.View` 每帧会构建它所有块的元素，"a document much longer than a chat's reply is best shown a section at a time"。对 aibo 来说，单条超长工具输出（大文件、长日志）应该截断、折叠，或者改用 `editor` 视图（它只绘制可见行），不要整块塞进 Markdown。
- 只在有变化时出帧，空闲窗口不绘制（`docs/ui/rendering.md`）。可用 `MYGO_FRAME_STATS=1` 定位慢帧。

## 6. macOS 上的 glass 插件

- `plugins/glass`：用着色器绘制 Liquid Glass（macOS 26+ 的材质），在各平台效果一致；提供 `Regular`/`Clear`、`Tint`、`Interactive`、`Clarity`，`glass.Group` 用于合并窗格，`glass.ScrollEdge` 做滚动边缘效果，另有 `Blur`；开启"减少透明度"时退化为不透明背景。来源：`docs/plugins/glass.md`，示例 `examples/liquid-glass`。
- 原生 UI 内容在 glass 下面滚动（工具栏或侧栏浮在会话列表上方）是推荐用法，着色器能采样到下方的原生内容。
- `Glass{Native: true}` 使用系统 `NSGlassEffectView`，**只能采样 WebView 页面或窗口材质，采样不到 MyGO 自绘的元素**。因此在纯原生方案里应该用默认的着色器 glass。

## 7. 如果走混合方案（WebView 会话视图 + 原生外壳），代价是什么

可以做到：`ui.WebView` 能把 WKWebView 嵌进原生 UI 的同一个窗口，支持圆角裁剪、原生弹层覆盖在页面上，页面可以通过绑定调用 Go 方法、监听事件（`docs/ui/web-view.md`，示例 `examples/embed-webview`）。代价如下：

- 要多维护一套前端：markdown、高亮、虚拟列表都得在 JS 侧另选库实现，而原生侧这些都已经内置。
- 流式数据要跨 Go 与 JS 的 IPC 传输，状态有两份。
- 着色器 glass、模糊**看不到页面内容**（`docs/ui/web-view.md` "Limits"）；只有 `Native: true` 在 macOS 26+ 能盖在页面上。
- 键盘焦点和快捷键要在两侧之间路由（`web-view.md` 有专门章节）；`Window.CapturePage` 截图时 WebView 区域是一个洞；Tester 无法检查页面内部。
- 会多出 WebKit 进程的内存开销（文档没有给数字）。
- 唯一的收益是浏览器原生的整页文本选择。第 3 节已经给出更契合领域模型的替代做法，因此**不建议**为此引入混合方案。

## 对 map 的建议

保持"原生 UI + 着色器 glass"的决定。会话视图采用：一个 `ui.List`（每条消息一行，`Key` 为消息 ID，开启 `FollowEnd`）；消息正文流式时用 `markdown.Stream`，完成后用 `View`；工具调用用 `Collapsible`；diff 用 `editor.DiffView`/`SetPatch`；大段输出用 `editor` 或截断。跨消息的复制和引用范围用行选择（`ListState.Selection`）实现，不依赖文本拖选。
