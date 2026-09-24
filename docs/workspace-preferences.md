# 工作区信任偏好

本文件定义新增工作区的信任设置与持久化行为；整体 UI 边界见 [UI 架构](ui-architecture.md)。

宿主“工作台设置 → 工作区”提供“新增工作区默认信任”，初始开启。
原生 `workspace_preferences` 单例表保存该偏好，`read_workspace_preferences` /
`save_workspace_preferences` 只由宿主管理界面调用。界面仅在原生保存成功后确认开关值；
读取失败时禁止修改并提供重试，浏览器预览不保存原生设置。

`add_workspace` 在插入时直接读取这项数据库偏好；所有添加入口共用此行为，不接收呈现插件传来的信任值。
迁移、修改偏好、重复添加已有目录均不改变已有工作区的信任或权限代际。单个目录仍可在“更多”中调整信任，
上下文保留信任说明，侧栏名称旁不再显示状态圆点。默认信任不替代运行时能力、执行配置或逐操作审批检查。

`test/workspace-preferences.test.mjs` 验证读取、保存、失败回退和异步竞争；
`probes/workspace-preferences-browser.mjs` 验证真实 App 的开关与创建入口（替身 IPC）；
Rust `workspace_preferences::tests` 使用临时 SQLite 数据库验证迁移、重启、重复添加和手动撤销后的状态保留。
