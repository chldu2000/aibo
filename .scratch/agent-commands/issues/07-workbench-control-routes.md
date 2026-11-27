# 改走控件的 Agent 命令

Type: task
Status: resolved
Blocked by: 06

## What to build

处理方式为“改走控件”的命令不发轮次，也不记用户消息，由工作台调用已有的方法。见[规格](../spec.md)的“工作台 / 改走控件”。

- 模型 → `SetModel`：参数为模型，推理强度保持不变。
- 推理强度 → `SetModel`：保持当前模型。
- 压缩 → `Compact`。
- 重命名 → 重命名会话，参数为新标题。
- 权限模式 → `SetMode`：参数按模式的 ID 或名称匹配。
- 不带参数的模型命令和权限模式命令，返回一个专门的哨兵错误，外壳据此打开对应的菜单（菜单在 12 接入）。参数对不上时，返回带类型的错误，由外壳措辞。
- 这些方法原有的错误（`ErrTurnRunning` 等）照常返回。

## Acceptance criteria

- [x] 每一种改走控件的命令，效果都和直接调用对应方法一样，而且不产生轮次和消息。
- [x] 有轮次在跑时，返回 `ErrTurnRunning`。
- [x] 不带参数时返回“打开菜单”的哨兵错误，并说明是哪个菜单。
- [x] 模型名或模式名对不上时，返回带类型的错误；外壳在 `words.go` 里措辞，中英文同时写。

## 实现说明

- `SendMessage` 在核对命令后检查处理方式。改走控件的，交给 `control`，直接调用 `SetModel`、`Compact`、`Rename`、`SetMode`：不发轮次、不记消息，控件自己的错误照常返回（运行中 `SetModel` 返回 `ErrTurnRunning`，空会话 `Compact` 返回 `ErrNothingToCompact`）。附带的文件提及和图片忽略掉。
- 不带参数的模型、推理强度和权限模式命令返回 `*PickError`（`errors.Is(err, ErrPick)`），`Control` 字段说明是哪个控件。外壳目前只提示去对应的菜单里选，12 改成直接打开菜单。

和规格不一样的地方：

- **模型名和推理强度不在 aibo 这边核对**，原样交给 `SetModel`。Claude 认 `haiku` 这类不在模型清单里的别名，核对的话反而会误拒。Agent 会用 `SettingsReported` 报回实际值。
- **权限模式按 ID 或名称匹配**（名称不区分大小写），对不上时返回现有的 `ErrNoSuchMode`。
- **`/rename` 不带参数时，标题恢复成第一条消息的开头**，也就是 `Rename(id, "")` 的现有行为，不需要打开菜单。

### 没有验证

- `-race`：本机没有 gcc，跑不了。
