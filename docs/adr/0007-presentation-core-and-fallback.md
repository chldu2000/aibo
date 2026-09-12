---
status: accepted
---

# 必需核心语义与可选专业呈现分别协商

2026-09-12：Presentation Plugin 必须完整实现宿主稳定核心语义 collection、detail、只读 settings 和 inspector；专业呈现按显式 ID、精确版本和适用核心类型协商，缺失或不兼容时使用当前 renderer 的核心视图。专业呈现和降级视图接收同一份经过校验的规范数据及动作，避免为了降级而丢弃关系、目标或必要操作；无法用核心语义保留含义的功能不得伪装成已有类型，须另行扩展版本合同。

呈现实现先作为可信构建模块登记，安装能力包不能凭 manifest 字符串向主 WebView 装载代码。布局归 Presentation Plugin，工作区/会话/草稿/执行结果及可信审批归宿主，视觉风格仍归 skin；插件管理、审批和恢复入口必须在可替换呈现之外保持可用。新合同不把现有 UiKitAdapter 成员改成 optional，也不放宽 app/workbench 的视觉和依赖边界。

首批冻结核心语义契约 1.0.0，旧 experimental-v1 继续独立读取；执行实现的版本与语义版本分开。兼容窗口沿用 P3 的稳定版本承诺。后续批次已实现工作台槽位、专业呈现及独立宿主入口；具体快照版本和当前支持范围按下表判定，不能以协议声明替代实际验收。

## P4 收敛：分别声明语义与快照兼容

核心语义版本仍为 1.0.0，表示必需的 collection/detail/settings/inspector 信息结构。快照协议版本单独通过 renderer 描述符的 `snapshotSchemas` 声明。原因是 1.1 新增了可执行动作：能展示四类核心信息，并不等于能够正确处理新动作格式。

旧描述符未填写该字段时，仅保留原先的 experimental-v1 与 v1 只读读取能力；不会隐式获得 v1.1 支持。显式列表必须包含稳定 v1，不接受重复或未知格式。默认可信呈现显式声明全部三个读取器。协商在专业/核心选择之前检查快照版本，避免把不支持的新动作交给旧 renderer 后再静默降级。

| 合同层 | 当前支持 | 行为与边界 |
| --- | --- | --- |
| 核心语义 | 1.0.0 | 四类均为必需；缺一类拒绝启用 |
| 旧快照 | aibo.semantic-view/experimental-v1 | 独立兼容读取器，保留原解释 |
| 稳定只读快照 | aibo.semantic-view/v1 | 安装贡献 contractVersion 1.0.0、semanticView 协议精确 1.0 |
| 写动作快照 | aibo.semantic-view/v1.1 | 安装贡献 contractVersion 1.1.0、协议精确 1.1；renderer 必须显式声明 |
| 专业呈现 | 按 ID、精确版本、核心类型匹配 | 默认 numbered-detail 1.0.0；缺实现、版本不匹配、资源上限或失败时使用兼容核心视图 |
| 呈现生命周期消息 | experimental-v1 | 可信 renderer 本地适配器承接挂载、更新、释放与代际门；不宣称稳定外部执行接口 |
| 能力运行协议 | 2.0 | 与 Agent Runtime 1.0 分离；UI 格式支持不授予写权限 |
| 安装包中的 presentation 声明 | 尚不开放执行 | 不能将字符串变成主 WebView 内的任意代码 |

布局所有权已通过命名槽位及 standard/focus/review 实际重排验证；宿主仍拥有上下文、草稿、写入结果、批准与恢复入口，skin 拥有视觉表达。以上能力声明不是跨平台验收证明：P4 原生证据来自 macOS，通用 Capability 写入实现按 Unix 平台开放；其他平台的发布支持矩阵继续由 P5 明确。
