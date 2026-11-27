# Codex 的 /review 映射到 review/start

Type: task
Status: resolved
Blocked by: 09

## What to build

按 03 号 issue 的裁定：先抓取 Codex 审查模式的事件、写契约测试，测试跑通了才提供 `/review`。

- 抓取 `review/start` 的请求和事件形态，看审查的目标怎样表达（未提交的改动、某个分支、某个提交、自定义说明），确定 `/review 参数` 怎样映射。
- 把审查的事件映射成现有的事件，适配器不静默丢弃消息。
- 契约测试跑通后，把 `review` 加进合成的内置命令，处理方式为“交给 Agent”，由适配器调用 `review/start`。

## Acceptance criteria

- [x] testdata 里有真实的 `review/start` 抓取，解析单测覆盖它。
- [x] 契约测试（`AIBO_CONTRACT=1`）跑通。
- [x] （跑通了，不需要拦下）03 号 issue 的裁定已更新为放行。
- [x] 结论回填到规格。

## 实现说明

- 协议来自 codex-cli 0.172.0 生成的 TypeScript 绑定（`codex app-server generate-ts`）：
  - `ReviewStartParams{threadId, target, delivery?}`；
  - `target` 是 `uncommittedChanges`、`baseBranch{branch}`、`commit{sha, title}`、`custom{instructions}` 之一；
  - 应答是 `{turn, reviewThreadId}`。
- 参数怎样映射：`/review` 不带参数时审查未提交的改动（TUI 的第一个选项）；带参数时用 `custom`，参数就是说明。`baseBranch` 和 `commit` 没有单独的写法，用户可以写成说明。审查在原线程里进行（inline）。
- 实测的事件形态见 `testdata/review-0.172.0.jsonl`（路径和用户名已替换）：
  - `enteredReviewMode` 标签；
  - Codex 替用户发的提示词（`userMessage`）；
  - 若干条命令执行；
  - 以 `agentMessage` 形式给出的审查结论；
  - 内容相同的 `exitedReviewMode`；
  - 一个 `turn/completed`。
  
  适配器把审查结论当作回复。`enteredReviewMode`、`exitedReviewMode` 和 `userMessage` 写明原因后忽略，所以结论只出现一次。
- `review/start` 不带设置。之前 `SetModel`、`SetMode` 改过、还没生效的设置，以及拒绝审批时留下的理由，都留到下一个普通轮次再发。
- 同名的 skill 不会被当作审查：只有合成的内置条目（`Builtin`）才走 `review/start`。

### 契约测试（2026-11-27，codex-cli 0.172.0）

- `TestContractReview` 通过：在只读模式下审查一个改坏了的 `calc.py`，只有一条回复，回复里指出了 `calc.py`，之后线程照常继续。
- `TestContractSkillsAndReset` 改为要求 `review` 出现在清单里，也通过了。

### 没有验证

- 带参数的 `/review`（`custom` 目标）只有单元测试，没有跑过契约测试。
- `-race`：本机没有 gcc，跑不了。
