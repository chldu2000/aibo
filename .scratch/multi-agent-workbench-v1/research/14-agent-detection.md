# 检测 Agent 的安装、版本与登录状态

对应任务：[14-agent-detection-research](../issues/14-agent-detection-research.md)
实测环境：macOS（Darwin 27），zsh；claude 2.1.318，codex-cli 0.169.0，都装在 `~/.local/bin`。日期：2026-11-20。
实测时，“未登录”状态都是用隔离的空配置目录造出来的（Claude 用 `CLAUDE_CONFIG_DIR=/tmp/...`，Codex 用 `CODEX_HOME=/tmp/...`）。没有执行登出，没有改动认证，也没有读取凭据文件。下文的邮箱、组织 ID 等都已脱敏。

## 结论速览

| 状态 | Claude Code | Codex CLI |
|---|---|---|
| 可执行文件 | 先查用户配置的路径，再查固定候选目录，最后用 `zsh -lic` 取 PATH 再查 | 同左 |
| 版本 | `claude --version` → `2.1.318 (Claude Code)` | `codex --version` → `codex-cli 0.169.0` |
| 能力探测 | stream-json 的 `control_request initialize`（不触发模型调用）；会话中看 init 事件的 `capabilities` | 没有协议版本号；按 `codex --version` 设最低版本，再依据 JSON-RPC 的 unknown-method 错误降级 |
| 登录状态 | `claude auth status`（JSON，exit 0/1）；或者看 `initialize` 返回值里的 `account` | `account/read`（`account == null` 表示未登录）；或者 `codex login status`（exit 0/1） |
| 引导登录 | 只能让用户在终端里运行 `claude`（用 `/login`）或 `claude auth login` | 可以在应用内走 `account/login/start`（拿到 `authUrl` 后用浏览器打开，或者走 device code），也可以让用户在终端运行 `codex login` |

## 1. 找到可执行文件

### 问题：从 GUI 启动时拿不到 shell 的 PATH

- 实测 `launchctl getenv PATH` 的结果为空。这说明从 Dock/Finder 启动的应用只能拿到 launchd 的默认 PATH，即 `/usr/bin:/bin:/usr/sbin:/sbin`，其中不含 `~/.local/bin`、`/opt/homebrew/bin` 或 nvm 的目录。
- 本机实测，**login 但非交互的 shell 找不到这两个命令**：
  - `env -i HOME=$HOME /bin/zsh -lc 'command -v claude codex'` 没有输出。原因是 `~/.local/bin` 写在 `~/.zshrc` 第 135 行，而 `-l` 不读 `.zshrc`。
  - `env -i HOME=$HOME /bin/zsh -lic 'command -v claude codex'` 能找到 `/Users/chldu/.local/bin/claude` 和 `/Users/chldu/.local/bin/codex`，耗时约 0.4s。
- 权衡：`-lic` 会执行用户的全部 rc 文件（oh-my-zsh、提示符、nvm 等），所以可能慢、可能卡在交互提示上，还可能往 stdout 打印杂讯。如果要用，必须满足三点：加超时（比如 3s）；用哨兵包住输出，例如 `printf '__AIBO__%s__AIBO__' "$PATH"`，只解析哨兵之间的内容；stdin 接 `/dev/null`。shell 取 `$SHELL`（或 `dscl . -read ~ UserShell`），因为 bash 和 fish 的语法不同。

### 建议的查找顺序（每个 Agent 都一样）

1. 用户在设置里明确指定的路径。
2. 固定的候选位置（`stat` 检查文件存在且可执行即可，不需要启动 shell）：
   - Claude
     - 原生安装器：`~/.local/bin/claude`，这是指向 `~/.local/share/claude/versions/<ver>` 的符号链接（本机实测，[setup](https://code.claude.com/docs/en/setup)）。
     - Homebrew cask `claude-code` / `claude-code@latest`：`/opt/homebrew/bin/claude`（Apple Silicon）或 `/usr/local/bin/claude`（Intel）。
     - npm 全局安装：`$(npm prefix -g)/bin/claude`；nvm 场景下是 `~/.nvm/versions/node/*/bin/claude`。npm 包的 `bin` 是原生二进制 `bin/claude.exe`，运行时**不依赖 Node**（`npm view @anthropic-ai/claude-code bin`；[setup#install-with-npm](https://code.claude.com/docs/en/setup#install-with-npm)）。
   - Codex
     - 官方安装脚本：`${CODEX_INSTALL_DIR:-~/.local/bin}/codex`，这是指向 `${CODEX_HOME:-~/.codex}/packages/standalone/current/bin/codex` 的符号链接（见 `https://chatgpt.com/codex/install.sh` 第 16–20 行，本机实测一致）。
     - Homebrew cask `codex`：`/opt/homebrew/bin/codex` 或 `/usr/local/bin/codex`。
     - npm 包 `@openai/codex`：它的 `bin/codex.js` 首行是 `#!/usr/bin/env node`（实测 `npm pack` 后解包查看），所以**在 GUI 环境的 PATH 下没有 node 就会启动失败**。遇到这种情况，要么把 shell PATH 注入子进程的环境，要么解析出包内的原生二进制，否则只能提示用户改用 standalone 或 brew 安装。安装方式见 [openai/codex README](https://github.com/openai/codex)。
3. 以上都找不到时，用 `$SHELL -lic` 带哨兵取出 PATH，再在其中查找。取到的 PATH 要缓存起来，**并且作为子进程的 PATH 一并传入**。Agent 自己还会再调用 `git`、`rg`、`node`、MCP server 等，GUI 默认的 PATH 不够用，所以即使第 2 步已经命中，也建议在后台取一次 shell PATH 给子进程用。
4. 找到后对路径做 `realpath`，展示给用户，方便排查装了多份的情况。
5. 补充：`claude doctor` 只读、不开会话，会输出安装是否健康等信息（[setup](https://code.claude.com/docs/en/setup)）。可以在“诊断”页面提供它的结果，但不要把它当作判断依据（它的输出是给人看的文本）。

## 2. 版本与能力探测

### Claude

- `claude --version` 的输出是 `2.1.318 (Claude Code)`；`-v` 等价（[cli-reference](https://code.claude.com/docs/en/cli-reference)）。用正则取开头的 semver 即可。
- **不触发模型调用的能力探测（实测可行）**：启动常驻进程 `claude -p --input-format stream-json --output-format stream-json --verbose` 后，先写入
  `{"type":"control_request","request_id":"r1","request":{"subtype":"initialize"}}`，
  会立即收到 `control_response`（subtype `success`）。其中的 `response` 包含以下字段：`claude_code_version`（`2.1.318`）、`capabilities`、`models`（`default/opus/sonnet/haiku/…`）、`commands`、`agents`、`account` 等。
  - 注意：这个 `initialize` 返回的 `capabilities` 是 `["ui_surface_v1","mcp_call_result_not_for_model_v1"]`，**和 init 事件里的那组不一样**。
  - 这条 control 协议是 Agent SDK 内部使用的，CLI 文档里没有写，属于未文档化接口。aibo 依赖它时要容错：收不到响应或出错时，退回 `claude --version` 加 `claude auth status`。
- 如果不发任何输入，常驻进程**不会主动输出 init 事件**（实测 8 秒内 stdout 为空）。`system/init` 要等到第一条用户消息之后才出现。实测时它的 `capabilities` 有 14 项，包括 `interrupt_receipt_v1`、`msg_lifecycle_v1`、`mcp_read_resource_v1`、`ui_surface_v1`、`mcp_call_result_not_for_model_v1` 等；同时还有 `claude_code_version`、`apiKeySource`。所以，判断某项“会话中的能力”（例如 interrupt 语义）用 init 事件；判断“安装是否可用”用 `--version` 加 `initialize`。
- 建议：用 `--version` 设一个最低版本门槛，低于门槛时提示“请运行 `claude update`”；在此之上，具体能力按 `capabilities` 有无来开关，不靠比较版本号（与 [01](01-agent-integration.md) 的结论一致）。

### Codex

- `codex --version` 的输出是 `codex-cli 0.169.0`。
- `initialize` 的返回值**没有版本字段，也没有协议版本号**。schema 中 `InitializeResponse` 只有 `codexHome`、`platformFamily`、`platformOs`、`userAgent` 四个字段（见 `/tmp/aibo-08/schema/codex_app_server_protocol.schemas.json`）。实测的返回值是：
  `{"userAgent":"aibo-probe/0.169.0 (Mac OS 27.0.1; arm64) ghostty/1.3.1 (aibo-probe; 0)","codexHome":"/Users/chldu/.codex","platformFamily":"unix","platformOs":"macos"}`
  其中 `userAgent` 里 `/` 后面那段是 codex 的版本，但这是给上游服务看的 UA 字符串，不宜用来解析版本。
- schema 本身也不带版本号。文档的说法是 “Each output is specific to the Codex version you ran”，生成命令是 `codex app-server generate-json-schema --out DIR`（[app-server](https://learn.chatgpt.com/docs/app-server)）。
- 降级的依据：
  - 调用不存在的方法时，返回 `{"error":{"code":-32600,"message":"Invalid request: unknown variant `no/such`, expected one of `initialize`, ..."}}`，消息里会列出全部可用方法，可以据此探测某个方法是否存在。
  - 没有 `initialize` 就调用其他方法时，返回 `{"code":-32600,"message":"Not initialized"}`。
- 建议：用 `codex --version` 设最低版本门槛（按 aibo 开发时锁定的 schema 版本来定），运行时依据 unknown-variant 错误降级。实验性的方法或字段需要在 `initialize.capabilities.experimentalApi: true` 时才会开放。

## 3. 检测登录状态与认证类型

### Claude：`claude auth status`（首选）

- 文档原文：“Show authentication status as JSON. Use `--text` for human-readable output. Exits with code 0 if logged in, 1 if not.” `authMethod` 的取值范围是 `none`、`claude.ai`、`oauth_token`、`api_key`、`api_key_helper`、`third_party`（[cli-reference](https://code.claude.com/docs/en/cli-reference)）。
- 已登录（实测，exit 0）：
  ```json
  {"loggedIn":true,"authMethod":"claude.ai","apiProvider":"firstParty","analyticsDisabled":true,
   "projectsDirectory":"/Users/chldu/.claude/projects","configDirectory":"/Users/chldu/.claude",
   "loginExpiresAt":"2026-12-03T08:41:19.279Z","email":"<redacted>","orgId":"<redacted>",
   "orgName":"<redacted>","subscriptionType":"pro"}
  ```
- 未登录（实测，exit 1）：
  ```json
  {"loggedIn":false,"authMethod":"none","apiProvider":"firstParty","analyticsDisabled":true,
   "projectsDirectory":"/tmp/aibo-14/emptycfg/projects","configDirectory":"/tmp/aibo-14/emptycfg","loginExpiresAt":null}
  ```
  加 `--text` 时输出 `Not logged in. Run claude auth login to authenticate.`
- 这个命令只读状态，不会开会话；凭据由 CLI 自己读取，aibo 只解析 stdout，没有接触 `~/.claude` 或 Keychain。可以用 `loginExpiresAt` 做“即将过期”提示，文档写的是到期前 3 天 CLI 会提醒运行 `/login`（[authentication](https://code.claude.com/docs/en/authentication#renew-an-expiring-login)）。
- 环境变量会影响结果：`ANTHROPIC_API_KEY`、`ANTHROPIC_AUTH_TOKEN`、`CLAUDE_CODE_OAUTH_TOKEN`、`CLAUDE_CODE_USE_BEDROCK/VERTEX/FOUNDRY` 的优先级都高于 `/login`（[authentication#authentication-precedence](https://code.claude.com/docs/en/authentication#authentication-precedence)），而 `-p` 模式下只要有 API key 就会直接使用。所以执行 `auth status` 时，必须传入**和实际启动会话时相同的环境**（包括第 1 节取到的 shell 环境），否则结果和会话的实际行为会不一致。`CLAUDE_CONFIG_DIR` 不同时，会对应不同的 Keychain 条目。
- 备选：stream-json 里 `initialize` 返回的 `account`。已登录时是 `{"email":…,"organization":…,"subscriptionType":"Claude Pro","apiProvider":"firstParty"}`，未登录时是 `{"tokenSource":"none","apiProvider":"firstParty"}`。这在会话进程内就能拿到，不必另起进程。

### Claude：未登录时会话里的表现（实测，没有真正发起模型请求）

发出一条用户消息后：
- `system/init` 照常出现，其中 `apiKeySource: "none"`。
- 接着是一条合成的 assistant 消息：`message.model = "<synthetic>"`，`content = [{"type":"text","text":"Not logged in · Please run /login"}]`，消息顶层带 `"error":"authentication_failed"` 和 `"is_api_error_message":true`。
- 然后是 `result`：`is_error: true`，`subtype: "success"`（注意这里的 subtype 不能用来判断成败），`terminal_reason: "api_error"`，`result: "Not logged in · Please run /login"`，`duration_ms` 约 29，`total_cost_usd: 0`。进程 exit 1。
- 适配器的判断依据应该是 assistant 消息的 `error == "authentication_failed"`，或者 `result.is_error`，不要去匹配文案。登录过期时文案会变成 `Login expired` 之类（[errors#login-expired](https://code.claude.com/docs/en/errors#login-expired)）。

### Codex：`account/read`（首选）

- 请求是 `account/read`，参数 `{}` 或 `{"refreshToken":false}`。aibo 不要传 `true`，那会主动刷新 token。
- 返回结构（schema `GetAccountResponse`）：`account` 是 `null`，或者是以下几种之一：`{type:"apiKey"}`、`{type:"chatgpt",email,planType,workspaceName}`、`{type:"amazonBedrock"}`、`{type:"gcp"}`；另外还有必有字段 `requiresOpenaiAuth`。
- 已登录（实测）：`{"account":{"type":"chatgpt","email":"<redacted>","planType":"prolite","workspaceName":null},"userId":"<redacted>","requiresOpenaiAuth":true,"workspaceRouting":{...}}`
- 未登录（实测，隔离的 `CODEX_HOME`）：`{"account":null,"userId":null,"requiresOpenaiAuth":true,"workspaceRouting":null}`
- 判断规则：`account == null && requiresOpenaiAuth == true` 表示需要登录。文档原文：“`requiresOpenaiAuth` reflects the active provider; when `false`, Codex can run without OpenAI credentials”（[app-server](https://learn.chatgpt.com/docs/app-server)），这对应自定义 provider 等场景，此时 `account == null` 也是正常的。
- 已登录时，`initialized` 之后服务端会主动推送 `account/updated {"authMode":"chatgpt","planType":"prolite"}`。认证方式变化（登录、登出）时也会推送，aibo 可以订阅它来实时更新状态。
- 命令行备选：`codex login status`。已登录时输出 `Logged in using ChatGPT`，exit 0；未登录时输出 `Not logged in`，exit 1（都是实测；[auth 文档](https://learn.chatgpt.com/docs/auth)没有写退出码）。

### Codex：未登录时会话里的表现（实测）

`thread/start` 和 `turn/start` 都**正常返回**，不会提前报错。随后：
- 连续收到 `error` 通知，`willRetry: true`，例如 `"Reconnecting... 2/5"`，`codexErrorInfo: {"responseStreamDisconnected":{"httpStatusCode":401}}`，`additionalDetails` 里是 `401 Unauthorized: Missing bearer or basic authentication`。
- WebSocket 重试 5 次后，收到 `warning`：“Falling back from WebSockets to HTTPS transport”，然后 HTTPS 再重试 5 次。
- 最后 `thread/status/changed → systemError`，并收到一条 `error`，`willRetry: false`，`codexErrorInfo: {"httpConnectionFailed":{"httpStatusCode":401}}`。之后 `turn/completed` 的 `turn.status = "failed"`。
- **从发出请求到失败一共约 18 秒。** 因此 aibo 必须在发送 turn 之前先调用 `account/read`；会话中遇到 `codexErrorInfo` 里 `httpStatusCode == 401` 时，立即判定为需要登录，不必等重试结束。

## 4. 引导用户登录

### Claude（受条款限制）

- 条款原文：“Anthropic does not permit third-party developers to offer Claude.ai login into their own applications … developers may not collect, store, or intermediate Claude.ai credentials or session tokens — sign-in to a Claude account must complete through Anthropic's own flow.” 另外：“Nor does it prevent an end user from signing in to the unmodified Claude Code binary with their own Claude subscription”（[legal-and-compliance](https://code.claude.com/docs/en/legal-and-compliance#authentication-and-credential-use)）。
- 因此 aibo 能做的只有：
  1. 检测到未登录（`auth status` 返回 exit 1，或者会话中出现 `authentication_failed`）时，显示说明，例如：“Claude Code 尚未登录。请打开终端运行 `claude`，按提示登录（或在会话中输入 `/login`）；也可以运行 `claude auth login`。完成后点‘重新检测’。”
  2. 提供“复制命令”按钮；也可以提供“打开终端”按钮，通过 `open -a Terminal` 打开，但不在里面替用户执行命令。是否连这一步也不做，留给规格决定，最保守的做法是只复制命令。
  3. 用户回来后重新运行 `claude auth status`。也可以每隔几秒轮询一次，但只在引导面板打开期间轮询。
- 不要做的事：在应用内嵌入或代开 claude.ai 的 OAuth 页面；用 pty 驱动 `claude auth login` 并转发其中的 URL 或 code（这等同于中转登录流程）；读写 `~/.claude/.credentials.json` 或 Keychain；替用户设置 `CLAUDE_CODE_OAUTH_TOKEN`。如果用户自己在环境里设置了 `ANTHROPIC_API_KEY` 等变量，那是用户的行为，aibo 不受影响。
- `claude auth login --console`、`--sso` 这类参数可以写进说明文字里，供用户在终端中使用（[cli-reference](https://code.claude.com/docs/en/cli-reference)）。

### Codex

- app-server 原生提供应用内登录（schema `LoginAccountParams` / `LoginAccountResponse`；[app-server](https://learn.chatgpt.com/docs/app-server)）：
  - `account/login/start {"type":"chatgpt"}` 返回 `{type:"chatgpt", loginId, authUrl}`。文档：“Open `authUrl` in a browser; the app-server hosts the local callback.” aibo 用系统浏览器打开 `authUrl`（`open URL`）即可。
  - `account/login/start {"type":"chatgptDeviceCode"}` 返回 `{loginId, verificationUrl, userCode}`。文档：“Show `verificationUrl` and `userCode` to the user; the frontend owns the UX.” 这个方式处于 beta，需要管理员开启（[auth](https://learn.chatgpt.com/docs/auth)）。
  - `account/login/start {"type":"apiKey","apiKey":"sk-..."}`：可以提供，但 v1 不建议让 aibo 接触 key，交给终端里的 `codex login --with-api-key` 更好。
  - 结束时会收到通知 `account/login/completed {loginId, success, error}`，以及 `account/updated`。取消用 `account/login/cancel {loginId}`，结果是一条 `success:false` 的 completed 通知。
  - `chatgptAuthTokens` 和 Bedrock 那几种变体在 schema 中标注为 `[UNSTABLE] … DO NOT USE`，不要用。
- 凭据由 Codex 自己保存（`~/.codex/auth.json` 或系统密钥串，取决于 `cli_auth_credentials_store`；[auth](https://learn.chatgpt.com/docs/auth)），aibo 不经手。在 OpenAI 的文档里没有找到类似 Anthropic 那样禁止第三方客户端调用这些方法的条款。这套方法本来就是给 IDE 扩展之类的客户端用的。
- 终端方式作为兜底：`codex login`，或无浏览器环境下的 `codex login --device-auth`。如果配置了 `forced_login_method` 而当前凭据不符合，Codex 会登出并退出（[auth](https://learn.chatgpt.com/docs/auth)）。aibo 遇到这种情况时，提示用户检查配置即可。

## 给规格的建议（检测流程）

1. 启动时在后台执行：解析可执行文件路径，取 shell PATH，然后对每个 Agent 依次检查四个状态：已安装 → 版本是否达到门槛 → 能力 → 登录。
2. Claude 的检查：`claude --version`，然后 `claude auth status`（exit 码加 JSON）。会话开始后，再以 `initialize` 和 init 事件的 `capabilities` 为准。
3. Codex 的检查：`codex --version`，然后启动一个用于探测的 app-server，`initialize` 之后调用 `account/read`。这个进程也可以留着复用，作为会话进程。
4. 状态展示分为：未安装、版本过低、未登录、可用。未登录时，Claude 只显示终端操作的说明，Codex 提供“用浏览器登录”按钮（走 `account/login/start`）。
5. 会话运行中如果遇到 `authentication_failed`（Claude）或 401（Codex），把该 Agent 标记为未登录，并显示同样的引导。

## 实测脚本

- `/tmp/aibo-14/probes/acct.py`：initialize 加 account/read
- `/tmp/aibo-14/probes/turn.py`：未登录时的 turn 失败流程
- `/tmp/aibo-14/probes/bogus.py`：未初始化和未知方法时的错误
- 写法沿用 `08-probes/drive.py`

## 来源

- https://code.claude.com/docs/en/setup
- https://code.claude.com/docs/en/cli-reference
- https://code.claude.com/docs/en/authentication
- https://code.claude.com/docs/en/legal-and-compliance
- https://code.claude.com/docs/en/errors
- https://learn.chatgpt.com/docs/app-server
- https://learn.chatgpt.com/docs/auth
- https://github.com/openai/codex
- https://chatgpt.com/codex/install.sh
- 本机生成的 schema：`/tmp/aibo-08/schema/v2/{GetAccountResponse,LoginAccountParams,LoginAccountResponse,AccountUpdatedNotification,AccountLoginCompletedNotification}.json`
