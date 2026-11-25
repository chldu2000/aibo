# 哪些只读场景可以独立交付和验收

Type: grilling
Label: wayfinder:grilling
Status: resolved
Blocked by: 04, 05, 06

## Question

把确定的导航、活动语义和工作区行为组合成首期交付顺序。对四个用户场景分别指出可先交付的最小行为、两家 Agent 的差异、Windows 与 macOS 应验证的路径和可以延期的能力。怎样在交付一个场景时验证已有会话、详情入口和输入草稿仍可正常使用？

## Answer

首期交付顺序：先做侧栏入口，再并行交付命令记录、委派步骤、文件浏览和 Git 状态四个场景，然后是差异和多窗口刷新。Codex 的增量输出、后台终端和原生子历史这三项协议增强，在对应的基础场景之后各自排期。两家 Agent 分别交付各自能验证的层级。以工作台作为业务测试边界；MyGO Tester 覆盖徽章直达、窄窗口返回、焦点与草稿、多窗口选择隔离。Windows 与 macOS 的验收记录区分已测和待测。以上工单都已完成。

[首期交付规格 · 实施工单与依赖](../../readonly-sidebar-v1/spec.md)
