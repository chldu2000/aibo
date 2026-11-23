# 03: 界面文字移进语言目录，支持中英文

**What to build:** aibo 跟随系统语言，显示简体中文或英文。所有用户看得到的文字（界面、Label、错误提示、通知、对话框）都放在 `locales/` 的语言目录里，由 MyGO 生成带类型的 `locales` 函数，代码里不再写界面文字。规范见 `docs/agents/conventions.md`（文字与语言）。

**Blocked by:** None (可以和 01、02 并行；02 先做的话，Agent 相关的文字会少一些)

**Status:** resolved

- [x] `mygo.json` 打开 i18n：`locales/en.json`（源语言，写全所有文字）和 `locales/zh-Hans.json`。源语言定为英文（用户决定）：其他语言缺词时回退到英文
- [x] `cmd/aibo` 和 `internal/shell` 里的界面文字全部改用 `locales` 函数，复数和数字用 ICU 格式（例如“{count} 个待审批”）
- [x] 下层包返回给用户看的错误改成带类型的错误（例如 `workbench.ErrTurnRunning`），由外壳翻译。适配器转述 Agent 原话的部分保持原文
- [x] 交给 Agent 读的文字（引用概要、MCP 工具说明）单独存放，不和界面文字混在一起
- [x] 界面测试在两种语言下都能跑，至少各有一个冒烟测试；Tester 查找元素用的 Label 在两种语言下都唯一
- [x] 加一个检查：`internal/shell` 的非测试代码里不再出现中文字符串字面量（用于 Label 的符号名除外），防止回退

## 实现说明

- `mygo.json` 打开 i18n（`dir: locales`，`source: en`）。`locales/en.json`、`locales/zh-Hans.json` 共 380 条消息；`go tool mygo generate` 生成 `locales/catalog_gen.go`，和语言文件一起提交。整数参数在 `en.json` 的 `@键名` 里声明为 `int`。复数用 ICU 格式（“{count, plural, one {# approval pending} other {# approvals pending}}”），中文直接写“{count} 个待审批”。
- 依赖方向：新增 `locales` 层，只有 `internal/shell` 和 `cmd/aibo` 能引用（`internal/archtest`）。
- 下层不再写界面文字（ADR 0005）：
  - `agent`：新增 `ErrNotFound`、`ErrStartFailed`、`ErrBusy`、`ErrClosed` 和 `Detail(err, sentinel)`；审批请求用 `Action` + `Tool` + `WriteRoot` 代替 `Title`；选项去掉 `Label`，允许什么用 `Grants []Grant`；规则加 `Grant`；`Retrying` 带 `Attempt`/`Max`；`Failed` 只带 Agent 原话，加 `Exited`（进程意外退出）。
  - 适配器：错误改为上面的哨兵或英文；权限模式说明改成英文（外壳按 Agent 种类和模式 ID 查表翻译）；未登录时不再另报 `Failed`，由登录横幅说明。交给 Agent 的话（拒绝说明、提到的文件）移到各自的 `prompts.go`，仍是中文。
  - `workbench`：错误文字改英文；`Status.Error` 改为 `error`（`*workbench.Failure{Step, Err}`），`ResumeFailed` 改为 `error`，`Retrying` 改为 `*agent.Retrying`。
  - `agents`：`Status.Reason` 换成 `Problem` + `Detail`，`Source` 换成枚举；`Ready` 返回 `*agents.UnusableError`；登录失败只带 Codex 原话。
  - `appdata`：错误改英文，云盘文件夹认不出服务名时返回空名。
- 外壳：`words.go` 把已知错误、失败、Agent 检测问题转换成当前语言；`approval.go` 按选项种类写按钮文字，按 `Grant` 写规则；`mode.go` 有两家 Agent 权限模式说明的对照表。旧数据（审批 `Title`、选项 `Detail`、规则 `Label`）没有新字段时原样显示。
- `cmd/aibo`：数据目录的对话框、退出确认都改用 `locales`。
- 测试：`internal/shell/main_test.go` 让外壳测试默认用简体中文（`i18n.SetLocaleFunc`），`inLocale` 切换语言；`i18n_test.go` 有中英文各一个冒烟测试（审批卡片、回答、设置页，并检查控件 Label 在画面内不重复），一个检查外壳和 `cmd/aibo` 非测试代码里没有中文字符串（用 `go/scanner`，注释不算），一个检查两个语言文件键一致。
- 契约测试：只跑了不花钱的 `TestContractDiscovery`、`TestContractSignedOut`，都通过。
- 文档：`docs/agents/conventions.md` 的“文字与语言”改写；ADR 0005。

## 没有验证

- 没在真机上切换系统语言看过；英文界面的布局（按钮变宽、换行）没有截图检查。
- 运行中切换语言：界面会跟着变，但已经显示的通知横幅（`notice`）和 macOS 系统通知仍是旧语言。
- 花钱的契约测试（审批、权限模式、文件提及等）没有重跑；适配器的审批结构改了，单元测试覆盖了，没连真实 Agent 跑过。
- 旧会话里的审批卡片和规则在英文界面下仍显示中文（不迁移，ADR 0005）。
- 假 Agent（`fake`）的名称和模式说明还是中文，它只用于测试和开发。
- 交给 Agent 的文字（引用概要、MCP 工具说明、`prompts.go`）没有翻译。
- `kv("Agent", …)` 等少数英文单词直接写在代码里（两种语言相同），检查只拦中文。
