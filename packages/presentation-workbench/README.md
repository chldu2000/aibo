# @aibo/presentation-workbench

两套独立皮肤共用的纯数据工作台呈现模块。模块只将公开 Presentation 数据和
宿主动作目录转换成视觉树，不引用宿主代码、DOM、框架或业务执行端口。

当前提供 `renderNavigation`、`renderConversation`、`renderGit`、`renderInspector`，
参数均为 `(state, actions)`；`renderCapability(state, actions, renderSemantic)`
接收皮肤自己的语义 renderer。
调用方拥有样式；模块只生成语义结构、可访问性属性及当前目录中的动作绑定。
Git、Inspector 和能力视图模块已建立，整合布局及功能/视觉验收尚待完成，
因此皮肤 manifest 尚未启用 workbench。
这是完整工作台迁移的中间阶段，不是可替代整个 App 的完成版本。

后续验收还需补足详细执行权限/附件元数据、消息富文本与专用工具展示、窗口布局
和跨实例焦点/滚动恢复。当前模块通过纯数据和 Worker 输入/动作测试，尚未作为
实际 App 的完整工作台启用。
