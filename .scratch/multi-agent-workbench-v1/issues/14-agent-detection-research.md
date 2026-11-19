# 检测 Agent 的安装、版本与登录状态的方式

Type: research
Status: resolved

## Question

aibo 怎样以非交互的方式判断 Claude Code 和 Codex CLI 的以下状态？
- 是否已安装、可执行文件在哪：PATH，以及常见的安装位置；macOS 的 GUI 应用从 Dock 启动时拿不到 shell 的 PATH。
- 版本号，以及 aibo 依赖的能力是否可用：Claude 的 stream-json 参数和 init 事件里的 `capabilities`；Codex 的 `initialize` 返回值和 app-server schema 版本。
- 是否已登录、用的是哪种认证：Claude 有没有类似 `claude auth status` 的命令，或者在没有登录时 init/result 会报什么错；Codex 的 `account/read` 和 `account/login/*`。
- 未登录时，怎样引导用户去终端完成登录。注意 Anthropic 的条款：aibo 不能代为处理 claude.ai 的登录，也不能接触 `~/.claude` 里的凭据。

要给出每种状态的检测命令或调用、预期输出，以及失败时的表现，能在本机实测的就实测。

Findings: ../research/14-agent-detection.md

## Answer

详见[调研结果](../research/14-agent-detection.md)；测试脚本在 `research/14-probes/`。测登出状态时用的是隔离的空配置目录（`CLAUDE_CONFIG_DIR`、`CODEX_HOME`），没有改动真实的认证。

- **查找可执行文件**：从 Dock 启动的应用，PATH 里只有 `/usr/bin:/bin:/usr/sbin:/sbin`。本机用 `zsh -lc` 也找不到两家 Agent，因为 `~/.local/bin` 写在 `.zshrc` 里，只有 `zsh -lic` 能找到（约 0.4 秒）。查找顺序：先用用户指定的路径，再查固定位置（`~/.local/bin`、`/opt/homebrew/bin`、`/usr/local/bin`、npm 全局目录），最后用带超时和输出标记的 `$SHELL -lic`。找到的 PATH 也要传给 Agent 进程。注意 npm 安装的 Codex 是 node 脚本，PATH 里必须有 node。
- **版本与能力**：用 `claude --version` 和 `codex --version` 取版本号。Claude 的 `init` 事件要等第一条消息之后才会出现；可以发 `control_request` 的 `initialize`，不跑模型就能拿到版本、`capabilities`、模型列表和账户信息，但这个接口没有公开文档。Codex 的 `initialize` 不带版本号，所以按 `codex --version` 设定最低版本；调用不支持的方法时会返回 `-32600 unknown variant`，据此降级。
- **登录状态**：Claude 用 `claude auth status`，输出 JSON，已登录退出码为 0、未登录为 1，`authMethod` 字段给出认证方式。未登录时 `claude -p` 会返回 `error:"authentication_failed"`。Codex 未登录时 `account/read` 返回 `account:null`，`codex login status` 退出码为 1。未登录的 Codex turn 不会立即报错，而是重试 401 大约 18 秒才失败，所以每个 turn 之前都要先调 `account/read`。
- **登录引导**：Claude 只能提示用户在终端运行 `claude`、`/login` 或 `claude auth login`，并提供复制命令的按钮；不能内嵌登录页，不能经 pty 转交登录流程，也不能碰钥匙串或 `~/.claude`。Codex 可以在应用内调用 `account/login/start`：`chatgpt` 返回一个 `authUrl`，用系统浏览器打开；`chatgptDeviceCode` 返回一个设备码给用户。登录完成后会收到 `account/login/completed` 和 `account/updated` 通知。
