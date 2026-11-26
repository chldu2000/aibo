# 06: Cursor CLI 新建会话可能超过 45 秒

Status: resolved

**What to build:** 05 的契约测试里，Cursor CLI 2026.11.22 的 `session/new` 两次超过 aibo 的时限（`acp.Agent.Start` 和每个请求都是 45 秒），报告 `the Agent did not start: session/new: context deadline exceeded`，重跑通过。同样的请求实测从 2 秒到 25 秒不等，网络不好时超过 70 秒后失败（`-32603 No model found. Please check your model settings.`）。详见 `.scratch/acp-session-settings/research/cursor-config-options.md` 的“补充实测：一轮真实消息”。

要决定的是：

- 是否为 Cursor（或所有 ACP Agent）放宽启动时限，比如 `session/new`/`session/load` 90 秒。代价是 Cursor 真的卡住时，用户要多等一倍才看到失败。
- 还是保持 45 秒，只在外壳给更具体的说法（“Cursor 启动超时，可能是网络问题，请重试”），现在说的是通用的“Agent 没能启动”。

## 不做

重试：失败的 `session/new` 之后，同一进程里再调一次立刻失败（Cursor 缓存了失败），要换进程才行，留给决定之后再看。

## 实现说明

决定（Claude，2026-11-26，按 `/goal` 继续时没有用户的选择，取了推荐的做法，用户可以改）：为预置 Cursor 放宽到 90 秒，其他 Agent 仍是 45 秒，外壳措辞不变。理由：实测成功的最慢一次 25 秒、失败发生在 70 秒以后，90 秒覆盖慢而能成的情况，卡住时也只多等 45 秒。

- `internal/agent/acp/acp.go`：`Agent.SetStartTimeout`，`Start` 用它（0 为默认 45 秒，`defaultStart`）。
- `internal/agent/acp/transport.go`：原来每个请求都另有 45 秒上限，Start 放宽了 `session/new` 也还是 45 秒；`call` 改为只在 ctx 没有期限时才加 45 秒，有期限时（Start、探测的 2 分钟）就用调用方的。设置模型、模式这些没有期限的调用不变。顺带探测里的 `session/new` 也能用满 2 分钟。
- `internal/agents/config.go`：`builtinACP.start`，Cursor 为 90 秒。
- 测试：`TestStartTimeout`（`internal/agent/acp/cursor_test.go`），假 ACP Agent 的 `slow` 种类让 `session/new` 等 1 秒：时限 300 毫秒时启动以 `context.DeadlineExceeded` 失败，10 秒时成功。
- 改动后 `TestContractCursorSettings` 在本机 Cursor 2026.11.22 上通过（115 秒）。
- 文档：`docs/acp-agents.md` 的 Cursor 一节写明等 90 秒。
