# 02: 外壳不再引用具体的适配器

**What to build:** 外壳只认识 Agent 注册表提供的描述，不直接引用 `claude`、`codex`、`fake` 包。描述包括：显示名称、图标、登录方式（终端登录、应用内登录、无需登录）、安装说明链接。这样以后加第三家 Agent 时不用改外壳。

现状：外壳用 `claude.Kind`、`codex.Kind`、`fake.Kind` 区分各家，用来选图标、显示登录横幅和设置的 Agent 页。依赖方向测试（`internal/archtest`）为此留了临时例外。

**Blocked by:** None (can start immediately)

**Status:** resolved

- [x] 注册表（或 `agent` 包）提供每种 Agent 的描述，外壳只用描述
- [x] 去掉 `internal/archtest` 里外壳的临时例外，测试仍然通过
- [x] 现有的界面测试（登录横幅、设置的 Agent 页、新建会话时选 Agent）不改断言就能通过

## 实现说明

- 描述放在注册表里（`internal/agents` 的 `Spec`）：注册表本来就有名称、命令、最低版本、安装说明链接，也是唯一可以引用 `claude`、`codex` 的上层包。新加的字段：
  - `Glyph`：图标的 SVG（aibo 自绘，不是官方 logo），从外壳搬过来。
  - `Login`：`LoginTerminal`（Claude Code：在终端里运行它自己的登录）、`LoginInApp`（Codex：在 aibo 里走它自己的登录流程）、`LoginNone`。
  - `HoldsSignedOut`：未登录时消息不发出、留在输入框里（Codex）。原来 `Ready` 写死了 `kind == codex.Kind`，现在看这个字段；登录横幅的“消息不会发出，输入的内容会保留”也看它。
- `agents.Describe(kind)` 按 Kind 查描述。外壳的 `describe` 查不到时（例如假 Agent），给一份只有名称的描述：通用图标、无需登录。
- 应用内登录的接口改成按 Kind：`StartLogin(ctx, kind, deviceCode)`、`CancelLogin(ctx, kind)`、`AppLogin(kind)`，不支持的 Agent 返回 `ErrNoInAppLogin`。内部仍只有 Codex 实现。
- 外壳：
  - `agentGlyph` 改成 `Shell` 的方法，图标从描述里取、只解析一次，悬停提示用 Agent 自己的名字。
  - 设置的 Agent 页按 `Login` 选登录方式（`terminalLogin`、`appLogin`），文字里的命令名、Agent 名取自描述。
  - 登录横幅的“在终端中打开 …”按钮按 `Login` 显示。
- `internal/archtest` 去掉了外壳引用 `claude`、`codex`、`fake` 的临时例外。外壳的非测试代码不再引用这三个包（测试仍用 `fake`，依赖方向测试只看非测试文件）。
- 测试：现有界面测试（登录横幅、设置的 Agent 页、新建会话时选 Agent）没改断言就通过了。新增 `agents` 的 `TestDescribe`：两家的描述，不认识的 Agent 查不到，Claude Code 不能在 aibo 里登录。

## 没有验证

- 没在真机上看过；图标、登录文字和按钮跟原来一样，所以只靠界面测试。
- 加第三家 Agent 时，外壳不用改；但注册表的检测（版本、登录状态）和应用内登录仍按 Kind 写在 `internal/agents` 里，那边要改。
