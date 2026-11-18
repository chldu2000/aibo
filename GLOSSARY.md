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
用户与某一个 Agent 之间的一段连续对话。
_Avoid_: 对话, thread, chat

**会话引用 (Session Reference)**:
指向某个会话的句柄，连同一份简短概要交给另一个 Agent；接收方按需通过工具读取被引用会话的细节，而不是收到完整副本。
_Avoid_: 会话转发, 会话复制, handoff, 上下文粘贴

**引用范围 (Reference Range)**:
会话引用所指向的一段连续消息；引用整个会话即覆盖全部消息的范围。引用在创建时固定，是快照而非实时视图。
_Avoid_: 选区, 片段

**引用概要 (Reference Brief)**:
随会话引用一起交给接收方 Agent 的简短说明，由工作台按规则生成。
_Avoid_: 摘要, summary

**工作区 (Workspace)**:
会话所属的项目目录；Agent 在其中运行。会话引用可以跨工作区。
_Avoid_: 项目, folder, repo
