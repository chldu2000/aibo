# 06: Cursor CLI 新建会话可能超过 45 秒

Status: needs-triage

**What to build:** 05 的契约测试里，Cursor CLI 2026.11.22 的 `session/new` 两次超过 aibo 的时限（`acp.Agent.Start` 和每个请求都是 45 秒），报告 `the Agent did not start: session/new: context deadline exceeded`，重跑通过。同样的请求实测从 2 秒到 25 秒不等，网络不好时超过 70 秒后失败（`-32603 No model found. Please check your model settings.`）。详见 `.scratch/acp-session-settings/research/cursor-config-options.md` 的“补充实测：一轮真实消息”。

要决定的是：

- 是否为 Cursor（或所有 ACP Agent）放宽启动时限，比如 `session/new`/`session/load` 90 秒。代价是 Cursor 真的卡住时，用户要多等一倍才看到失败。
- 还是保持 45 秒，只在外壳给更具体的说法（“Cursor 启动超时，可能是网络问题，请重试”），现在说的是通用的“Agent 没能启动”。

## 不做

重试：失败的 `session/new` 之后，同一进程里再调一次立刻失败（Cursor 缓存了失败），要换进程才行，留给决定之后再看。
