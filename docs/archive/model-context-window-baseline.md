# 内置模型上下文规格：历史实现与验证基线

以下内容从插件开发指南迁出，保留 Codex 2.0.9、Pi 2.0.5 与所列 CLI/SDK 的当时实现和证据。
文档整理没有重跑真实模型请求，也没有重新验证外部规格；不能将此记录当作所有后续版本的兼容承诺。
当前接入要求见[模型配置合同](../model-configuration.md)。

`model.context-window` 表示选择经过来源核对的运行窗口，不表示插件能够提升服务端的硬上限。
内置实现不会根据模型名称相似性为其他服务商推导长上下文规格，也不修改用户全局配置。

- **Codex 2.0.9**：先通过 `model/list` 获取当前目录，再读取同一 `CODEX_HOME` 下原生维护的
  `models_cache.json`，按精确 `slug` 匹配 `context_window` / `max_context_window`。
  仅提供默认和最大两个不同的正整数窗口；缓存超过 24 小时、缺失、格式不支持、使用自定义
  provider/endpoint 或 `model_catalog_json` 时关闭该模型的选择。没有硬编码 1M 或 API 产品页上限。
  当前 app-server 的公开 `model/list` 不包含窗口字段，因此该缓存格式属于有保护的版本兼容依赖。
- **Codex 应用路径**：对已加载线程的 `thread/resume.config` 实测会忽略窗口变更，因此停止该会话
  专用进程，以 `-c model_context_window=...` 和窗口 90% 的自动压缩阈值重新启动，然后恢复线程。
  读取运行进程的 `config/read` 核验结果，失败尝试恢复旧运行配置。恢复前重新核验目录；切换模型会
  清掉上个模型的选择。尚无首条 rollout 的空线程沿用原有重建逻辑，当前宿主绑定的事件身份保持稳定。
- **Pi 2.0.5**：默认规格来自 SDK `ModelRuntime` 的实际模型目录（内置数据、远程目录及用户覆盖的
  合成结果）。额外档位只针对当前 SDK 0.84.4 的 `docs/models.md` 明确记录的
  `openai/gpt-5.6-sol`、`openai/gpt-5.6-terra`、`openai/gpt-5.6-luna`：272K / 1.05M。
  同时要求 API 为 `openai-responses`、模型地址和认证解析后的地址均为官方 OpenAI v1 地址。
  OpenAI 官方模型页面确认三者支持 1,050,000 tokens。Codex 订阅、代理、其他服务商和不匹配的
  自定义窗口不继承该档位；未知模型不猜测上限。
- **Pi 应用路径**：调用真实 `AgentSession.setModel`，将窗口应用到运行中 Agent 使用的模型对象，
  保留推理强度、目录原始定价和请求参数；确认后再发布状态和恢复信息。SDK 的压缩决策和请求管线
  使用该模型对象。原生 API 没有单独的“申请 1M”参数，服务端根据实际输入执行已有窗口限制。
  选择长窗口意味着允许 SDK 保留更多上下文，并不改变 API 服务端规格或账号权限。
  会话恢复、资源重载和发送前均检查已选配置；模型切换时清除旧选择。

验证：Codex CLI 0.153.4 实际短请求中，872K→272K 切换对应原生
`tokenUsage.modelContextWindow` 828,400→258,400（95% 有效窗口）。Pi 使用真实 SDK 和模型目录的
离线传输截获测试验证 1.05M→272K 进入请求管线并保留历史；未发送百万 token 的付费请求，
这些测试不证明账号拥有额外权限。协议测试覆盖规格缺失、过期、自定义端点、认证地址重定向、
失败回滚、跨进程恢复、运行中拒绝修改及切换模型隔离。

来源：[Codex 配置参考](https://learn.chatgpt.com/docs/config-file/config-reference)、
[Codex App Server](https://learn.chatgpt.com/docs/app-server)、
[GPT-5.6 Sol](https://developers.openai.com/api/docs/models/gpt-5.6-sol)、
[Terra](https://developers.openai.com/api/docs/models/gpt-5.6-terra)、
[Luna](https://developers.openai.com/api/docs/models/gpt-5.6-luna)、
本仓库锁定的 `@earendil-works/pi-coding-agent@0.84.4` 的 `docs/models.md` 与
`dist/core/{agent-session,sdk,model-runtime}.js`。
