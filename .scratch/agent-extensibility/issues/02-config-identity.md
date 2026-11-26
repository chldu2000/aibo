# 用户怎样登记 Agent 并找回已有会话

Type: grilling
Label: wayfinder:grilling
Status: resolved

## Question

用户需要填写哪些启动配置，哪些信息可以从本机和握手得到？以命令 `opencode`、参数 `["acp"]` 为例，决定 Agent 的稳定身份、显示名、可执行路径、参数、发现方式以及登录提示。用同一可执行文件的两套配置、改名或移动程序、卸载后重装三种情形，说明旧会话应绑定哪个 Agent。

## Answer

数据目录中的 `agents.json` 用 `id` 持久绑定配置实例。显示名、可执行文件和参数可以修改。同一个程序的多个实例各有自己的 ID。重装后续聊还取决于 Agent 自己保留的原生会话。[用户配置与示例](../../../docs/acp-agents.md)
