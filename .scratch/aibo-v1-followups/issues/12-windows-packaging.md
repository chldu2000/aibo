# 12 · Windows x64 打包与启动

Status: resolved

Windows 版使用 `%LOCALAPPDATA%\aibo` 保存数据，用文件锁保护数据目录。Agent 探测读取 Windows 的 PATH，查找原生可执行文件，也能定位 npm 安装的 Codex。探测超时会终止进程树。工作区路径比较和文件引用显示支持 Windows 路径分隔符。

## 验证

- 用 MyGO 生成了 x64 可执行文件和 NSIS 安装程序。解出的可执行文件与独立产物的 SHA-256 一致。
- 在独立 Windows 用户数据目录中启动了安装包内的程序。主窗口出现，数据库创建成功，二次启动交回首个实例，关闭主窗口后进程正常退出。
- Windows 全量 Go 测试、go vet、staticcheck 通过。测试覆盖目录锁竞争与释放、Agent 探测和取消后终止子进程。macOS ARM64 目标交叉编译通过。

## 未验证

Windows race 检查需要 GCC，本机没有配置。未实际运行安装和卸载向导、登录真实 Agent 账号或在 macOS 上启动。
