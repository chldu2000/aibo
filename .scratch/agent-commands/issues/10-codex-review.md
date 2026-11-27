# Codex 的 /review 映射到 review/start

Type: task
Status: ready-for-agent
Blocked by: 09

## What to build

按 03 号 issue 的裁定：先抓取 Codex 审查模式的事件、写契约测试，测试跑通了才提供 `/review`。

- 抓取 `review/start` 的请求和事件形态，看审查的目标怎样表达（未提交的改动、某个分支、某个提交、自定义说明），确定 `/review 参数` 怎样映射。
- 把审查的事件映射成现有的事件，适配器不静默丢弃消息。
- 契约测试跑通后，把 `review` 加进合成的内置命令，处理方式为“交给 Agent”，由适配器调用 `review/start`。

## Acceptance criteria

- [ ] testdata 里有真实的 `review/start` 抓取，解析单测覆盖它。
- [ ] 契约测试（`AIBO_CONTRACT=1`）跑通。
- [ ] 跑不通的话，`review` 保持拦下，在任务说明里写明原因，并更新 03 号 issue 的裁定。
- [ ] 结论回填到规格。
