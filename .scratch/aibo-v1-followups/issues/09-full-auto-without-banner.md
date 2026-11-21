# 09: 全部自动不再显示横幅，改由审批档位按钮染色提示

**What to build:** 会话切到“全部自动”后，会话区顶部不再出现常驻横幅，消息列表的空间不再被占。警示改由输入框底部的审批档位按钮来表达：全部自动时，按钮用警示色（橙色染色背景，图标和文字用 `t.Warning`），其他档位保持现在的灰色。切到全部自动之前的二次确认保留。

现状：`internal/shell/view.go` 在 `x.Level == agent.FullAuto` 时画一条橙色 glass 横幅（“全部自动：这个会话里 Agent 的所有操作都不再询问”，带“改回每次询问”按钮），这条横幅会一直占着会话区的空间。审批档位按钮（`internal/shell/level.go` 的 `levelControl`）只把图标换成 `exclamationmark.shield`，颜色和其他档位一样是灰色。

**Blocked by:** None (can start immediately)。11（审批档位对应各家 Agent 的原生模式）会改这个按钮的数据来源，这里先按 `FullAuto` 判断；11 做完后改成按模式的风险等级判断

**Status:** ready-for-agent

- [ ] 删掉 `view.go` 里全部自动的横幅；其他横幅（提示、高亮引用范围）不变
- [ ] 审批档位按钮在全部自动时用警示色：橙色染色背景，配 `exclamationmark.shield`，图标和文字用 `t.Warning`；浅色、深色模式都看得清
- [ ] Tooltip 写明后果（例如“全部自动：Agent 的所有操作都不再询问。点击更改”）
- [ ] 侧栏的会话行：全部自动的会话带一个小的警示标记，这样不打开会话也能看出来（如果侧栏放不下，写进实现说明，可以不做）
- [ ] 界面测试：切到全部自动后找不到横幅的文字，档位按钮的 Label 显示全部自动
