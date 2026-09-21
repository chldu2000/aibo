# P0 第二轮门槛评审：真实 Tauri 集成

日期：2026-09-22。结论：**No-go，不能进入生产 DOM 加载与 SDK 定稿。**
这表示候选方案未满足退出条件，不表示框架无关的长期目标被取消。
第一轮实验与功能影响矩阵仍见 [P0 原始记录](presentation-framework-p0.md)。

## 会影响后续决策的结果

实验在实际 Aibo App 中嵌入 React/Svelte 原生子 WebView，使用独立应用标识和
临时 Git 仓库。仅 `presentation-dom-p0` 调试 feature 启用实验；默认构建仍保留
原有 Worker 路径。源码保存在 `prototype/presentation-dom-p0-gates`，不能将
实验桥或私有 WebKit 诊断接口作为生产实现合入。

1. **应用 IPC 可以显式收紧。** 构建应用 ACL manifest，再按 `webviews` 指定
   可信 `main` 与仅有 `p0_post` 的文档视图。真实子视图调用应用读命令、审批命令、
   宿主实验命令和 core window/event 命令均被拒绝；专用桥正常回传。
   不能沿用按 `windows: ["main"]` 授权的思路：子视图也属于这个窗口。
2. **原生子视图不是现有宿主的无缝替换。** 子视图挂载前后调用同一个
   `get_presentation_selection`，由成功变为 `current webview is not a WebviewWindow`；
   移除子视图后恢复。`list_workspaces` 始终可用。原因是 Tauri 2.11.5 的
   `WebviewWindow` 参数要求窗口仍符合单 WebView 条件；这不是 ACL 漏配。
   若继续该方向，必须审计并改造调用者身份与窗口操作合同，不能批量改参数后就
   假定所有依赖窗口作用域的审批、设置、安装和恢复仍然正确。
3. **宿主存活不等于故障终止。** 循环中宿主心跳继续、原生 Git 审批可完成，
   但公开的 `Webview.close()` 返回并不意味着循环进程已经退出。不得把新视图
   可以挂载记作失控资源回收通过。进程寿命与内存必须作为独立门槛。
4. **真实审批的正面证据有边界。** 探针先发起暂存请求，再挂载子视图；循环中通过
   macOS AXPress 确认，临时仓库索引确实出现 `p0-proof.txt`。这证明已存在的原生
   审批仍可完成，不证明子视图挂载后新发起的全部写命令正常，也不是 Agent 审批、
   硬件鼠标/键盘或整个恢复工作流验收。

## 门槛判定规则

| 门槛 | 判定 | 依据与剩余条件 |
| --- | --- | --- |
| 同一合同由 React/Svelte 管理 DOM | 局部通过 | 两框架可挂载及替换；仍是 conversation fixture，不是完整工作台 |
| 文档不能直接调用通用 IPC | 局部通过 | 原生 ACL 拒绝样本、受限桥、旧 generation；静态核对全部 107 个应用命令；不能当成全命令动态攻击覆盖 |
| 嵌入后宿主功能完整 | **失败** | `WebviewWindow` 命令回归；窗口命令与文档身份需要解耦 |
| 故障期间审批与管理/恢复 | 部分验证 | 已存在的真实 Git 原生审批通过；所有可信 UI 的层级、焦点、强制暂停与恢复尚未完整接线 |
| 故障进程与内存回收 | **失败** | 关闭后超过 5 秒仍有约 100% CPU 的原进程；诊断性杀进程不能替代生产终止合同 |
| 完整动作授权 | **未通过** | 118 项策略盘点完成，生产准入未实现；只验证 draft/send 原型和原生 Git 审批样本 |
| 性能、IME、附件与反复切换 | **未通过** | 有固定长历史/消息洪泛样本；无完整输入/IME、图片解码、持续内存峰值及长期切换基线 |
| 跨平台支持 | **未通过** | macOS 当前环境有结果；Windows/Linux 没有本轮原生证据 |

## 动作策略盘点

[action-policy.json](../probes/presentation-dom-prototype/action-policy.json) 为每个公开操作
显式给出候选策略；[静态审计](baselines/presentation-dom-p0/action-audit.json)核对
conversation 38、navigation 20、Git 34、inspector 18、layout 2、capability 6，共
118 项。新增操作必须重新分类。此文件是评审输入，**不会自动赋予执行权限**。

| 候选策略 | 示例 | 宿主必须执行的检查 |
| --- | --- | --- |
| local-input | draft、answer、renameDraft、commitMessage、projectField、resize | 当前实例和编辑目标、许可字段、长度/频率、单调编辑序号、确认/重同步；不扩大 revision 例外到发送或导航 |
| scoped-read-or-view | loadOlder、openDiff、selectCommit、toggleReading | 当前作用域和 token、当前 revision、资源读授权与预算；晚到读取不能覆盖新选择；视图状态由宿主保存 |
| trusted-host-request | send、stop、queue、目标/模型/权限变化、切换会话、Git 写入、工程任务、打开链接/剪贴板 | 插件只能提出请求；可信宿主交互绑定精确参数、重新验证状态和权限、请求去重、结果关联及未知结果；不可只核对插件 `isTrusted` |
| declared-semantic-policy-or-deny | capability.semantic | 展开宿主已验证的语义动作；未知类别拒绝；不能按提供者名称或自报“只读”放行 |

分组对可导致副作用的动作采取保守确认要求，但这**不是已选定的产品交互**。
例如会话切换与发送都增加一次确认将明显改变日常体验。下一轮应比较可信宿主
操作区、宿主绘制的受控交互控件，以及明确授权的自动化能力；不能用“本次点击
来自插件 DOM”或转发 `isTrusted` 免除授权证明。重复、旧上下文、跨会话、撤销后
的请求要逐类验证；真实写入提交后切换外观不得吞掉结果或自动重试。

## 资源与性能结论如何使用

本轮压力源都是有限的：64 MiB 实际触页分配、2,000 个小消息、128 KiB 超限消息，
以及 1,000 条约 950 字符文本的全量快照。64 KiB 入站/2 MiB 快照/100 消息每秒
只是实验参数，尚不是生产安全预算。入站大小检查发生在 JSON 解析之后，无法
限制解析前内存、引擎队列或原生 IPC 解码压力；短时洪泛拒绝不能证明内存攻击隔离。

快照耗时测量从宿主发送到收到文档 rAF 回执，使用 25 ms 轮询。它包含桥和轮询
开销；不能与“用户输入到像素显示 p95 ≤100 ms”直接等同。初次完整记录中
20 次更新 p50=91 ms、p95=155 ms，约 1.03 MiB/快照。后续应比较增量更新、
背压与虚拟化，再按固定输入轨迹测量；不应为通过验收而放宽输入门槛。

RSS 是离散采样，不是峰值、独占物理内存或泄漏证明。原生内容 PID 通过私有
`_webProcessIdentifier` **仅用于诊断和准确定位故障注入目标**；它不进入支持合同。
`SIGKILL` 证明被杀后的宿主存活/替换，与公开 API 能可靠识别和终止所属失控进程
是两件事。后者未成立前，不承诺安装任意第三方 DOM 后仍有可控资源隔离。

DOM 渲染收到的图片像素/字节天然可被文档脚本读取。即使禁止网络、文件与剪贴板，
也不能继续宣称“呈现不接触图片”。后续需新增作用域化资源句柄、撤销、解码尺寸/
内存限制，并测试附件跨切换；本轮无图片场景，不以文字压力结果替代图片验收。

## 平台与下一步决策

| 平台 | 已有证据 | 可声明的支持 |
| --- | --- | --- |
| 本机 macOS arm64 / WKWebView | 原生 App、ACL、循环、审批、进程诊断 | 仅实验验证；当前候选未达生产门槛 |
| Windows / WebView2 | 无本轮运行证据 | 未确定；需同等 IPC、输入、故障及回收实测 |
| Linux / WebKitGTK | 无本轮运行证据 | 未确定；不能从 macOS 推断 |

建议保留框架无关的数据/动作协议目标，同时把下一步限定为**容器监督与可信交互
专项原型**，暂停 P1 SDK 定稿及 P2 生产 DOM 加载。先证明一个公开、可维护的终止
方案及宿主调用合同；如果必须采用独立受监督进程或原生平台适配，其部署、内存、
输入与跨平台成本应重新估算。若成本不可接受，再由目标决策明确选择：限制 DOM
扩展信任等级/范围，或保留安全受限视觉树作为第三方默认路径。

这里不默认把“任意框架”改成“任意第三方脚本完全可信”，也不默认缩成仅 macOS。
**不新增容器已选定 ADR，不替代 ADR-0009。** 退出 checklist 保留未通过项；未来
取得新证据后再接受运行容器 ADR，并同步旧 Worker 合同的适用范围。

## 本轮原始证据与复现

| 文件 | 记录 |
| --- | --- |
| [最终原生记录](baselines/presentation-dom-p0/tauri-app-gates.json) | 22 个观测步骤完成；应用/未知视图 IPC、真实审批、管理中心、5 秒回收、消息压力及崩溃 |
| [机器判定](baselines/presentation-dom-p0/gate-assessment.json) | `probeCompleted: true`，`p0Passed: false`；兼容与回收门槛明确失败 |
| [首次完整运行](baselines/presentation-dom-p0/tauri-app-first.json) | 关闭后 1 秒仍有循环；未清理该循环时完成长历史测量 |
| [首次渲染超时](baselines/presentation-dom-p0/tauri-app-render-timeout.json) | 首个视图未按期返回绘制确认；不能解释成启动成功 |
| [部分运行](baselines/presentation-dom-p0/tauri-app-partial.json) | 关闭后 5.5 秒仍为 99.7% CPU；管理中心 AXPress 成功；替换视图绘制超时 |
| [运行环境](baselines/presentation-dom-p0/environment-gates.json)、[构建](baselines/presentation-dom-p0/build-gates.json) | macOS 27.0 / arm64、Tauri 调试构建、React/Svelte 固定版本与 bundle 大小 |
| [源码摘要](baselines/presentation-dom-p0/source-gates.json) | 可复核此次最终探针与实验原生代码的 SHA-256 |

最终运行关闭后 **5,212 ms**，原进程仍存在、CPU **96%**、RSS **103,696 KiB**。
随后只对诊断得到的那个内容进程注入 SIGKILL，才继续性能测量。20 次全量更新
p50 **65 ms**、p95 **81 ms**；首次更新 **192 ms**；快照 **1,078,429 bytes**。
2,000 条消息中 **82** 条成功、**1,918** 条被拒绝，宿主继续计时。
三个挂载样本 **111/106/250 ms**，不足以作为稳定的挂载 p95 分布。
不同运行的机器负载、剩余循环、焦点状态和采集版本不同，不将 155→81 ms 描述为
某项优化的因果收益，也不将这一文本样本等同于完整产品预算通过。

采集问题与失败记录保留如下：未知视图的完整 ACL 错误通过 document.title 回传时
被系统截断，改成短摘要后取得可解析结果；这条通路仅为诊断，不是插件桥。
有一次并行启动与旧探针争用 Vite 5173/缓存，改成独立缓存及串行执行。
绘制回执曾超时，最终脚本分开记录“收到快照”和 rAF，超时记为 `null`/失败并继续
独立资源实验，**没有把收到快照算作绘制通过**。最终运行无绘制超时，但此前失败
仍说明稳定性需要专门复测。部分运行中 Git 已完成而 AX helper 未找到待批对话框，
其确认来源未归因；仅首次和最终确实返回 AXPress 成功的运行作为审批输入证据。

复现（在原型分支，从仓库根目录依次运行）：

```sh
npm ci --prefix probes/presentation-dom-prototype --ignore-scripts
node probes/presentation-dom-prototype/tauri-app.mjs
node probes/presentation-dom-prototype/audit.mjs
node probes/presentation-dom-prototype/evaluate.mjs
```

原生 probe 的完成标记和退出码不能代替 `evaluate` 及门槛评审；完成一组实验可能
得到失败的候选方案。真实待审批请求在子视图创建前发起，以免被已发现的宿主
`WebviewWindow` 参数兼容故障挡住；这个实验安排不修复或绕过产品门槛。

## 回归范围与限制

- `pnpm run verify`：架构检查、TypeScript、Node 测试与构建；结果见
  [验证摘要](baselines/presentation-dom-p0/verification-gates.json)。
- `cargo test --manifest-path src-tauri/Cargo.toml --features presentation-dom-p0 --lib`：
  **234/234** 通过。第一次沙箱内运行有一项旧进程回收测试因 `ps` 被禁止失败，
  获准在可控制测试进程的环境重跑全部通过；未修改或删减该测试。
- `cargo check --manifest-path src-tauri/Cargo.toml`：验证关闭 feature 的原有构建。
- `node probes/presentation-dom-prototype/browser.mjs`：原有 React/Svelte 草稿、
  可信确认与伪造/过期/撤销拒绝检查通过，见 [浏览器重跑](baselines/presentation-dom-p0/browser-gates.json)。
- `node probes/presentation-full-skins-browser.mjs`：**未通过**。旧脚本仍查找
  “打开设置”，当前 App 已使用“打开管理中心”；临时仅更新入口名后，进一步在
  `input[aria-label="导航宽度"][value="261"]` 的可见性断言超时。这两次日志见
  [原脚本失败](baselines/presentation-dom-p0/skins-original-failure.log)与
  [入口更新后的诊断](baselines/presentation-dom-p0/skins-diagnostic-failure.log)。
  原脚本与断言已保留原样，没有用减少覆盖来取得成功；本轮未修改产品前端，
  该旧路径问题需另外诊断，**不能声称双皮肤/旧 Worker 的完整回归通过**。

实验 fixture 的 React/Svelte 身份分支只负责选择固定测试资源；没有在宿主业务中
按 Agent、能力提供者或生产皮肤身份分流。权威工作区、写入请求与结果仍由原生
宿主持有；对话 fixture 的草稿仍是模拟状态，未冒充完整 App 持久化验收。
