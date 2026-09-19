# 插件声明的权限与会话模式菜单

会话能力提供者在自己的 `capabilityProvider` contribution 上声明 `sessionControls`。
宿主不按 Agent 名称或执行后端生成菜单；没有声明就没有可选菜单，不补充默认选项。
声明随不可变插件 release 保存，当前会话始终读取其绑定版本和贡献的声明。

```json
"sessionControls": [
  {
    "id": "review-first",
    "kind": "mode",
    "label": "先审查",
    "description": "先分析项目并提出方案，不执行修改",
    "command": "review-first",
    "profile": {
      "interactionMode": "plan",
      "filesystemPolicy": "read-only",
      "commandPolicy": "disabled",
      "networkPolicy": "disabled",
      "approvalPolicy": "never",
      "approvalReviewer": "none"
    }
  }
]
```

- `id` 是贡献内唯一的不透明标识；宿主和 UI 不根据其文本推导行为。
- `kind` 为 `permission` 或 `mode`，决定菜单分组。权限选项不能修改
  `interactionMode`；模式选项必须声明该字段，可同时声明所需的权限约束。
- `label`、`description` 和声明顺序由插件提供；宿主只按类别分组展示。
- `profile` 是标准执行配置的字段补丁，只能包含交互模式、文件系统、命令、网络、
  审批策略和审核方；不允许修改模型、身份、工作区、插件绑定或执行后端。
- `command` 可选，是选择该选项的宿主命令别名。不声明就不会注入命令；插件自身
  的原生命令继续通过原来的命令协议处理。别名不能重复或覆盖宿主管理命令。

声明不授予执行权限。宿主先按当前安装的执行授权验证补丁，过滤无法落实的选项；
未获原生授权的第三方插件即使声明完整主机访问，也不会得到该权限。Core 代理只
提供其实际支持的工作区工具控制。插件必须能消费自己声明的执行配置，不能把
尚未实现的原生模式当作已有功能发布。

选择时前端向 `update_session_execution_profile` 传入 `sessionId` 和 `controlId`，
不提交拼装后的配置。宿主重新读取绑定插件的可用声明，合并到当前配置，再检查
执行授权、运行状态和工作区信任；成功后关闭空闲运行时，使下次 open 使用新配置。
模型和推理配置等无关字段被保留。禁用插件、未知选项或越权声明都不能通过提交 ID
绕过校验。UI 读取 `executionProfile.sessionControls`，不再使用旧 `accessModes`。

当前内置原生提供者的三项权限选项在其插件清单中声明；Core 代理提供者的只读、
计划和写入模式也在各自清单中声明。新增第三方提供者不需要修改宿主菜单代码。
本版提供的是静态 release 声明，不是对厂商运行时模式的动态发现。

迁移时递增插件版本，并先升级支持此清单字段的宿主。旧插件不声明该字段仍可运行，
但不会获得宿主虚构的权限或模式菜单。
