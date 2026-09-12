# P4 退出条件核对

本表按实施清单逐项记录核对结果。分批实现记录中的“仍待完成”描述的是当时状态；当前结论以代码、测试及实际探针的覆盖范围为准。未核对项保持未完成，不能由单项通过推导整个 P4 已完成。

## 呈现协商与失败恢复

**结论：协商与分层降级项已完成核对。**

| 要求 | 当前实现 | 验证证据 |
| --- | --- | --- |
| 缺必需核心语义拒绝启用 | `renderer-descriptor.ts` 要求 collection/detail/settings/inspector 全部存在；`PresentationSurface.svelte` 在切换预检时调用协商 | `renderer-negotiation.test.mjs` 拒绝缺失、重复、未知核心语义及不兼容协议声明 |
| 专业呈现只按明确合同匹配 | `renderer-negotiation.ts` 按 ID、版本、语义类型匹配；`presentation-adapters.ts` 再查可信构建中的实际实现 | `renderer-negotiation.test.mjs`、`presentation-adapters.test.mjs` 覆盖版本不匹配、错误语义类型和缺实现 |
| 可选增强缺失局部回退 | 协商保留完整快照，选择当前核心适配器；Surface 显示降级原因 | [双皮肤实际探针](./baselines/plugin-platform-p4/specialized-presentation-browser.json)覆盖版本不匹配、专业挂载和更新失败、全文与动作保留 |
| 核心呈现也不可用时给出说明 | 生命周期错误经 `onError` 和切换 Promise 传到 Surface 的 `role="alert"`；不允许已卸载呈现继续发动作 | `presentation-lifecycle.test.mjs` 新增专业/核心连续失败回归，验证错误、旧通道失效、快照保留和再次恢复；说明的 DOM 接线已核对，双重故障尚无独立浏览器注入探针 |
| 失败不能阻止后续恢复 | 生命周期队列吸收已报告的失败，后续切换继续使用最新快照与恢复状态 | 同一回归验证更新后的 revision、焦点、恢复后动作，以及旧通道冒用新 generation 被拒绝 |

这里的核对证明协商与控制器恢复逻辑，不替代独立宿主恢复入口的桌面验收，也不宣称任意第三方前端可加载。默认 Presentation Plugin 仍随可信构建发布。

本批验证：`pnpm run verify` 通过（25 项架构检查、168 项 Node 测试、类型检查及生产构建）；`node probes/specialized-presentation.mjs` 复跑通过，两套皮肤的全部断言与已有归档一致。构建仍提示主 chunk 超过 500 kB，未调整告警阈值。本批未修改 Rust。

## 尚需逐项核对的 P4 范围

- 标准贡献的通用入口、提供者诊断及无需逐皮肤修改的安装证据。
- 实际专业呈现的数据、操作、选择规则与皮肤边界。
- 独立插件管理、审批、历史、停用及默认工作台恢复。
- 项目任务/Git 服务边界、受控写入、日志及资源限制。
- 直接与插件间 Capability 写入、审批预检执行边界。
- 页面生命周期、过期上下文及权限复核。
- 整体布局、全部核心视图、键盘、焦点、无障碍标签及减少动态效果。

以上已有多批实现和专项证据，列表表示尚未完成本轮逐项归档，不表示需要重新实现。
