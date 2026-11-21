# 03: 界面文字移进语言目录，支持中英文

**What to build:** aibo 跟随系统语言，显示简体中文或英文。所有用户看得到的文字（界面、Label、错误提示、通知、对话框）都放在 `locales/` 的语言目录里，由 MyGO 生成带类型的 `locales` 函数，代码里不再写界面文字。规范见 `docs/agents/conventions.md`（文字与语言）。

**Blocked by:** None (可以和 01、02 并行；02 先做的话，Agent 相关的文字会少一些)

**Status:** ready-for-agent

- [ ] `mygo.json` 打开 i18n：`locales/en.json`（源语言，写全所有文字）和 `locales/zh-Hans.json`。源语言定为英文（用户决定）：其他语言缺词时回退到英文
- [ ] `cmd/aibo` 和 `internal/shell` 里的界面文字全部改用 `locales` 函数，复数和数字用 ICU 格式（例如“{count} 个待审批”）
- [ ] 下层包返回给用户看的错误改成带类型的错误（例如 `workbench.ErrTurnRunning`），由外壳翻译。适配器转述 Agent 原话的部分保持原文
- [ ] 交给 Agent 读的文字（引用概要、MCP 工具说明）单独存放，不和界面文字混在一起
- [ ] 界面测试在两种语言下都能跑，至少各有一个冒烟测试；Tester 查找元素用的 Label 在两种语言下都唯一
- [ ] 加一个检查：`internal/shell` 的非测试代码里不再出现中文字符串字面量（用于 Label 的符号名除外），防止回退
