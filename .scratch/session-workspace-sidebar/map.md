# aibo 会话与工作区侧边栏

Label: wayfinder:map

## Destination

形成可交给规格编写与开发排期的首期只读侧栏规划。用户能从当前会话查看终端命令的输出、子 Agent 的活动与结果，并能从当前工作区浏览文件、Git 状态与差异。每项能力都有适用的 Agent、数据来源、缺失时的表现和验收场景。

## Notes

- 用户主动从会话标题的详情入口打开侧栏，或点击终端、子 Agent 徽章直达对应内容。新活动只更新徽章。规划需兼顾现有会话详情、主窗口和独立会话窗口。
- 现有入口可对照[会话详情](../../internal/shell/details.go)和[运行中活动徽章](../../internal/shell/badges.go)。旧规划在[工作台窗口布局](../multi-agent-workbench-v1/issues/18-window-layout.md)留下了对实时计数的疑问；两家适配器的实际证据决定侧栏能怎样描述活动。
- 终端与子 Agent 跟随会话。文件与 Git 跟随工作区。同工作区切换会话时保留目录展开和正在看的差异，切换到另一个工作区后显示那个工作区的数据。
- 允许 Claude Code 和 Codex 分步交付。每一端呈现它能核实的事实，记录更完整支持所需的协议证据。子 Agent 的活动记录和可读取的原生子会话要分别核实。
- 以上是建图前用户已确认的约束。术语沿用[项目词汇表](../../GLOSSARY.md)。产品决策使用 grilling 和 domain-modeling，界面取舍使用 prototype，外部能力调查使用 research。
- 规划可交接的条件是每项场景有明确的首期行为、依赖、回退和验证方法。保留到后续的交互能力应有明确的重新评估条件。

## Decisions so far

- [两家 Agent 能提供哪些可核实的终端活动](issues/01-command-evidence.md) — 已有记录支持只读命令和结果，后台任务存活需要独立信号。
- [如何识别子 Agent 并取得可归属的消息](issues/02-child-evidence.md) — Claude 前台子步骤已有回放，Codex 独立子历史已有协议依据，仍需真实委派样本。
- [文件浏览与 Git 差异有哪些可复用的数据来源](issues/03-workspace-evidence.md) — MyGO 提供视图，工作台读取目录和 Git；同一文件的暂存与未暂存改动可分别查看。

## Not yet specified

- 大输出、超大目录或大型仓库是否需要额外的加载或保留策略，取决于可获得的数据和面板原型中的实际表现。

## Out of scope

本轮交付规划。向运行中的终端发送输入、向子 Agent 追问、编辑工作区文件和执行 Git 写操作留待后续规划；只读首期可独立交付。
