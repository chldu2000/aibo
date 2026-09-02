# Phase 0 技术探针结论

> 日期：2026-09-02
>
> 平台：Windows 10.0.26200 x86_64；另有 macOS arm64 本机复验
>
> 状态：Windows 目标门禁有条件通过；macOS 本机门禁已通过

## 1. 结论

Phase 0 已证明 Aibo 可以在不显示 Agent 原生 UI 的前提下：

- 通过 Codex App Server 完成 initialize、thread list/start、真实流式 turn、审批请求/拒绝、进程重启后的 resume/read。
- 通过 Pi RPC 完成严格 LF JSONL 的命令/响应与异步事件传输。
- 通过 Pi SDK `0.84.4` 在 Windows 原生 PowerShell 中执行工具，并用公开 `SessionManager` API 持久化和重新打开会话。
- 用自动化测试固定一个易错协议点：Pi 的流式事件可能与最终 response 使用相同 request id，client 不能把中间事件误判为响应。

Windows 目标环境尚未证明 Pi 的真实模型 prompt/stream/abort/history resume，原因是当时本机 Pi 没有配置 provider 凭据。macOS 本机已在完成 Pi 原生登录后跑通 SDK host 的同一组门禁；Windows 仍需在目标环境重跑并保留独立结果。

Windows 上的实现路线据实调整为：

- Codex：Rust Core 管理 `codex app-server` stdio JSON-RPC。
- Pi：Rust Core 管理一个项目锁版的 Node SDK adapter host；host 使用 `@earendil-works/pi-coding-agent 0.84.4` 和平台原生 shell tool。
- Pi RPC：保留为兼容/诊断路径，并可用于 macOS/Linux；当前 Windows CLI 的 `bash` RPC 命令依赖 `/bin/bash`/WSL，不作为 Windows 主执行路径。

## 2. 实测基线

| 组件 | 版本/状态 |
| --- | --- |
| Codex CLI / App Server | `0.152.0` |
| Pi 全局 CLI | `0.84.1` |
| Pi 项目 SDK | 锁定 `0.84.4` |
| Node.js | `24.19.0` |
| pnpm | `11.21.0` |
| Rust / Cargo | `1.94.1` |

Pi SDK 从 `0.84.4` 起在当前安装包中公开 `createPowerShellTool` / `createLocalPowerShellOperations`。全局 Pi CLI 仍是 `0.84.1`，因此 Aibo 不应把全局 CLI 版本与项目 SDK 能力混为一谈。

## 3. 探针结果

### 3.1 Codex App Server

| 检查 | 结果 | 证据 |
| --- | --- | --- |
| stdio JSON-RPC framing 与请求关联 | 通过 | initialize/list/start 均收到关联 response |
| schema 生成 | 通过 | `codex app-server generate-json-schema --experimental` |
| 真实模型流式 turn | 通过 | 收到 `turn/started`、message delta、`turn/completed` |
| 审批往返 | 通过 | 收到 `item/commandExecution/requestApproval`，client 返回 decline，随后 `serverRequest/resolved` |
| 进程重启后恢复 | 通过 | `thread/resume` 和 `thread/read` 可读取已完成 turn |
| 原生 UI | 未出现 | 全程 stdio，由 probe 接管输入输出 |

观察到但不影响本次通过的上游告警：

- PowerShell shell snapshot 暂不支持。
- 部分已安装 skill 的 icon 路径不符合插件 assets 约束。
- terminal turn 后偶发 `failed to flush rollout ... thread not found`，但随后的 resume/read 成功。Adapter 应将其记录为 warning，并以可读取的持久历史为最终判据。

### 3.2 Pi RPC

| 检查 | 结果 | 说明 |
| --- | --- | --- |
| 严格 LF JSONL framing | 通过 | `get_state`、`set_session_name`、事件和 response 均可解析 |
| 相同 request id 的中间事件 | 通过 | client 仅在 `type=response` 时完成请求 |
| Windows 直接命令 | 不通过 | `bash` 走 WSL/`/bin/bash`；沙箱外也报告 `/bin/bash` 不存在 |
| 空会话 resume | Windows 不成立 | Pi 在首个 assistant message 前延迟创建 session 文件；只有路径，无可恢复文件 |
| 真实 prompt/stream | macOS 已验证；Windows 阻塞 | 依赖目标环境的 Pi provider 凭据 |
| abort 与真实历史恢复 | macOS 已验证；Windows 待重跑 | 依赖一个可运行的真实模型 turn |

RPC 的 `set_session_name` 会发出 `session_info_changed`，但这不代表空会话已经落盘。Aibo 不得只凭返回的 session path 声称会话可恢复。

### 3.3 Pi SDK host

| 检查 | 结果 | 说明 |
| --- | --- | --- |
| 项目级依赖锁版 | 通过 | `@earendil-works/pi-coding-agent 0.84.4` |
| Windows PowerShell tool | 通过 | `createPowerShellTool(...).execute()` 返回 Node 版本 |
| SessionManager 持久化 | 通过 | 写入标识清楚的 synthetic assistant probe record 后生成 JSONL |
| SessionManager reopen | 通过 | session id、name、自定义 entry 均一致 |
| 真实模型事件 | macOS 已验证；Windows 待重跑 | SDK host smoke 已验证 prompt、stream、abort、history resume |

synthetic record 只用于无模型的存储 API 验证，内容固定为 `AIBO_PI_SDK_PERSISTENCE_PROBE`，不能算作真实模型回合。

### 3.4 macOS 本机复验（2026-09-02）

本机环境为 macOS arm64、Node.js `24.18.0`、pnpm `10.32.1`、Codex `0.149.0`、全局 Pi `0.82.1`、项目 Pi SDK `0.84.4`。在允许 Agent 访问其原生认证/状态目录后，以下门禁均通过：

| 检查 | 结果 | 运行入口 |
| --- | --- | --- |
| Codex initialize/list | 通过 | `pnpm probe:codex` |
| Codex 真实 turn + resume/read | 通过 | `pnpm probe:codex:smoke` |
| Codex approval decline | 通过，观察到 1 次 approval | `pnpm probe:codex:approval` |
| Pi SDK host 真实 turn/stream | 通过 | `pnpm probe:pi:smoke` |
| Pi SDK abort | 通过 | `pnpm probe:pi:smoke` |
| Pi SDK session/history resume | 通过 | `pnpm probe:pi:smoke` |
| Pi SDK session list/tree | 通过 | `pnpm probe:pi:smoke` |
| Pi RPC 兼容路径真实 turn/abort/resume | 通过 | `pnpm probe:pi:rpc -- --smoke` |
| Codex + Pi 聚合门禁 | 通过 | `pnpm probe -- --smoke` |

本机 smoke 运行产生的原始事件仍位于被 Git 忽略的 `.aibo/probe/runs/`；提交的仅是脱敏样本 [fixtures/codex/events.macos.redacted.jsonl](../fixtures/codex/events.macos.redacted.jsonl) 和 [fixtures/pi/events.macos.redacted.jsonl](../fixtures/pi/events.macos.redacted.jsonl)。

## 4. Capability matrix

状态含义：`已验证` 表示本机探针走通；`文档支持` 表示官方接口存在但尚未在本机走通；`阻塞` 表示需要 Pi 登录；`不支持` 表示该路径当前不具备能力。

| Aibo capability | Codex App Server | Pi SDK host | Pi RPC (Windows) | V1 选择 |
| --- | --- | --- | --- | --- |
| headless 输入输出 | 已验证 | 已验证（直接 API） | 已验证 | Codex App Server / Pi SDK host |
| session create/open | 已验证 | 已验证 | 传输已验证，空会话不可恢复 | SDK host |
| session list/read | 已验证 | macOS 已验证；Windows 待重跑 | macOS 已验证；Windows 待重跑 | adapter 统一投影 |
| 真实 turn streaming | 已验证 | macOS 已验证；Windows 待重跑 | macOS 已验证；Windows 待重跑 | SDK host |
| history resume | 已验证 | macOS 已验证；Windows 待重跑 | macOS 已验证；Windows 待重跑 | SDK host |
| interrupt/abort | 文档支持 | macOS 已验证；Windows 待重跑 | macOS 已验证；Windows 待重跑 | SDK host |
| command approval | 已验证 | Aibo host 自建策略 | 无 Codex 等价原生沙箱 | Core 审批 + SDK tool wrapper |
| Windows shell tool | 审批路径已观察 | 已验证 PowerShell | 不支持（依赖 bash/WSL） | SDK `powershell` |
| native sandbox | protocol 可表达并观察到 read-only | 不支持 | 不支持 | UI 明示 enforced/unsupported |
| fork/branch | 文档支持 | session tree 文档支持 | 文档支持 | 保留原生 ID 与树关系 |
| shared `.agents/skills` | 文档支持 | 文档支持 | 文档支持 | 共享 `aibo-handoff` skill |

## 5. 已冻结的 Phase 0 契约

- `contracts/agent-event.v1.schema.json`：统一 envelope、事件类型、generation/sequence 规则。
- `fixtures/codex/events.redacted.jsonl`：Codex turn、delta、approval、completion 最小脱敏流。
- `fixtures/codex/events.macos.redacted.jsonl`：macOS Codex smoke/approval 脱敏流。
- `fixtures/pi/events.redacted.jsonl`：Pi response/event 同 id 的最小脱敏流。
- `fixtures/pi/events.macos.redacted.jsonl`：macOS Pi streaming/abort 脱敏流。
- `fixtures/pi/session.redacted.jsonl`：Pi append-only session tree 最小脱敏样本。
- 原始运行数据位于 `.aibo/probe/runs/`，默认被 Git 忽略，因为可能含账户、绝对路径、会话内容和本机配置。

Session state machine 冻结为：

```text
created -> starting -> idle -> running -> idle
                              |       |
                              |       +-> interrupted -> starting
                              +-> waiting_approval -> running
任意活动态 -> failed
idle/failed/interrupted -> closed
```

只有当前 adapter `generationId` 的事件可推进状态；旧 generation 的迟到事件进入诊断日志，不进入 durable timeline。

## 6. 复现命令

```powershell
pnpm install
pnpm test
pnpm probe:codex
pnpm probe:codex:smoke
pnpm probe:codex:approval
pnpm probe:pi:sdk
pnpm probe:pi:rpc
pnpm probe:pi:smoke
```

`probe:codex:smoke`、`probe:codex:approval` 和 `probe:pi:smoke` 会使用对应 Agent 的本机身份并产生真实模型调用。`probe:pi:smoke` 走 SDK host；RPC 兼容路径需显式运行 `pnpm probe:pi:rpc -- --smoke`。其他探针不调用模型。

pnpm 安装当前报告忽略了 `@google/genai` 与 `protobufjs` 的 build scripts。现有 probe 不依赖这些脚本；在正式 adapter host 打包前需通过 `pnpm approve-builds` 审核，而不是直接全量放行。

## 7. Phase 0 剩余门禁

macOS 本机的五项门禁已经关闭。Windows 目标环境仍需在完成 Pi 原生登录后：

1. 运行 `pnpm probe:pi:smoke`。
2. 验证 prompt、增量 event、agent settled、真实 session 文件生成。
3. 重启进程并验证 message history。
4. 增加并验证一次 abort 场景。
5. 将真实 Pi 流脱敏后更新 fixture，不提交原始事件。

在 Windows 目标环境的五项门禁完成前，不能宣称跨平台的“双 Agent 可恢复真实会话”退出条件已完全达成；Phase 1 的应用骨架可以继续基于 macOS 已验证的契约并行搭建。
