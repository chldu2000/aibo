# 本地诊断日志实施与验收记录

日期：2026-10-13。对应[本地诊断日志规格 v1](diagnostic-logging-spec.md)。

L1 原生与前端路径已接入，验收仍未全部完成。本文区分本机通过的行为、尚未执行的平台与打包检查；不能据此声称全部 L1 验收完成。L2 的临时 DEBUG 与 ZIP 导出未实现，界面不显示这些操作。

## 实现位置与保存合同

- [diagnostics.rs](../src-tauri/src/diagnostics.rs)：受控事件及字段、独立 tracing subscriber、有界队列、后台文件写入、轮转清理、运行锁、状态与预备 panic 通道。
- [diagnostics_ipc.rs](../src-tauri/src/diagnostics_ipc.rs)：可信顶层宿主文档的诊断 IPC、资源名校验、单调时钟限流、状态读取及固定目录打开。文档访问凭据仅保存在内存，不进入事件、运行元数据或文件。
- [lib.rs](../src-tauri/src/lib.rs)：进程开始时先建立启动缓冲，选择 DATA 后启动 writer，在数据库与插件初始化前接入日志；setup 出错返回框架前有界排空。原有初始化顺序保持不变。
- [plugin_runtime.rs](../src-tauri/src/plugin_runtime.rs)、[capability_broker.rs](../src-tauri/src/capability_broker.rs)、[tool_views.rs](../src-tauri/src/tool_views.rs)：已校验宿主身份下的生命周期、请求与协议失败；原始 stderr、协议包及终端正文不保存。
- [SessionHost](../src-tauri/src/session_host.rs) 与[事件投影](../src-tauri/src/session_projection.rs)：创建、恢复、发送、取消、关闭，以及经过原有校验并提交的回合终态。请求完成和实际回合完成采用不同 outcome；取消请求和观察到的中断确认也分开记录。正常退出先停止并清理运行实例，再排空日志。
- [前端异常入口](../src/lib/frontend-diagnostics.ts)与[日志控制器](../src/lib/app/diagnostic-logs-controller.ts)：不读取异常 message、stack 或 rejection 对象；设置页只读取日志状态，不增加插件或登录检查。

文件位置固定为 `app_storage::data_dir` 选中的 `DATA/logs/`。开发 profile 的 DATA 已包含 `development`，日志模块不重复追加。文件名为 `aibo-UTC日期-BOOT_ID-分片序号.jsonl`，UTF-8、LF、每条完整记录最多 16 KiB。

普通队列 1024 条，ERROR 队列 64 条；单文件 10 MiB，14 天保留期，总容量 100 MiB。所有进程共用 64 KiB 应急预留，最多 32 个进程各持有一个 2 KiB 最小 panic 通道；没有可用通道时仅输出固定安全提示。应急文件在初始化和 UTC 日期变化时由后台预创建，复用容量租约，不使用普通日志队列。正常排空最多等待 2 秒；失败状态与丢弃数量留在内存。Unix 新建目录为 0700、文件为 0600。

## 可复现命令与证据

从仓库根目录执行：

```sh
pnpm run verify
cargo test --manifest-path src-tauri/Cargo.toml --lib
cargo test --manifest-path src-tauri/Cargo.toml --lib -- --test-threads=4
cargo test --manifest-path src-tauri/Cargo.toml --lib diagnostics::tests -- --test-threads=1
cargo test --manifest-path src-tauri/Cargo.toml --lib diagnostic_ -- --test-threads=1
cargo test --manifest-path src-tauri/Cargo.toml --lib tool_views
node --test test/diagnostic-logging.test.mjs test/runtime-diagnostics.test.mjs
node probes/runtime-diagnostics-browser.mjs
node probes/diagnostic-logging-native.mjs
node probes/diagnostic-logging-release.mjs --build
```

当前本机为 macOS arm64。最终 `pnpm run verify` 通过，包含架构、类型、676 项 Node 测试和构建；完整 Rust `--lib -- --test-threads=4` 回归为 423 项通过、0 项失败、4 项既有忽略（不算通过）。日志模块单独为 29 项通过；运行诊断浏览器探针覆盖六个场景，原生开发与正式打包探针均通过。完整回归中的本地监听与子进程权限边界需要在允许这些操作的环境执行；沙箱中的 EPERM 失败不算通过。不限测试并发的一次完整运行发生既有 durable_queue 测试的 transport 失败，限制并发后全部通过；未减少用例或修改该用例。

本轮留存的输出：

- `/private/tmp/aibo-diagnostics-verify.log`
- `/private/tmp/aibo-diagnostics-rust.log`
- `/private/tmp/aibo-diagnostics-focused.log`
- `/private/tmp/aibo-diagnostics-integration.log`
- `/private/tmp/aibo-diagnostics-tools.log`
- `/private/tmp/aibo-diagnostics-browser.log`
- `/private/tmp/aibo-diagnostics-native.log`
- `/private/tmp/aibo-diagnostic-logging-native.json`
- `/private/tmp/aibo-diagnostics-release-build.log`
- `/private/tmp/aibo-diagnostics-release.log`
- `/private/tmp/aibo-diagnostic-logging-release.json`
- `/private/tmp/aibo-diagnostics-linux-setup.log`（隔离容器依赖准备）
- `/private/tmp/aibo-diagnostics-linux-rust-setup.log`（Linux 工具链准备）
- `/private/tmp/aibo-diagnostics-linux-node-setup.log`（Linux Node 依赖准备）
- `/private/tmp/aibo-diagnostics-linux-rust.log`
- `/private/tmp/aibo-diagnostics-linux-native.log`
- `/private/tmp/aibo-diagnostic-logging-linux-native.json`

Rust 用例使用独立临时目录并读取实际 JSONL。原生桌面探针创建唯一 `local.aibo.diagnosticprobe.*` 应用标识；实际文件位于该标识的 `development/logs`，文件名与 boot_id、sequence、事件列表保存在上述 JSON 证据中。探针结束删除自己创建的数据，未访问现有用户数据库。Tauri dev 包装命令在原生 abort 后可能仍返回 0，因此启动故障断言来自真实文件中的 `startup.failed` 及没有 `app.ready`、`app.stopped`，不使用包装命令退出码冒充原生结果。

## T 编号验收范围

| 用例 | 当前结果 | 本机证据与剩余范围 |
| --- | --- | --- |
| T01 | 通过（macOS 开发运行） | 原生探针正常启动/关闭；真实数据库打开、迁移、插件注册故障，各自只有正确阶段失败，无 ready/stopped；Rust 子进程补验数据库故障落盘。 |
| T02 | 通过（macOS） | 原生强杀后重启只有一次 previous_exit_unknown，正常重启不误报；运行锁测试覆盖两个活动实例、正常结束、损坏元数据；降级时运行租约继续持有。 |
| T03 | 通过（macOS） | Rust 子进程持有普通队列锁时 panic，实际应急 JSONL 存在；日期前进与回拨后预备通道轮转，panic 文件日期与记录 UTC 日期一致且分片号递增；每条包含版本/渠道/OS/架构，payload canary 未保存。 |
| T04 | 通过（macOS 已覆盖路径） | 实际 Node 子进程覆盖 ready、预期停止、启动失败、意外退出、协议拒绝与请求失败；SessionHost 与终端工具回归读取实际文件。第三方与内置均按同一宿主合同处理。 |
| T05 | 通过（macOS 已覆盖路径） | SessionHost 子进程覆盖创建、发送、恢复原 nativeSessionId、取消、关闭、错误及退出门禁；完整原生回归保护绑定、代际与队列。 |
| T06 | 通过（macOS 端到端） | 原生桌面真实未捕获异常与未处理拒绝经生产前端提取器及 IPC 落盘；真实 Worker 在后续 revision 的 render 中抛错，经生产可信呈现桥产生 presentation.failed 并读取实际文件。重复指纹被原生抑制并汇总，故障正文不保存。 |
| T07 | 通过（受控字段预算） | 实际 JSONL 解析、超长/中文/换行/控制字符身份拒绝、20 帧边界、单行字节上限、UTC 日期回拨与 sequence/elapsed 单调性。有效 schema 的字段预算小于 16 KiB，超长输入被拒绝或省略，不开放自由文本来构造更大的合法行。 |
| T08 | 通过（已覆盖合成 canary） | 普通文件、panic 应急文件和运行元数据分别检查；请求/响应、token、Cookie、嵌套对象、错误链、panic、聊天、路径、stderr、终端输入输出、URL 参数均不透传。匹配 tracing target 的任意事件也不能进入 sink。 |
| T09 | 通过（macOS） | 独立非可信窗口、缺少顶层文档访问凭据、opaque iframe、伪造级别/会话/路径/message 均拒绝；可信顶层文档正常报告。未扩大现有 Tauri 文件权限。 |
| T10 | 通过（macOS 正式与开发运行） | 正式 app 包启动并正常关闭两次，写入正式 DATA/logs，build_channel 为 release，无 development/logs、boot_id 不复用；开发 profile、同日重启、普通与应急分片 UTC 换日/回拨及大小边界已验证。应急轮转复用一个容量租约，保留旧文件不覆盖，panic hook 不取得日志锁。 |
| T11 | 通过（注入时间及小容量） | 14 天边界、完整记录轮转、总容量、相同封存时间按文件名排序；年龄和容量两种清理都删除了含 app.starting 的旧片，任一保留记录独立包含运行环境。 |
| T12 | 通过（macOS 已覆盖边界） | 两个真实进程并发写入小配额；活动文件不被回收；不可回收时 quota_exhausted；未知文件、外部符号链接与链接目录不被写入或删除。Windows junction 尚未执行。 |
| T13 | 通过（macOS 与故障注入） | 原生权限故障时业务数据库仍可读，生产 30 秒周期恢复；Rust 注入 ENOSPC 的部分写入及删除拒绝，实际文件恢复可解析并有失败/恢复/丢弃汇总；周期性汇总写失败保留原计数，恢复后只汇总一次，不把汇总自身递归计为新丢弃。故障注入仅编译进测试，不接受 IPC 设置。 |
| T14 | 通过（macOS） | 持有真实 profile 文件锁暂停 writer，填满 1024/64 队列后解除；实际文件中 ERROR 保留、丢弃总数准确、正常排空。 |
| T15 | 通过（macOS） | 正常关闭完整排空；持有文件锁永久阻塞场景在 2 秒内返回未完成状态；退出时丢弃汇总遭 ENOSPC，保留待汇总计数和 storage_full，实际文件没有 app.stopped、运行元数据仍为 running。 |
| T16 | 通过（macOS/browser 已覆盖边界） | Material 3/ak-ui 浅深、480px 窄窗口、键盘打开目录动作；两个外部工作台及故障回退后的固定入口；真实桌面仅打开当前 profile 的日志目录，原登录/检查语义保留。 |
| T17 | 未执行 | L2 未实现。 |
| T18 | 未执行 | L2 未实现。 |

## 尚未完成的门槛

Windows 无控制台的正式桌面打包、目录打开、退出与 junction 边界尚未实测。本机的 macOS 结果不能代替 Windows，Linux 容器结果也不计为 Windows 结果。

已提供 [Windows 正式包探针](../probes/diagnostic-logging-windows-release.ps1)及 `refuses_windows_junction_without_writing_or_cleaning_its_target` 原生测试。前者在交互式 Windows 桌面、PowerShell 7、Rust MSVC、Node/pnpm 和 WebView2 环境中构建 NSIS、安装独立产品/二进制/应用身份，读取两次正式运行的实际 JSONL，用独立辅助进程的 [AttachConsole](https://learn.microsoft.com/en-us/windows/console/attachconsole) 错误 6 检查无控制台，再通过 CloseMainWindow 请求正常退出。辅助进程不会改变测试操作者的控制台。它不把启动请求或打包成功当作运行成功；证据显式标注不覆盖目录打开、junction 和前端 IPC。尚未在 Windows 执行该脚本或条件编译测试，不能将语法检查视为 Windows 验收通过。

本轮已用官方 `mcr.microsoft.com/powershell:lts-ubuntu-22.04` Linux 容器的 PowerShell 解析器验证外层及生成的辅助脚本语法，并编译 C# P/Invoke 声明；没有执行 Windows API。输出在 `/private/tmp/aibo-diagnostics-powershell-syntax.log`。`pnpm run verify` 676 项 Node 测试及构建通过，本机日志模块 29 项通过；新 junction 用例受 `cfg(windows)` 限定，未计为本机通过。

Windows 待执行命令：

另已准备 [Windows CI 工作流](../.github/workflows/diagnostic-logging-windows.yml)，仅在手动触发或推送 `diagnostic-logging-windows/**` 专用验收分支时执行，不在普通分支推送时运行。它在 `windows-2022` 上构建当前选择的 revision、执行诊断与 IPC Rust 测试（包括 junction）、安装并运行无控制台的正式包，并按 `github.sha` 留存日志与 JSON。专用分支推送触发可在工作流尚未进入默认分支时使用。该文件尚未发布或执行；只有某 revision 的实际 job 和证据才能证明对应源码结果。这个工作流仍不替代 Windows 设置页打开目录与前端 IPC 到文件的端到端检查。

首次远程运行：[176b13a / Windows job](https://github.com/chldu2000/aibo/actions/runs/38285864145)。依赖安装、前端构建和 Rust 编译成功，但库单元测试程序在运行任何断言前以 `0xc0000139 / STATUS_ENTRYPOINT_NOT_FOUND` 退出。真实错误记录在该 run 的 `diagnostics-rust.log` artifact 中；该次运行不能计为 Windows 测试通过。

已增加 [Windows 测试启动探针](../probes/diagnostic-logging-windows-tests.ps1)：编译并取得 Cargo 返回的库测试程序路径，保留补入 manifest 前后的 `--list` 结果。当原程序报上述入口点错误且没有 manifest 时，使用 Windows SDK `mt.exe` 为这个测试程序嵌入 Common Controls v6 manifest，再执行原有两组测试。这对应 [Tauri 上游问题](https://github.com/tauri-apps/tauri/issues/13419)，不改变正式应用的 manifest，也不省略诊断断言。工作流同时将错误输出写入 artifact 和控制台；其他启动错误仍直接失败。实际修复结果须以新 revision 的 Windows job 为准。

```powershell
cargo test --manifest-path src-tauri/Cargo.toml --lib diagnostics::tests -- --test-threads=1
pwsh -NoProfile -File probes/diagnostic-logging-windows-release.ps1
```

正式包探针结束会卸载自身并删除自身的隔离数据；默认 JSON 证据位于系统临时目录的 `aibo-diagnostic-logging-windows-release.json`。目录打开另须在真实 Windows 设置页触发并核对当前 profile 的目录；前端 IPC 与其他 Windows 原生边界仍须逐项取得实际结果。当前没有 Windows VM、远程桌面或已运行本次源码的 Windows CI 结果，因此这些门槛保留为未验证。

Linux 验证在独立的 `aibo-diagnostics-linux` Ubuntu 22.04 arm64 容器内，无用户目录挂载；Rust 1.99.0、Node 24.18.1、Git 2.56.0、真实 Codex CLI 0.162.1。非 root 用户完整 `cargo test --manifest-path src-tauri/Cargo.toml --lib --jobs 4 -- --test-threads=4` 已取得 423 项通过、0 项失败、4 项既有忽略，覆盖实际文件和子进程。首轮的 Git 2.34.1 缺少 `--no-lazy-fetch`、CLI 缺失及 macOS 专用测试夹具导致失败；已补齐真实依赖，两个测试 helper 设置当前平台，未修改生产插件平台声明或跳过用例。

原生开发探针已在 Linux XDG 数据目录、Xvfb、D-Bus 和真实 Thunar 下通过：非可信窗口与 opaque iframe 拒绝、真实未捕获异常/拒绝及 Worker 后续 render 故障经 IPC 落盘、指纹汇总、权限故障期间数据库仍可用、生产周期恢复、强杀后的异常退出识别、正常结束及三个启动故障。实际目录窗口在注入权限故障前观察到，证据含 `fileManager: Thunar`、窗口标题 `logs`；容器用户的目录关联显式配置为 `thunar.desktop`。软件渲染及 `WEBKIT_DISABLE_SANDBOX_THIS_IS_DANGEROUS=1` 仅用于没有 GPU 与完整宿主隔离设施的测试容器，不写入应用配置；因此该结果是 Linux 原生宿主与容器桌面结果，不代表桌面硬件/GPU 或 Windows 结果。

复现原生 Linux 探针需安装 Tauri 系统依赖、Node 22+、Rust、Xvfb、D-Bus、Thunar 和 xdotool，并将目录关联配置为真实文件管理器；完整 Rust 回归另需支持 `--no-lazy-fetch` 的 Git 和内置插件声明的真实 CLI。目录配置为 Thunar 的隔离测试用户可执行：

```sh
xdg-mime default thunar.desktop inode/directory
dbus-run-session -- xvfb-run -a node probes/diagnostic-logging-native.mjs
```

Linux 原生结果见 `/private/tmp/aibo-diagnostic-logging-linux-native.json`；macOS 结果继续保存于 `/private/tmp/aibo-diagnostic-logging-native.json`，两者没有混用。两平台真实 Worker 还验证了网络、eval、脚本导入被拒绝，服务端 canary 请求为 0。为解决 Linux WebKit 在 opaque iframe 中拒绝外部启动脚本的问题，可信桥文档改为脚本哈希授权，保持其余 CSP 及沙箱权限；六个浏览器场景、macOS 原生与正式打包均在该修改后复验通过。

应急通道由 writer 按 UTC 日期预备新分片，使用 [arc-swap 1.9.2](https://docs.rs/arc-swap/1.9.2/arc_swap/docs/performance/index.html) 的原子引用替换；panic hook 持有自己的文件引用，不依赖队列、状态或 writer 锁。若日期刚变化而新通道尚未预备，旧日期通道不可使用，仅输出固定安全提示并累计丢弃；不把当前日期事件写入旧日期文件。前进与回拨已在实际 panic 子进程中验证，租约复用与分片递增另有实际文件测试。

上述未执行的平台检查完成前保持验收中，不标记完整 L1 完成。
