---
status: accepted
---

# 外部 Presentation 使用隔离文档和宿主消息桥

2026-09-13：外部可执行皮肤采用独立 sandbox iframe（仅 allow-scripts，不授予
allow-same-origin），不向主 WebView 注入插件脚本。**P2b 实施细化：iframe 只运行
宿主绘制桥，包脚本在其可终止 Worker 中执行，不能直接操作 iframe DOM。**
主题包与可执行包共用
`aibo.presentation-package/v1`，通过可选 entry 和 surfaces 声明定制范围。
同 WebView 模块加载虽然更方便复用 Svelte 控件，但无法阻止插件控制审批和
恢复区域，因此不作为外部包加载方案。

宿主验证 manifest、资源长度和 SHA-256，安装不可变 release，读取时重新验证。
entry 是自包含 Worker JavaScript bundle；资源只能来自包清单。沙箱 CSP 禁止网络、
远程模块、对象、嵌套 frame、表单和 eval，只放行宿主生成文档中的已验证脚本
与样式及必要的内嵌资源。插件无宿主文件、Tauri IPC、主文档和宿主存储权限。
主题值必须经过宿主语法校验，不允许 URL 或任意 CSS 声明注入。

宿主只接受当前 frame、当前代际和当前上下文的结构化消息。插件通过消息桥
接收窄快照、发出语义意图；桥不暴露通用 IPC 或能力调用。草稿、执行权、审批、
历史及恢复按钮留在宿主，插件退出时销毁 frame 并撤销通道。初始化超时、错误、
丢包或不兼容均回到上一可用呈现或内置默认呈现；升级在候选准备完成后提交。

定制范围是同一包内的可选角色：无 entry 的主题包继承所有宿主控件与布局；
controls 使用宿主定义的控件数据和动作桥，semantic 消费完整核心语义，
workbench 消费宿主工作台快照。缺省角色由宿主补全，不能因可选定制缺席而丢失
核心功能。外部控件不是跨文档传递 Svelte Component，UiKitAdapter 通过宿主包装
适配隔离呈现。执行包通过 `self.aiboPresentation.render(input)` 返回视觉树；
可使用任意计算与布局类名，但不接受任意 HTML、脚本节点、事件属性或远程 URL。
视觉树是 Presentation 输出，不混入能力插件的语义合同。样式与字体/图像来自
已验证资源。主题只影响呈现范围，固定审批与恢复区域使用宿主默认视觉。

直接在 iframe 执行包脚本会让包获得导航能力，并可能阻塞宿主线程。因此采用
Worker 计算、宿主校验绘制的接口，而不是把 iframe 沙箱本身当作 CPU 隔离。
初始化/更新超时和持续心跳监测终止失控 Worker；绘制限制树深度、节点数量、
文本、属性和事件范围。代价是现有依赖 DOM 的 Svelte 控件不能直接作为外部
entry，迁移时必须用视觉树接口表达，或提供针对该接口的编译支持。

限制：Worker 不是独立原生进程或内存配额。P2b Chromium 探针验证了初始化与
运行中无限循环的终止、恢复入口可用和后续重新挂载；原生 WebView、超大消息及
内存耗尽仍须验收，不能从 Chromium 推断所有平台支持。P2–P4 验收完成前不宣称
外部执行已具备生产支持。

规范依据：[HTML sandbox 与 opaque origin](https://html.spec.whatwg.org/multipage/iframe-embed-object.html#attr-iframe-sandbox)。
