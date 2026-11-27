# 输入框的 / 命令面板和命令 chip

Type: task
Status: resolved
Blocked by: 05, 06

## What to build

外壳让用户发现和选择 Agent 命令。见[规格](../spec.md)的“外壳”和用户故事 1–20。

- 输入框开头打出 `/`，打开命令面板：与 `@` 文件面板并列，复用它的异步加载和键盘交互。
- 每行显示名称、灰色参数提示和一行说明；Agent 给出来源时才显示来源。
- 按名称和别名匹配：前缀匹配在前，包含匹配在后，同一级按 Agent 给的顺序。
- 加载时先显示缓存，失败时显示原因和重试，沿用模型清单的失败状态。
- 选中，或者手打的名字（别名也算）在清单里：输入框开头变成命令 chip，名字换成正式名。退格可以删掉 chip。
- 发送时把命令放进 `Outgoing`。拦下的错误按 06 的措辞显示。
- 新增文字中英文同时写，重新生成 `locales`。

## Acceptance criteria

- [x] MyGO Tester 覆盖：
  - 打出 `/` 打开面板、筛选、键盘选中后变成 chip；
  - 手打名字自动变成 chip；
  - 退格删掉 chip；
  - 被拦下时的提示。
- [x] 两种语言的冒烟测试通过，新增 Label 不重复。
- [x] 先例：`mentions_test.go`。

## 实现说明

- `internal/shell/commands.go`：
  - `commandPanel` 是面板的状态；`matchCommands` 先列名称或别名的前缀匹配，再列包含匹配，同一级按 Agent 给的顺序；
  - `draftCommand` 盯着草稿：开头是 `/` 且还没打空格时打开面板；打出 `/名字 `（带空格）且名字在清单里时，把它变成 chip；
  - `commandKey` 在 `OnTextKey` 里处理按键：上下键选择，Enter 或 Tab 选中，Esc 关闭；草稿为空时按退格，chip 变回 `/名字` 文字；
  - `commandPanelView` 画面板，挂在输入框卡片上方，用法和 `@` 面板一样；
  - `commandChip` 画 chip，悬停显示说明。
- 面板打开时用 `RefreshCommands` 取一次清单：先显示已知的，同时重新获取。之后每帧只读缓存。失败时显示原因和“重试”按钮。
- 焦点一直留在输入框，面板不另设搜索框，草稿里 `/` 后面的字就是筛选条件。
- 草稿在外壳这一侧改过之后（选中命令、退格去掉 chip），`TextKey.SetText` 会让光标停在开头。现在在下一帧用 `SetTextSelection` 把光标移到末尾（`sessionView.caretEnd`）。
- `send` 把 chip 放进 `Outgoing.Command`；草稿只有 chip 没有文字时也能发送。
- `TellsCommands` 为 false 的 Agent（目前的 ACP Agent）不打开面板，打出 `/单词` 仍按 06 的错误提示。
- `lifecycle_test` 的预期改了：打出 `/` 时已经取过清单，所以 `/clear` 的提示变成“不是可用命令”。

### 没有验证

- 没有在真机上点过（Windows 和 macOS 都没有），只跑了 Tester 测试并看了截图。
- 输入法正在组字时，打出 `/` 会怎样，没有测。
- 发送 `/不存在的命令` 失败后，面板（“没有匹配的命令”）还开着，要等草稿改掉才会关上。
