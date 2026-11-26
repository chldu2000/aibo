# 03: 不能删除会话的 Agent 也能预先列出模型和模式

Status: ready-for-agent

**Blocked by:** 02

**What to build:** Cursor 的 `sessionCapabilities` 只有 `list`，没有 `delete`，所以按现在的规则 aibo 不为它开探测会话，第一个会话之前模型和模式菜单是空的（`ErrListsUnknown`）。实测表明 Cursor 没发过消息的会话重启后就不在 `session/list` 里了。对这类 Agent 可以做“轻探测”：只 `session/new`，读出模型和模式列表，不换模型、不删除。

实测依据（2026-11-26，`.scratch/acp-session-settings/research/cursor-config-options.md`）：

- `session/list` 空 → `session/new` → `session/list` 有这个会话 → 重启进程 → `session/list` 空。
- 只调 `session/new` 时，`cli-config.json` 写入 `selectedModel` 等字段，值就是会话的当前模型（原来的选择），等于没变。
- **探测时换模型会改全局设置**：每换一次，`selectedModel` 和 `modelSelectionHistory` 都变。所以轻探测不能像 OpenCode 那样逐个模型切换去读推理强度。

- [ ] `acp.Agent` 加一个开关，表示“不能删除，但空会话不留痕迹”；`agents` 只为 Cursor 打开
- [ ] 打开时，`ready` 的后台探测只 `session/new`，`learn` 记下模型和模式列表，然后结束进程；不调 `set_config_option`
- [ ] 推理强度仍然从真实会话学：只知道探测会话当前模型的推理强度，其他模型的在用户切到它们时补上（02 之前就有的 `record` 合并逻辑）
- [ ] 超时：实测 `session/new` 8–25 秒，`catalog.go` 的探测超时 2 分钟够用；网络不稳时会失败，沿用“下次再试”
- [ ] 测试：假 ACP Agent 加一种 `options-ephemeral`（不报告 `delete`），确认探测只发 `session/new`，列表可用，`changed` 回调一次
- [ ] 契约测试（`AIBO_CONTRACT=1`，04 一起做）：探测前后 `session/list` 都为空，`cli-config.json` 的 `selectedModel` 不变

## 不做

为了推理强度去探测时切换模型。会改用户的全局设置，代价比菜单里暂时没有推理强度大。
