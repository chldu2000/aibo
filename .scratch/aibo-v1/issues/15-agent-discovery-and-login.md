# 15: Agent 的发现、版本与登录

**What to build:** aibo 自动找到用户安装的 `claude` 和 `codex`，即使从 Dock 启动也能找到 shell PATH 里的那些。设置的“Agent”页显示路径、版本、登录状态和认证方式，可以“选择其他可执行文件”和“重新检测”。版本过低时提示“请升级到 X 或更高版本”；未安装时只给官方安装说明的链接。Claude 未登录时，可以一键在终端里打开 `claude` 自己登录；Codex 未登录时，可以直接在 aibo 里用 ChatGPT（系统浏览器）或设备码登录。登录失效时出现登录横幅：Claude 那条回复标为“出错：未登录”，登录后可以重试；Codex 的消息不会发出，输入的内容保留。新建会话时，不可用的 Agent 显示为灰色并注明原因。

规格：[aibo v1 规格](../../multi-agent-workbench-v1/spec.md)（Agent 发现）。调研：`.scratch/multi-agent-workbench-v1/research/14-agent-detection.md`、`.scratch/multi-agent-workbench-v1/research/14-probes`。

**Blocked by:** 02（在 aibo 里和 Claude Code 对话）、03（在 aibo 里和 Codex 对话）、14（设置弹窗与数据目录）

**Status:** resolved

- [x] 查找顺序：用户指定路径 → 固定位置 → `$SHELL -lic`（超时 3 秒，输出加标记）；路径和 shell PATH 缓存下来，启动 Agent 进程时传入这份 PATH
- [x] 最低版本 Claude Code 2.1.318、codex-cli 0.169.0；低于最低版本时该 Agent 不可用
- [x] Claude 用 `claude auth status` 在启动时和轮次返回 `authentication_failed` 时检查登录状态
- [x] Codex 启动时调用 `account/read`，订阅 `account/updated`，遇到 401 时重查；应用内通过 `account/login/start` 登录
- [x] 不提供 claude.ai 登录，不接触 `~/.claude` 里的凭据，不替用户执行安装
- [x] 主接缝测试覆盖查找顺序、版本判断和未登录事件的处理
- [x] 界面测试覆盖登录横幅
- [x] 契约测试（环境变量开启）覆盖两家的版本和登录状态检测

## Comments

- 实现说明：
  - 新包 `internal/agents`（Agent 注册表）：负责两家适配器的可执行文件路径和启动环境。
    - 查找顺序：设置中指定的路径 → 常见安装位置（`~/.local/bin`、`/opt/homebrew/bin`、`/usr/local/bin`、`~/.npm-global/bin`、nvm 目录）→ 登录 shell 的 PATH。
    - 取 shell PATH：用 `$SHELL -lic` 加哨兵（fish 用 `string join`），stdin 为空，3 秒超时。超时时连同 rc 文件启动的子进程整组结束：实测发现只杀掉 shell 的话，子进程占着管道会让检测一直挂起。
    - 取到的 PATH 也传给 Agent 进程。
    - 版本用 `--version` 读取，和最低版本比较（Claude Code 2.1.318、codex-cli 0.169.0）。
    - 登录状态：Claude 用 `claude auth status`（JSON，退出码 1 表示未登录）；Codex 用 `codex login status`（结果写在 stderr，退出码 1 表示未登录）。
    - 用户选的路径作为偏好存在数据库里。
  - 会话中途发现未登录：
    - Claude：识别带 `error: authentication_failed` 的合成回复，不把它当成回复，改发 `NotLoggedIn` 事件。
    - Codex：一出现 401 就发 `NotLoggedIn`，并中断这一轮，不等它约 18 秒的重试。
    - 工作台标记 `NeedsLogin`，并通知注册表。
    - `Retry` 会重新发送最后一条用户消息，连同它带的引用，不会重复记录。
  - 发消息前检查（`Ready`）：未安装或版本过低时两家都拦下；Codex 未登录时也拦下，消息不发出，输入的内容保留。Claude 未登录时照常发出，由它自己报错。
  - Codex 应用内登录：`account/login/start`，可选浏览器（`authUrl`）或设备码（`verificationUrl` + `userCode`），也可以取消。`account/login/completed` 和 `account/updated` 通知到达后重新检测。
  - Claude 登录：只提供复制命令，以及用 `open -a Terminal` 打开 claude，登录在 Claude Code 自己的终端流程里完成，aibo 不经手。
  - 界面：
    - 设置的“Agent”页：状态、路径和来源、版本、登录方式、原因；按钮有“选择其他可执行文件”“改回自动查找”“重新检测”“查看安装说明”，以及两家各自的登录方式。
    - 会话里的登录横幅：打开终端、去登录、重新检测、重试。
    - 新建会话时，不可用的 Agent 显示为灰色并注明原因。
- 实测（`AIBO_CONTRACT=1`，本机已通过）：
  - 只带 launchd 的 PATH 时，两家都能通过登录 shell 的 PATH 找到，已登录、版本合格。
  - 用隔离的空配置目录（`CLAUDE_CONFIG_DIR`、`CODEX_HOME`）模拟未登录，没有改动真实的登录状态：检测结果为未登录；会话中 Claude 0.2 秒、Codex 2.5 秒就识别出未登录。
- 没有验证：Codex 应用内登录真正走完一遍，需要在浏览器里登录、会改动认证状态，所以没有做；“在终端中打开 claude”也没有在真实 app 里点过。
