# 05: 精确引用范围与发往新会话

**What to build:** 用户在源会话里进入选择模式：点击设起点，Shift+点击扩展，或者用“选中整轮”“选中整个会话”。选区不连续时，aibo 把它补齐为连续范围，提示“已补齐中间的消息”，并显示“#a–#b · n 条”。发出前可以预览概要。目标可以是已有会话（包括当前会话），也可以是新会话（选择 Agent 和工作区）。接收方 Agent 可以分页读取长引用，并用 `read_message` 读完整的单条消息。

规格：[aibo v1 规格](../../multi-agent-workbench-v1/spec.md)（选区规整、工作台 MCP server · 分页）。原型：`prototype/reference-ux` 分支（方案 A）。

**Blocked by:** 04（把整个会话推送为引用）

**Status:** ready-for-agent

- [ ] 选择模式基于整条消息多选，支持点击、Shift 扩展、拖选、选中整轮、选中整个会话；选中样式是自定义的
- [ ] 不连续选区规整为“最小序号到最大序号”，并展示规整结果
- [ ] 发出前能预览概要；能发往新会话（选 Agent 和工作区）或已有会话
- [ ] 按整条消息选中后可以复制，内容从数据模型取
- [ ] `read_reference` 每页约 8k token，页内单条工具输出最多约 2k token，页尾写明剩余条数和 cursor；支持 `from_seq`
- [ ] `read_message` 读取单条消息，每页约 25k token；越界时报错并写明有效范围
- [ ] `include_thinking` 默认不含思考内容，为 true 时包含
- [ ] 主接缝测试覆盖选区规整、分页边界、cursor 续读和越界错误
