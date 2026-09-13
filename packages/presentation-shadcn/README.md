# shadcn Presentation

独立构建的皮肤包，当前版本迁移原有全部主题、四类核心语义视图、模型矩阵和状态标记。
0.2.0 开始同时声明 workbench，装配独立导航、会话、Git、Inspector 和能力视图。
工作台完整视觉/功能验收仍在进行，未提供的独立控件继续继承宿主。

将本包与 `@aibo/presentation-tools`、`@aibo/presentation-workbench` 本地 tarball 安装到仓库外项目后：

```sh
node node_modules/@aibo/presentation-shadcn/build.mjs ./dist/shadcn-0.2.0 0.2.0
```

在 App 外观设置中安装输出目录。升级使用相同包 ID 和新的版本/输出目录。
`themes.json` 是主题的唯一数据源，宿主内置兼容入口也读取此文件。
包脚本仅产生受限视觉树，不导入宿主源码、Svelte 或 DOM；宿主负责验证和执行动作。
字体 token 在输出时去掉引号以满足纯数据 token 合同，多词 CSS 字体族仍可用。

`assets` 携带原有 OpenAI/Pi SVG 与来源说明，构建将路径数据编入受摘要保护的
Worker 入口。运行时使用宿主允许的 SVG 视觉树，不加载宿主资产 URL 或任意 SVG 文档。
状态轨迹、运行/关注/故障信号及减少动画偏好由包样式负责。

构建的可选第四参数为逗号分隔的 surfaces，例如 `controls,semantic` 可构建
保留宿主工作台的组合；默认是 `controls,semantic,workbench`。更改资源或角色
必须使用新发布版本，原生安装会拒绝相同 ID/版本的不同内容。
