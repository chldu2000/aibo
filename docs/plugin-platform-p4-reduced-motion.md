# P4 第三十六批：统一 reduced-motion 策略

原先少数状态指示器和通知单独处理 reduced-motion，但按钮、详情展开等其他过渡仍会执行。新增 UI 层 `kits/motion.css`，由 app.css 在皮肤规则之后导入，覆盖当前 WebView 的组件和伪元素，也包含挂载到 body 的浮层。

减少动态效果时，动画和过渡时长压到 0.01ms，清除延迟、禁止无限重复和平滑滚动。使用近零时长而非统一 animation:none，是为了保留 UI 组件可能依赖的完成事件。原有状态指示器的静态反馈仍由各皮肤负责；普通模式规则不变。

`pnpm run verify` 通过：25 项架构测试、类型检查、165 项 Node 测试及生产构建。

## 证据

`node probes/reduced-motion.mjs` 加载实际 App 浏览器预览及真实 UiKit 运行状态组件，切换两套皮肤和媒体偏好。

- 普通模式必须观察到非零运行动画与过渡，防止测试因组件未渲染而空通过。
- 减少动态效果模式读取所有已挂载元素和 before/after 伪元素的计算样式，检查时长、延迟、重复次数和滚动方式。
- 两套皮肤分别检查 444/363 组样式；布局交换与恢复操作继续成功。
- [机器可读结果](./baselines/plugin-platform-p4/reduced-motion-browser.json)。该证据属于 Chromium 浏览器，不声称已验证所有未来组件、程序式 Web Animations 或原生 WebView 的系统偏好。

P4 的完整原生桌面和无障碍退出矩阵仍需继续完成。
