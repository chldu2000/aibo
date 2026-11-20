# 15: Agent 的发现、版本与登录

**What to build:** aibo 自动找到用户安装的 `claude` 和 `codex`，即使从 Dock 启动也能找到 shell PATH 里的那些。设置的“Agent”页显示路径、版本、登录状态和认证方式，可以“选择其他可执行文件”和“重新检测”。版本过低时提示“请升级到 X 或更高版本”；未安装时只给官方安装说明的链接。Claude 未登录时，可以一键在终端里打开 `claude` 自己登录；Codex 未登录时，可以直接在 aibo 里用 ChatGPT（系统浏览器）或设备码登录。登录失效时出现登录横幅：Claude 那条回复标为“出错：未登录”，登录后可以重试；Codex 的消息不会发出，输入的内容保留。新建会话时，不可用的 Agent 显示为灰色并注明原因。

规格：[aibo v1 规格](../../multi-agent-workbench-v1/spec.md)（Agent 发现）。调研：`.scratch/multi-agent-workbench-v1/research/14-agent-detection.md`、`.scratch/multi-agent-workbench-v1/research/14-probes`。

**Blocked by:** 02（在 aibo 里和 Claude Code 对话）、03（在 aibo 里和 Codex 对话）、14（设置弹窗与数据目录）

**Status:** ready-for-agent

- [ ] 查找顺序：用户指定路径 → 固定位置 → `$SHELL -lic`（超时 3 秒，输出加标记）；路径和 shell PATH 缓存下来，启动 Agent 进程时传入这份 PATH
- [ ] 最低版本 Claude Code 2.1.318、codex-cli 0.169.0；低于最低版本时该 Agent 不可用
- [ ] Claude 用 `claude auth status` 在启动时和轮次返回 `authentication_failed` 时检查登录状态
- [ ] Codex 启动时调用 `account/read`，订阅 `account/updated`，遇到 401 时重查；应用内通过 `account/login/start` 登录
- [ ] 不提供 claude.ai 登录，不接触 `~/.claude` 里的凭据，不替用户执行安装
- [ ] 主接缝测试覆盖查找顺序、版本判断和未登录事件的处理
- [ ] 界面测试覆盖登录横幅
- [ ] 契约测试（环境变量开启）覆盖两家的版本和登录状态检测
