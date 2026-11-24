# 17 实测：怎样把图片交给 Agent

实测于 2026-11-24：Claude Code 2.1.331，codex-cli 0.169.0。探针和抓取数据在 `17-probes/`（抓取里的 base64 截短了）。测试图片由 `make_png.py` 生成：白底，左边红色圆，右边蓝色方块，200×100。问题里要求不用工具，看不到图片就回 UNKNOWN。图片放在工作区以外（`/tmp/aibo17/data/`，相当于 aibo 的数据目录）。

## Claude Code

探针：`claude_image.py`，抓取：`claude_image.jsonl`，一轮 haiku。

- stream-json 的 user 消息 `content` 写成数组：先放 `{"type":"image","source":{"type":"base64","media_type":"image/png","data":…}}`，再放 `{"type":"text",…}`。
- 没用工具，回答 “red circle, blue square”。
- 不带 `--replay-user-messages` 时，Claude 不回显这条 user 消息，适配器的解析不受影响。

## Codex

探针：`codex_image.py`，抓取：`codex_image.jsonl`，两个 thread 各一轮。

| `turn/start` 的 `input` 条目 | 运行了命令 | 回答 |
|---|---|---|
| `{"type":"localImage","path":"/tmp/aibo17/data/shapes.png"}`（工作区以外） | 没有 | 对 |
| `{"type":"image","url":"data:image/png;base64,…"}` | 没有 | 对 |

- Codex 的 `userMessage` 条目里保留了这两种条目（`item/started`），aibo 读子线程历史时只取 `text`，不受影响。
- `localImage` 由 Codex 进程自己读文件，不受沙箱的工作区限制。

## 对实现的意义

- 两家都能让模型直接看到图片，不需要工具。附件做成快照（存进数据目录），不是路径。
- Claude 用 base64 `image` 块，放在文字前面。Codex 用 `localImage` 加数据目录里的路径，不用把 base64 写进管道。
- Claude 的 API 对单张图片有上限（base64 后 5 MB，边长 8000 像素），过大的图片要先缩小再存。
