# Phase 4.5 macOS 验收记录

> 本记录只保存脱敏的环境、探针和门禁结果，不包含认证信息、用户主目录内容或原始 Provider payload。

- 日期：2026-09-05
- Aibo implementation commit：`3e2dd91`
- macOS / arch：macOS 27.0 / arm64
- Codex：`codex-cli 0.149.0`
- Pi：`0.84.4`

## 自动化门禁

| 门禁 | 结果 |
| --- | --- |
| `pnpm test` | pass（39） |
| `pnpm test:contracts` | pass（7） |
| `pnpm exec tsc --noEmit` | pass |
| `pnpm build` | pass |
| `cargo test --manifest-path src-tauri/Cargo.toml` | pass（52） |
| `cargo fmt --manifest-path src-tauri/Cargo.toml -- --check` | pass |
| `cargo clippy --manifest-path src-tauri/Cargo.toml --lib -- -D warnings` | pass |

## 协议探针

| Agent | 场景 | 结果 | 备注 |
| --- | --- | --- | --- |
| Codex | app-server initialize / thread-list | pass | 使用临时 `CODEX_HOME` 隔离状态目录；未发送模型 turn |
| Pi | SDK host start / tree | pass | 协议 `aibo-pi-sdk-host.v1` |

## G5 真实任务

| 场景 | Codex | Pi |
| --- | --- | --- |
| 结构化上下文 → 编辑 → 测试 → 审阅 → 恢复 → 重启恢复 | pending | pending |
| 测试失败后修复并重新验证 | pending | pending |
| 审批允许/拒绝、dirty fixture、symlink 越界 | pending | pending |

真实任务不使用 Aibo 仓库作为破坏性目标，也不能用离线 fixture 代替真实 Provider 验收。当前执行环境默认无法初始化 `~/.codex` 状态目录；Pi 的已登录 SDK smoke 还需要用户明确授权使用外部 Provider 请求。上述项目因此保留为 G5 pending，不计入已通过项。

## 已知限制

- Pi 没有原生 OS sandbox；写入和命令必须经过 Aibo Core 网关，UI 持续显示 `nativeSandbox=false`。
- 系统通知尚未接入，当前使用置顶、自动消失的应用内通知。
- Windows 仍未验证。
