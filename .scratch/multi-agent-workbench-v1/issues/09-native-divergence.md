# aibo 记录与 Agent 实际上下文不一致时的处理

Type: grilling
Status: open
Blocked by: 08

## Question

aibo 的会话记录表示“发生过什么”，Agent 原生会话表示“Agent 现在还记得什么”。两者会出现偏差，比如 Claude 自动压缩上下文、Codex 做 context compaction。aibo 要不要感知这类偏差，在会话视图里怎么标出压缩边界？用户读这个会话、把它引用给别的 Agent、或者接收方调用 `read_session` 时，它们看到的内容应当分别对应哪一份？压缩边界是否在两家的事件流里提供，由“验证 Codex app-server 按 thread 注入工具与审批行为”确认。
