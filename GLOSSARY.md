# aibo

一个多 Agent 工作台：在一个桌面应用里托管多个外部 Agent，并允许把一个 Agent 的会话以引用的形式交给另一个 Agent。

## Language

**工作台 (Workbench)**:
aibo 应用本体，托管并串联多个 Agent。
_Avoid_: 客户端, IDE, 平台

**Agent**:
由第三方提供、作为独立进程运行的编码 Agent（如 Claude Code、Codex CLI），工作台不实现其推理逻辑。
_Avoid_: 模型, LLM, bot

**会话 (Session)**:
用户与某一个 Agent 之间的一段连续对话。aibo 记录的是会话中实际发生过的一切，不随 Agent 上下文的压缩而改变。
_Avoid_: 对话, thread, chat

**消息 (Message)**:
会话时间线上的一个条目：用户消息、Agent 回复、工具调用（连同其结果）或计划。会话引用的最小单位。思考内容附属于回复，不是独立的消息。
_Avoid_: 事件, item, 条目

**轮次 (Turn)**:
一条用户消息加上 Agent 为它所做的全部处理，用于分组显示。
_Avoid_: 回合, round

**会话引用 (Session Reference)**:
指向某个会话的句柄，连同一份简短概要交给一个会话（可以是另一个 Agent 的会话，也可以是源会话自身）；接收方按需通过工具读取被引用会话的细节，而不是收到完整副本。
_Avoid_: 会话转发, 会话复制, handoff, 上下文粘贴

**引用范围 (Reference Range)**:
会话引用所指向的一段连续消息；引用整个会话即覆盖全部消息的范围。引用在创建时固定，是快照而非实时视图。
_Avoid_: 选区, 片段

**引用概要 (Reference Brief)**:
随会话引用一起交给接收方 Agent 的简短说明，由工作台在创建引用时按规则生成并固定；它也是引用卡片展开后显示的内容。
_Avoid_: 摘要, summary

**工作区 (Workspace)**:
会话所属的项目目录；Agent 在其中运行。会话引用可以跨工作区。
_Avoid_: 项目, folder, repo

**源工作区 (Source Workspace)**:
被引用会话所属的工作区。接收方会话在收到跨工作区的引用后，可以只读地访问它。
_Avoid_: 来源目录, 原项目

**Agent 上下文 (Agent Context)**:
Agent 当前实际保留、用于推理的内容；可能因上下文压缩而少于会话记录。
_Avoid_: 记忆, memory

**上下文压缩 (Context Compaction)**:
Agent 为节省上下文而丢弃或概括早期内容的行为；aibo 在会话中以压缩标记记下其位置，压缩标记不是消息。
_Avoid_: compact, 摘要化, 截断

**上下文重置 (Context Reset)**:
Agent 上下文被完全清空、改由一个新的原生会话继续的情况；aibo 在会话中以上下文重置标记记下其位置，会话本身照常延续。
_Avoid_: 重开会话, 会话迁移

**原生会话 (Native Session)**:
Agent 自己保存的会话（如 Claude 的 session、Codex 的 thread）。一个会话同一时刻只对应一个原生会话，历史上可以先后对应多个；aibo 只记录其 ID。
_Avoid_: 底层会话, Agent 会话

**审批请求 (Approval Request)**:
Agent 在执行操作前向用户请求许可；其结果记为对应工具调用的属性。
_Avoid_: 权限弹窗, permission prompt

**权限模式 (Permission Mode)**:
会话级的审批策略，用的是会话所属 Agent 自己的模式列表和名字（如 Claude Code 的 Accept edits、Codex 的 Ask for approval），见 ADR 0003。每种模式带风险等级（安全、注意、危险），危险的模式切换前要再确认。
_Avoid_: 审批档位, approval level, 沙箱级别

**归档 (Archive)**:
会话从工作区分组中隐藏、但数据与引用都保持有效的状态；移除工作区时其会话转为归档。
_Avoid_: 隐藏, 收起
