# 文件浏览与 Git 差异有哪些可复用的数据来源

Type: research
Label: wayfinder:research
Status: resolved
Assignee: workspace

## Question

核实锁定版 MyGO 的目录树、只读预览、差异显示与文件变更通知，以及 aibo 的工作区文件枚举如何适用。Git 怎样分别取得分支、已暂存、未暂存、未跟踪和重命名信息，并为选中的变化给出正确的新旧内容？列出非仓库、特殊路径和无法预览的内容应由哪一层识别。

## Answer

MyGO 可承载树、只读文本和差异展示。aibo 的文件提及枚举有结果上限，会省略空目录，浏览器需要独立的目录读取语义。Git 的同一路径可以同时有两个可选差异：暂存项比较 HEAD 与索引，未暂存项比较索引与工作树。普通目录仍可浏览。文件监听可触发复查，纯暂存或分支变化还需要重新查询 Git。大仓库性能与真机刷新时序有待验证。

[工作区文件与 Git 差异的来源](../research/workspace.md) · 本地研究提交 `research/sidebar-workspace@b8feb38`
