---
status: accepted
---

# 外部 Presentation 使用隔离文档和宿主消息桥

2026-09-13：外部可执行皮肤采用独立 sandbox iframe（仅 allow-scripts，不授予
allow-same-origin），不向主 WebView 注入插件脚本。主题包与可执行包共用
`aibo.presentation-package/v1`，通过可选 entry 和 surfaces 声明定制范围。
同 WebView 模块加载虽然更方便复用 Svelte 控件，但无法阻止插件控制审批和
恢复区域，因此不作为外部包加载方案。

宿主验证 manifest、资源长度和 SHA-256，安装不可变 release，读取时重新验证。
entry 是自包含 JavaScript bundle；资源只能来自包清单。沙箱 CSP 禁止网络、
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
适配隔离呈现。主题只影响呈现范围，固定审批与恢复区域使用宿主默认视觉。

限制：iframe 是权限隔离而非独立进程或 CPU 配额。无限循环等可用性故障须由真实
WebView 探针验证恢复行为；若同进程阻塞使固定入口不可用，发布前须升级为独立
WebView/进程执行，不能把超时回调当作已解决。P2–P4 验收完成前不宣称外部执行
已具备生产支持。

规范依据：[HTML sandbox 与 opaque origin](https://html.spec.whatwg.org/multipage/iframe-embed-object.html#attr-iframe-sandbox)。
