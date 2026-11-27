# 07: 会话搜索不在每帧查库

Status: ready-for-agent

**What to build:** 侧栏搜索在用户停止输入后再查，结果缓存到查询变化为止；查询不在界面线程持锁进行。

现状：`searchResults` 在 View 里直接调用 `wb.SearchSessions(query)`（`internal/shell/sidebar.go:206`），每帧一次；`SearchSessions` 持着 `w.mu` 调 `st.SearchMessages` 做全文查询（`internal/workbench/manage.go:225`）。消息多时每帧都会卡，并且持锁期间别的后台事件进不来。

- [ ] 外壳记下上次查询的文字和结果；文字变化后约 200ms 没再变才在后台查询，结果用 `Shell.later` 交回主线程
- [ ] 查询期间显示上次结果，加一个小的加载指示
- [ ] 会话变化（`Subscribe` 的改动）时作废缓存，重新查
- [ ] 工作台：`SearchSessions` 把 `st.SearchMessages` 移到锁外（先复制会话列表）；结果数量设上限（如 50），超出时说明“只显示前 50 个”
- [ ] 工作台测试：并发调用不阻塞事件处理；上限生效
- [ ] Tester：输入后结果出现；连续输入只查一次（可用计数的假 store 或直接测外壳状态）
