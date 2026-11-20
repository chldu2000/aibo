# 07: 引用搜索

**What to build:** 接收方 Agent 可以用 `search_reference` 在交给它的引用里查找内容：默认按关键词，也可以用正则；可以只搜某一个引用，也可以搜全部引用。结果是带片段的命中列表，可以翻页，Agent 再用 `read_message` 去读命中的那条。

规格：[aibo v1 规格](../../multi-agent-workbench-v1/spec.md)（工作台 MCP server · 搜索）。

**Blocked by:** 04（把整个会话推送为引用）

**Status:** ready-for-agent

- [ ] 默认按关键词匹配，不区分大小写，多个词必须同时出现；`regex=true` 时按正则匹配，正则无效时返回清楚的错误
- [ ] 不传 `ref_id` 时搜索交给当前会话的全部引用；传了就只搜这一个
- [ ] 只扫描引用范围内的消息，覆盖正文、工具参数、完整工具输出和附件文件名；思考内容只在 `include_thinking=true` 时搜
- [ ] 每页最多 20 个命中，每个命中带序号和约 200 字的片段，支持 cursor 翻页
- [ ] 主接缝测试覆盖关键词、正则、范围边界、思考内容开关和翻页
