# 17: 在输入框里粘贴、拖入、选择图片

**What to build:** 写消息时，用户能把图片交给 Agent：在输入框里粘贴截图（Cmd+V）、从 Finder 复制或拖入图片文件、点附件按钮选择图片。图片在输入框上方显示为缩略图徽标，可删除；发送后 Agent 看到的是图片本身，不是路径。

现状：`OnPaste` 只记下“这是粘贴”，内容照文字插入；附件按钮灰显（v1 任务 17）；`agent.Turn` 只有文字和文件提及。

**Status:** resolved

已定的设计（2026-11-24）：
1. **附件是快照**：图片复制到数据目录的 `attachments/<会话ID>/`，消息里存元数据。和“文件提及”（ADR 0004，只给路径）不同：剪贴板里的截图没有路径，Codex 拿着路径也看不到画面。写一篇 ADR，`GLOSSARY.md` 加“附件”。
2. **第一版只做图片**（PNG、JPEG、GIF、WebP）。粘贴或拖入的非图片文件：在可读的工作区里就转成文件提及，否则提示不支持。
3. **工作区里的图片也存快照**，保证模型看到画面。
4. 引用里附件写成 `[图片: 文件名]`，搜索覆盖附件文件名（v1 规格）。

需要实测的协议问题（结论附抓取数据，回填规格）：
- Claude Code stream-json 的 user `content` 是否接受 `image` 块（base64），模型能否读出图里的内容？
- Codex app-server `turn/start` 的 `localImage{path}`、`image{url: data:…}` 能否让模型看到图片？图片放在工作区以外（数据目录）时是否可用？

- [x] 协议实测，契约测试（两家）
- [x] ADR、`GLOSSARY.md`
- [x] 模型与存储：`model.Message.Attachments`，图片落盘，删除会话时清理
- [x] `agent.Turn.Images`，两家适配器
- [x] 工作台：发送带图片的消息，校验格式和大小；只有图片也能发；假 Agent 测试
- [x] 界面：粘贴、Finder 复制、拖入、附件按钮；缩略图徽标；历史消息显示缩略图
- [x] 引用、搜索
- [x] 界面文字进 `locales/`（中英文）

## 实现说明

- 实测：[17 实测](../research/17-images.md)。两家的模型都不用工具就看到了图片：Claude 用 base64 `image` 块，Codex 用 `localImage`（数据目录里的路径，在工作区以外也行）。取舍写在 `docs/adr/0006-attachments-are-snapshots.md`；`GLOSSARY.md` 加了“附件”；规格加了第 72 条用户故事、适配器的轮次输入、输入框、待验证项 10。
- 新包 `internal/images`（不依赖别的内部包，已加进依赖方向测试）：按内容判断 PNG、JPEG、GIF、WebP；超过 3.5 MB 或边长超过 8000 的缩小到长边 2048，编码成 PNG，仍然超过就用 JPEG（质量 85）；超过 1 亿像素或 64 MB 的拒绝。WebP 的解码用 `golang.org/x/image/webp`（原来就是间接依赖，现在是直接依赖）。
- 模型与存储：`model.Attachment`（显示名、相对于附件目录的文件名、类型、尺寸、字节数），存在消息的 `detail` JSON 里，不需要迁移。文件在 `<数据目录>/attachments/<会话ID>/<随机ID>.<扩展名>`，先写临时文件再改名；`store.DeleteSession` 一并删除会话的附件目录。`AttachmentPath` 只认 `会话ID/文件名` 两段，不会指到附件目录以外。
- 适配器：`agent.Turn.Images`（路径和类型）。Claude 在 `Send` 加锁之前读文件、转 base64，图片块在前，文字块在后，没有文字时不放空的文字块（会被拒）。Codex 的 `turn/start` 输入是 `localImage` 条目在前，文字在后。
- 工作台：
  - `AttachImage`：检查、必要时缩小，然后存进会话的附件目录，返回附件。在后台调用。
  - `AttachPath`：粘贴、拖入或选择的文件。按内容判断是图片就附加（不看扩展名），否则交给 `MentionPath` 转成文件提及，不在会话可读的文件夹里就返回 `ErrNotReadable`。
  - `DiscardAttachment`：草稿里移除的附件删除文件；已经发出的不删。
  - `SendMessage(id, Outgoing{Text, Mentions, Attachments})`：`SendWithFiles` 改成调用它。附件必须是这个会话的，而且文件还在，否则返回 `ErrAttachmentGone`；只有图片也能发。
- 引用：`read_reference`、`read_message` 里，用户消息的附件写成 `[图片: 文件名]`，搜索也搜得到文件名。
- 界面（新文件 `internal/shell/attach.go`）：
  - 粘贴：剪贴板里有文件（Finder 里复制的）时按文件处理；有文字时照常粘贴文字；只有图片时附加图片。Finder 复制文件时剪贴板里还有文件图标的图片，所以先看文件。
  - 拖到输入框上的文件按同样的规则处理，拖动经过时输入框描蓝边。拖到窗口别处的文件夹仍然是添加工作区。
  - 回形针按钮打开系统的文件选择框（只列图片，可多选），独立窗口里也有。
  - 输入框上方的徽标是缩略图加文件名，可以移除；添加中显示“正在添加图片…”，这时不能发送。同名的粘贴图片自动编号（`image 2.png`），免得 Label 重名。
  - 发出的消息里，图片按比例显示，长边最多 160；点一下用系统的预览打开。缩略图在后台解码，按文件缓存。
  - 输入框的文本框加了 Key：原来上方出现徽标那一行后，它在父元素里的位置变了，焦点会丢，第二次粘贴没反应（测试发现）。
  - 新文字中英文都写了：`attach` 改成“添加图片”，加了 `attaching`、`removeImage`、`openImage`、`chooseImages`、`imageFiles`、`cannotAttach` 和三条错误。
- 测试：
  - `images`：小图原样保留，太宽、太大的缩小，非图片和损坏的拒绝。
  - `store` `TestAttachments`：存、读、跟着消息保存、越界的文件名、删除会话时清理。
  - 适配器 `TestTurnWithImages`（两家）。契约测试 `TestContractImage`（两家），2026-11-24 通过：通过工作台发一张红圆蓝方的图，两家都答出了 “red circle, blue square”，没有调用工具。
  - 工作台 `TestAttachImage`、`TestMentionPath`、`TestAttachPath`：改名、粘贴的图片、非图片、只有图片的消息、假 Agent 收到的路径、移除和已发送、别的会话的附件、引用里的占位文字和搜索、删除会话。
  - 界面 `TestAttachImages`：粘贴文字照常、粘贴两次图片（自动编号）、移除一张、拖入一张图片和一个工作区文件、拖入工作区以外的 PDF 有提示、发送后假 Agent 收到两张图片和一个文件、点消息里的图片打开。

截图（无头渲染）：[草稿](../research/17-screenshots/17-draft.png)、[发出后](../research/17-screenshots/17-sent.png)。

## 没有验证

- 用户在真机上手动试过（2026-11-24），没发现问题；具体试了哪些来源（系统截图、浏览器复制的图片、Finder、拖放、选择框）没有逐项记录。
- 续接以后的行为：Claude 续接的会话里早先的图片是否还在 Agent 上下文里；Codex 的 `localImage` 是在发送时读入，还是续接时按路径重读（数据目录搬家后路径会变）。
- 大图缩小只用合成的图测过，没用真实的 Retina 截图测过耗时。
- 应用在发送前退出时，草稿里的附件文件留在附件目录里，没有清理（会话删除时才一起删）。
