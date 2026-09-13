# shadcn Presentation

独立构建的皮肤包，当前版本迁移原有全部主题、四类核心语义视图、模型矩阵和状态标记。
工作台及其他控件继续继承宿主，完整工作台迁移仍在进行。

将本包与 `@aibo/presentation-tools` 本地 tarball 安装到仓库外项目后：

```sh
node node_modules/@aibo/presentation-shadcn/build.mjs ./dist/shadcn-0.1.0 0.1.0
```

在 App 外观设置中安装输出目录。升级使用相同包 ID 和新的版本/输出目录。
`themes.json` 是主题的唯一数据源，宿主内置兼容入口也读取此文件。
包脚本仅产生受限视觉树，不导入宿主源码、Svelte 或 DOM；宿主负责验证和执行动作。
字体 token 在输出时去掉引号以满足纯数据 token 合同，多词 CSS 字体族仍可用。
