# @aibo/presentation-workbench

两套独立皮肤共用的纯数据工作台呈现模块。模块只将公开 Presentation 数据和
宿主动作目录转换成视觉树，不引用宿主代码、DOM、框架或业务执行端口。

当前提供 `renderNavigation`、`renderConversation`、`renderGit`、`renderInspector`，
参数均为 `(state, actions)`；`renderCapability(state, actions, renderSemantic)`
接收皮肤自己的语义 renderer。
调用方拥有样式；模块只生成语义结构、可访问性属性及当前目录中的动作绑定。
Git、Inspector 和能力视图模块已建立，整合布局及功能/视觉验收尚待完成，
双皮肤 0.2.0 已启用 workbench；完整退出验收仍在进行。
这是完整工作台迁移的中间阶段，不是可替代整个 App 的完成版本。

执行权限、附件状态/元数据、诊断能力与会话绑定信息已接入。
后续验收还需补足专用工具展示、窗口布局
和跨实例焦点/滚动恢复。消息富文本与内置呈现共用解析器，链接/复制通过宿主当前消息动作目录执行。
当前模块通过纯数据和 Worker 输入/动作测试，已作为整工作台进入实际 App 浏览器流程，基础原生安装/升级/重启/禁用/卸载已在 macOS arm64 验证，完整原生退出项仍待完成。

`renderWorkbench(input, renderSemantic)` 装配三栏布局的语义结构，外层样式由皮肤
提供。`workbenchSource()` 仅打包本包固定模块，不执行输入源码，不读取宿主源码
或下载第三方依赖。生成的脚本供 Worker 使用。

`./markdown` 导出纯数据解析与目标提取，支持内置呈现既有的 Markdown 子集。
`renderRichText` 只绘制安全视觉树，链接和复制代码按钮必须匹配当前宿主 token。
未提供 token 时按钮禁用，不回退为任意 URL 或包自有剪贴板调用。

工具消息以原文 `pre` 显示调用参数或输出，避免 Markdown 改写命令和 diff；
推理消息使用稳定消息键的原生折叠区域，状态标签保留生成中、失败和中断等区别。
连续工具按组显示数量与完成数；系统消息按宿主 `groupSystemItems` 提示分组，
推理、分支摘要和压缩摘要保持独立。内置呈现与插件共用 `./timeline-model` 的纯数据规则。
