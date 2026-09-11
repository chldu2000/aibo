# 安装语义页面写入：首轮原生验收

运行命令：`node probes/semantic-write-native.mjs`。

环境：macOS，隔离 Tauri 应用标识及临时工作区，Vite HMR/watch 与 Tauri watch 均关闭。原生按钮辅助程序限定到隔离应用 PID。外层 runner 退出码为 0；结束隔离应用时内部 pnpm 输出的 ELIFECYCLE 属于清理过程。

[机器可读结果](./semantic-write-native.json)验证：

- shadcn 与 material3 分别挂载实际 InstalledWorkbench。
- 已安装的 1.1 语义贡献显示写入按钮，点击调用宿主语义写入口。
- 每套皮肤一次原生批准；连续两次点击仅提交一次请求。
- 写入完成后只读刷新，文本框显示实际文件内容。
- 两条 `semantic.write` 记录均为 completed。
- 外部 runner 检查文件恰好为 `semantic-write\nsemantic-write\n`。

此探针不证明应用重启恢复、批准后页面关闭、取消或未知结果；这些场景仍须独立验收。首次探针把 textarea 的内容误当作页面 textContent，断言失败；修正为检查 textarea.value 后完整重跑通过。
