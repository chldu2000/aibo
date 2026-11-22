# 07 实测：怎样把文件指给 Agent

实测于 2026-11-22：Claude Code 2.1.318，codex-cli 0.169.0。探针和抓取数据在 `07-probes/`。测试文件里写着暗号，问题里要求不用工具，答不出就回 UNKNOWN。

## Claude Code

探针：`claude_at.py`，抓取：`claude_at*.jsonl`，每次一轮 haiku。

| 写法 | 用了工具 | 回答 |
|---|---|---|
| `@secret.txt`（工作区里的相对路径） | 没有 | 对 |
| `@"/tmp/aibo07/other dir/note.txt"`（工作区以外，带空格，没有 `--add-dir`） | 没有 | 对 |
| 同上，带 `--add-dir` | 没有 | 对 |
| `@"my notes.txt"`（带空格的相对路径） | 没有 | 对 |

结论：Claude Code 在 stream-json 输入里认 `@路径`，自己把文件读进来，不需要工具；带空格时加引号。

补充（实现时的契约测试，`TestContractFileMention`）：aibo 最初把提及写在“提到的文件：”后面，`@` 紧跟全角冒号，Claude 没有读到文件（回答说看不到内容）。改成每个提及单独一行后读到了。所以 `@` 前面要有换行（或空格）。

## Codex

探针：`codex_mention.py`，抓取：`codex_mention.jsonl`，两个 thread 各一轮。

- `turn/start` 的 `input` 有 `{"type": "mention", "name", "path"}`。带上它问文件里写了什么（不许运行命令）：回答 UNKNOWN，没有运行命令。只在文字里写路径：同样是 UNKNOWN。
- 所以 `mention` 条目不会把文件内容交给模型（看样子是给技能、应用用的），Codex 只能拿着路径自己用工具读。契约测试里允许它运行命令时，它读了文件并答对。

## 对实现的意义

- 两家都只需要路径：Claude 写成 `@路径`，每个一行；Codex 写一句“需要时请自己读取”加路径列表。
- 工作区以外（源工作区）的文件写绝对路径，两家都能读。
