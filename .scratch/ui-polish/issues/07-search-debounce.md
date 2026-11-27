# 07: 会话搜索不在每帧查库

Status: resolved

**What to build:** 侧栏搜索在用户停止输入后再查，结果缓存到查询变化为止；查询不在界面线程持锁进行。

现状：`searchResults` 在 View 里直接调用 `wb.SearchSessions(query)`（`internal/shell/sidebar.go:206`），每帧一次；`SearchSessions` 持着 `w.mu` 调 `st.SearchMessages` 做全文查询（`internal/workbench/manage.go:225`）。消息多时每帧都会卡，并且持锁期间别的后台事件进不来。

- [x] 外壳记下上次查询的文字和结果；文字变化后约 200ms 没再变才在后台查询，结果用 `Shell.later` 交回主线程
- [x] 查询期间显示上次结果，加一个小的加载指示
- [x] 会话变化（`Subscribe` 的改动）时作废缓存，重新查
- [x] 工作台：`SearchSessions` 把 `st.SearchMessages` 移到锁外（先复制会话列表）；结果数量设上限（如 50），超出时说明“只显示前 50 个”
- [x] 工作台测试：上限生效（并发不阻塞见“没有验证”）
- [x] Tester：输入后先显示正在搜索，停顿后出现结果；改名后结果自动更新；上限提示

## 实现说明

- 工作台 `SearchSessions(text, limit)` 改为返回 `(found, more, err)`：`more` 是超出上限的会话数。`st.SearchMessages` 在锁外执行，只在遍历会话时持锁；截取片段（`around`）只对返回的那些做。
- store 的 `SearchMessages` 用 `GROUP BY session_id` 加 `min(seq)`，每个会话只读回第一条匹配的消息，不再把所有匹配的行读出来再丢弃。SQLite 在用 `min()` 时，裸列取自最小值所在的行。
- 外壳 `sidebar.go`：
  - `search` 记下最后输入的查询和时间、正在查的查询（`asked`）、是否在查（`busy`）、是否过期（`stale`），以及上次结果和它对应的查询（`shown`）。
  - `searchFor` 在查询停顿 200ms（`searchDelay`）后在后台查一次，用 `c.Now()` / `c.After` 计时，测试里用 `tt.Advance` 控制；同一时间只有一个查询，结果用 `Shell.later` 交回主线程。
  - `searchChanged` 在 `apply` 里调用：有会话级改动（`Message == nil`）或消息不再是 `Streaming` 时标为过期，下一帧立即重查；流式增量不触发。
  - 查询期间显示上次的结果，上面加一行“正在搜索…”。超过 50 个（`searchLimit`）时，末尾说明还有多少个没显示。
- 新文字 `searching`、`searchMore`（`count` 为 `int`）。转圈不设 Label，免得和旁边的文字重名。
- 测试：
  - 工作台 `TestSearchLimitAndFirstMatch`：片段取第一条匹配的消息；上限和 `more`；按最近活跃排序。
  - 外壳 `TestSidebarSearch`（新文件 `search_test.go`）：停顿前不出结果、停顿后出；改名后不用重新输入就更新；下一次结果到达前保留上次结果；53 个会话只显示 50 个并说明还有 2 个；没有结果时的提示。`TestSidebarManagement`、`TestTitleBarBand` 改为等结果出现（`waitText`）。

## 没有验证

- `go test -race`：这台 Windows 机器没有 gcc，跑不了。后台 goroutine 只调用工作台的方法，结果通过 `later` 交回主线程；`search` 的字段只在主线程读写。
- 查询期间不阻塞事件处理：没有写测试，只是从代码上看，查库已经移到锁外。
- 大量消息下的实际耗时：没有用真实的大数据目录测。`instr(lower(text), …)` 仍然是全表扫描；如果还慢，下一步考虑 FTS5。
