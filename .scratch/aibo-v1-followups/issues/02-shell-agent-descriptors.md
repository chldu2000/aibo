# 02: 外壳不再引用具体的适配器

**What to build:** 外壳只认识 Agent 注册表提供的描述，不直接引用 `claude`、`codex`、`fake` 包。描述包括：显示名称、图标、登录方式（终端登录、应用内登录、无需登录）、安装说明链接。这样以后加第三家 Agent 时不用改外壳。

现状：外壳用 `claude.Kind`、`codex.Kind`、`fake.Kind` 区分各家，用来选图标、显示登录横幅和设置的 Agent 页。依赖方向测试（`internal/archtest`）为此留了临时例外。

**Blocked by:** None (can start immediately)

**Status:** ready-for-agent

- [ ] 注册表（或 `agent` 包）提供每种 Agent 的描述，外壳只用描述
- [ ] 去掉 `internal/archtest` 里外壳的临时例外，测试仍然通过
- [ ] 现有的界面测试（登录横幅、设置的 Agent 页、新建会话时选 Agent）不改断言就能通过
