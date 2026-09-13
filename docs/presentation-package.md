# Presentation 包合同 v1

本合同是 [Presentation 重构 P1](presentation-plugin-refactor.md) 的实现目标。
目前已有 schema、纯数据类型和资源验证器；App 安装与执行接入属于 P2。

包根目录使用 `presentation.json`。主题、控件和整窗呈现使用同一 manifest，
同一插件 ID 的不同版本是不同 release。独立于现有能力包的 `plugin.json`，
不能通过能力包旧 presentation 声明绕过新安装与验证流程。

```json
{
  "schema": "aibo.presentation-package/v1",
  "id": "dev.example.ocean",
  "version": "1.0.0",
  "displayName": "Ocean",
  "hostApi": "1.0.0",
  "coreSemantics": "1.0.0",
  "snapshotSchemas": ["aibo.semantic-view/v1"],
  "resources": [],
  "themes": [{
    "id": "ocean",
    "label": "Ocean",
    "colorScheme": "dark",
    "tokens": { "--primary": "#4a80cc" }
  }],
  "defaultThemeId": "ocean"
}
```

## 版本与身份

| 字段 | 含义 |
| --- | --- |
| schema | manifest 格式；当前只接受 v1 |
| id | 稳定插件身份，小写点号或连字符分段 |
| version | release 版本，当前采用三段非负整数，拒绝前导零 |
| hostApi | 外部呈现消息桥接口版本，当前精确 1.0.0 |
| coreSemantics | 必须保留的业务信息结构，当前精确 1.0.0 |
| snapshotSchemas | 显式可读快照格式；必须包含稳定 v1，不能从语义版本推断 v1.1 写动作支持 |

包的完整性身份还包含原始 manifest 与全部声明资源的摘要；同 ID/版本不同内容
不得覆盖已有 release。manifest 字段不授予文件、网络或执行权限。

## 可选定制与默认继承

| 声明 | 行为 |
| --- | --- |
| themes | 宿主默认主题上的 token 覆盖；未提供的 token 保留默认值 |
| entry | 自包含 Worker JavaScript bundle，路径必须对应声明为 text/javascript 的资源 |
| surfaces: controls | 使用宿主控件消息合同定制视觉；未处理控件使用默认实现 |
| surfaces: semantic | 实现核心 collection/detail/settings/inspector；缺失必需语义拒绝激活 |
| surfaces: workbench | 使用宿主快照和动作组织整个工作台；管理、审批、恢复区域留在宿主 |

entry 与 surfaces 必须同时提供，themes 与 defaultThemeId 同样成对。
包至少提供 themes 或 entry。不提供某个 surface 时继承宿主实现；声明提供后
初始化失败不能静默标为成功，必须触发恢复。主题与可执行角色共同激活，不能
出现候选主题已生效、旧工作台仍被视为新 release 的半提交状态。

## 资源与校验

resources 中每个条目声明 path、sha256、bytes 和 mediaType。
支持 JavaScript、CSS、PNG、WebP、WOFF2。entry 不使用远程 import；构建工具
必须产出自包含 bundle，资源由宿主提供。未在清单中的文件不提供给呈现。

资源路径只允许字母、数字、下划线、连字符、目录分隔符和最后一个扩展名，
拒绝绝对路径、点目录、编码路径和反斜线。大小写折叠后不可重复；原生安装器
还必须拒绝符号链接及任何解析后逃出包目录的文件。

manifest 最大 128 KiB，最多 128 个资源、单个资源最大 8 MiB、资源总量最大
32 MiB。安装和重新加载都验证实际长度与 SHA-256，不根据文件名或缓存记录
假定文件仍可信。原生读取应在分配内存前应用同样的限制。

主题值允许基本数字、颜色和 CSS 数学/颜色表达式；拒绝 URL、CSS 声明分隔符、
注释、转义和资源获取函数。token 应按宿主语义使用；样式资源只进入隔离呈现，
不能覆盖宿主固定区域。

## 执行与恢复

隔离决策见 [ADR-0009](adr/0009-presentation-package-isolation.md)。宿主验证包后，
创建新的隔离呈现代际，通过 ready/preflight 确认兼容后提交选择。消息必须校验
来源、代际、工作区/会话上下文和动作权限；不接受任意 Tauri 命令名称。

包缺失、校验失败、不兼容、初始化超时和执行故障都需要实际 App 验证。
本合同文档不代替消息桥实现、安装事务或沙箱逃逸与可用性探针。

## P2b 可执行入口

包代码运行于 Worker，定义 `self.aiboPresentation.render(input)`，同步或异步返回
`PresentationNode`。输入与视觉树类型从 `@aibo/plugin-protocol` 导出，不需要 DOM
类型。最小入口如下：

```js
self.aiboPresentation = {
  render(input) {
    return {
      tag: 'button', key: 'refresh', text: '刷新',
      className: 'toolbar-button', events: { click: 'refresh' }
    };
  }
};
```

input 包含 surface、宿主 context（workspaceId/sessionId/revision）、data 和主题
token。渲染函数不能直接调用业务操作：宿主绘制桥仅从真实用户事件构造 intent，
主宿主再次匹配上下文并按业务权限执行。插件伪造 Worker intent 消息不会被转发。

节点 key 在一棵树内唯一，稳定 key 用于恢复焦点、光标与滚动位置。节点只能使用
已声明的标签、属性和事件；不允许 script、iframe、任意 on* 属性或 href/src URL。
图片使用 `resource` 指向包内 PNG/WebP；SVG 图标使用受限 svg/path 等节点。
CSS 字体或图片地址可写 `url("aibo-resource:font.woff2")`，宿主只替换已验证资源。

候选 iframe 在首棵有效树绘制前隐藏，activate 前禁止 intent。初始化与更新
具有超时，Worker 心跳发现运行中失控后终止 Worker 并移除 frame。宿主销毁旧
实例时关闭 MessagePort、移除文档并释放 Worker URL。输入 revision 必须递增，
旧树上的迟到用户事件不会获得新上下文权限。

宿主可将明确的本地编辑动作（当前为工作台 draft）加入 localInputActions。
这类 input 事件在同一工作区/会话内允许跨快照 revision，防止流式或草稿快照
更新丢弃连续打字；它不放宽导航、发送、停止或跨会话动作的校验。绘制桥为本地
输入生成 editSequence，宿主快照回传确认序号，较旧渲染结果不得覆盖尚未确认的
文本和光标。可执行包不能自行把动作加入此宿主许可列表。

Ctrl/Command+Shift+Backspace 是宿主保留的恢复快捷键。固定绘制桥在 iframe
捕获真实按键并发送恢复消息，因此焦点在外部输入框时也能恢复内置呈现；该消息
不经过包 Worker 的事件处理。
