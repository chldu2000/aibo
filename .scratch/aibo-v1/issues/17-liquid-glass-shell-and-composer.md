# 17: Liquid Glass 外壳与输入框

**What to build:** aibo 的外观达到“像 macOS 原生应用”的程度：左侧是浮动的 Liquid Glass 侧栏，和会话区之间留缝；会话区顶部是浮动的 glass 标题栏（Agent 图标、标题、工作区，以及“在新窗口打开”和“会话详情”两个图标按钮），消息列表在标题栏下方滚动并渐隐；会话详情以 glass 面板浮出。输入框是一张 glass 卡片，底部是一排图标按钮，右侧是圆形的发送／停止按钮；上方是染色 glass 徽标，显示终端进程数、运行中的子 Agent 数、待审批数和收到的引用数，以及“压缩上下文”“引用会话”两个快捷指令。所有文字和图标都跟随系统的浅色、深色模式。

规格：[aibo v1 规格](../../multi-agent-workbench-v1/spec.md)（工作台外壳 UI）。原型：`prototype/window-layout` 分支（最终版 main.go 和截图）。

**Blocked by:** 02（在 aibo 里和 Claude Code 对话）、03（在 aibo 里和 Codex 对话）、10（审批卡片与原生选项）

**Status:** ready-for-agent

- [ ] 窗口 `Transparent` + `VibrancySidebar` + `TitleBarHiddenInset`；侧栏用系统 Liquid Glass，圆角，四周留 8 的边距（在外层加 padding）
- [ ] 会话详情面板包含 Agent 和模型、工作区、原生会话、审批档位、始终允许规则、可读的源工作区，以及压缩、重命名、归档、删除操作
- [ ] 输入框底部的图标按钮：附件、@ 引用、模型（只显示）、审批档位；发送和停止共用一个圆形按钮
- [ ] 徽标数量为 0 时隐藏；验证终端进程数和子 Agent 数能否从事件流实时统计（规格待验证项 3），做不到时只显示“有／无”，并回填规格
- [ ] 审批卡片和提示横幅用橙色染色 glass，引用卡片用蓝色染色 glass
- [ ] 颜色规范：文字和图标颜色都取自主题；染色 glass 浅色透明度约为深色的 45%；彩色 SVG 用 `ui.Image`，单色图标用 SF Symbols 或 `ui.Icon`
- [ ] 真机检查浅色和深色模式下系统材质上的文字是否清晰（待验证项 5），以及代码块长行能否横向滚动（待验证项 6），结论回填规格
- [ ] 一万条消息的长会话滚动流畅（可用 `MYGO_FRAME_STATS` 验证）
