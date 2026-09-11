# P4 第三十八批：无障碍树与原生恢复入口

本批验证真实暴露的无障碍语义，不以 DOM 中存在 aria 属性代替系统可访问性检查。

`pnpm run verify` 通过：25 项架构测试、类型检查、165 项 Node 测试及生产构建。

## 浏览器

`node probes/workbench-accessibility.mjs` 通过 Chromium Accessibility.getFullAXTree 读取实际 App 的可访问性树：两套皮肤各覆盖 standard/review/focus，检查交互控件有名称、单一 main landmark，以及宿主恢复按钮持续暴露。

另挂载 collection、detail、只读 settings 和 inspector，验证按钮与文本框名称、非 collection 文本框的 readonly 状态，以及错误状态的 alert 角色。

[浏览器结果](./baselines/plugin-platform-p4/workbench-accessibility-browser.json)。该检查不等于对所有业务数据和未来组件的读屏认证。

## macOS 原生

`node probes/workbench-accessibility-native.mjs` 使用隔离应用标识和真实临时工作区，挂载实际 App。Swift helper 仅遍历 runner 确认的隔离进程，设置该进程的增强可访问性；限制树深度与节点数量，截断时失败。

两套皮肤各覆盖三种布局。standard/review 检查 22 个原生按钮，focus 检查 12 个；所有应用按钮均有普通可访问名称。macOS 关闭/最小化按钮没有普通名称字段，但具有系统子角色、非空角色描述及 AXPress 动作；探针显式验证并单独记录这些系统控件，不把它们误报为应用标签缺失。

每套皮肤还通过 AXUIElementPerformAction 实际按下“恢复默认呈现”，随后在真实 WebView 验证布局返回 standard。[原生结果](./baselines/plugin-platform-p4/workbench-accessibility-native.json)。外层 runner 退出码为 0，结束隔离应用时的内部 ELIFECYCLE 属于清理输出。

本批证明当前已挂载控件的名称、核心只读/错误语义和原生恢复动作。无需将其描述为完整 VoiceOver 人工体验测试；P4 退出仍要结合其他批次的键盘、焦点、动效、写入、历史兼容与版本合同证据逐项核对。
