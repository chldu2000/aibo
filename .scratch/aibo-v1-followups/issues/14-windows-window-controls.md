# 14 · 会话标题右侧的 Windows 窗口控制胶囊

Status: resolved

Windows 主窗口和独立会话窗口隐藏 MyGO 自带的窗口按钮，在会话标题右侧绘制等高的独立 glass 胶囊。胶囊在没有会话时也可用。三个按钮分别作用于所属窗口，最大化后切换为还原图形和标签，并通过 MyGO 登记最大化按钮区域。

Windows x64 打包后验证了空窗口关闭、主窗口标题拖动、两个窗口各自的最小化、最大化和还原，以及独立窗口关闭后主窗口继续运行。两个窗口的最大化按钮均返回 Windows 的 HTMAXBUTTON 命中结果。未人工检查贴靠布局弹出菜单。

Windows 全量 Go 测试、go vet、staticcheck 和改动文件的 gofmt 检查通过。仓库检查脚本在已有文件的 CRLF 换行检查处停止，未执行 race 测试。
