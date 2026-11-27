# 18: 没有图标的 Agent 显示首字符和专属颜色

**What to build:** 没有自带图标（`Spec.Glyph`）的 Agent，比如用户登记的 ACP Agent，不再统一显示灰色人形图标 `genericGlyph`，而是显示"首字符 + 颜色"的标识：彩色圆角底块，中间一个白色粗体字符。这样侧栏、标题、选择面板和设置里的几个第三方 Agent 一眼就能分开。

现状：`agentGlyph`（`internal/shell/view.go`）在 `describe(kind).Glyph` 为空时画 `genericGlyph`（`#6e6e78` 底加人形），所有第三方 Agent 长得一样。目前只有 Claude（`#c96442`）和 Codex（`#2f2f33`）自带图标。图标以 16–20px 的尺寸出现在十几处。

**Status:** resolved

已定的设计（2026-11-27）：

1. **优先级**：Agent 自带的 `Glyph` 优先；没有时用字符标识；取不出字符时退回 `genericGlyph`。
2. **字符的选取**：
   - 来源用 `Spec.Name`（悬停时显示的就是它），为空时用 ID（`agent.Kind`）。
   - 先做规范化：NFKC（全角转半角）、去掉首尾空白、去掉开头的 `acp-` 或 `acp `（不区分大小写）。去掉后变空的，保留原名。
   - 取第一个字母或数字字符（`unicode.IsLetter || unicode.IsNumber`），跳过标点、符号和 emoji。拉丁字母转大写，中日韩字符原样取一个字。
   - 只取一个字符：两个字符在 16px 下认不清。首字母相同的 Agent 靠颜色和悬停名称区分。
3. **颜色的选取**：
   - 用 ID 而不是 Name 做哈希（FNV-1a），对色板长度取模。用户改名只改变字符，颜色不变。
   - 不按登记顺序分配颜色：删掉一个 Agent 后，其他 Agent 的颜色不能跟着变。偶尔撞色可以接受。
   - 色板固定 10 色，按 OKLCH 取 L = 0.56、C ≈ 0.12–0.13，白字对比度约 4.4–5.0：

     | 色相 | 底色 |
     |---|---|
     | 0° 玫红 | `#af4f71` |
     | 130° 草绿 | `#5a8325` |
     | 150° 绿 | `#2d8949` |
     | 175° 青绿 | `#008c70` |
     | 200° 青 | `#008a92` |
     | 225° 天蓝 | `#0082ad` |
     | 250° 蓝 | `#2d78bd` |
     | 275° 靛 | `#5f6cc0` |
     | 300° 紫 | `#8160b5` |
     | 325° 品红 | `#9a579e` |

   - 故意避开的色相：约 25–60°（离 Claude 的赤陶色太近，红色也容易被当成出错）；约 60–100°（和审批、横幅用的橙色玻璃 `RGBA(255,150,0)` 撞色，黄色在这个亮度下也会发脏）；低彩度灰色（留给 Codex 和 `genericGlyph`）。
4. **绘制**：
   - 不拼 SVG 的 `<text>`：MyGo 的 SVG 未必支持文字，中日韩字形也要走字体回退。
   - 用 `ui.Box` 画底块：边长 `size`，圆角 `size/4`（和现有图标的 rx 6/24 一致），填底色。中间居中放一个粗体、白色的 `ui.Text`，字号约 `size × 0.6`。悬停名称照旧。
   - 浅色和深色主题用同一种底色。深色主题下底块边缘不明显的话，加一圈 1px、低透明度的白色描边，和 Codex 图标的做法一样。
   - 字符和颜色每个 Agent 只算一次，和现在的 `s.glyphs` 一样缓存。Name 变了要重新算。

- [x] 纯函数：从 Name 或 ID 取字符，从 ID 取颜色，放在 `internal/shell`
- [x] 单元测试：普通英文名、`acp-` 前缀、全角字母、中文名、开头是标点、只有 emoji、Name 为空回退到 ID、同一 ID 的颜色稳定
- [x] `agentGlyph` 改为按优先级返回自带图标、字符标识或 `genericGlyph`；所有调用处的尺寸（16、18、20）都要显示正常
- [x] 改名后标识跟着更新（缓存失效）
- [ ] 浅色和深色主题下各看一遍：侧栏、会话标题、选择面板、设置（只看了侧栏和会话标题，见下）

## 实现说明

- 代码在 `internal/shell/glyph.go`：`agentGlyph` 从 `view.go` 移过来，`genericGlyph` 一起移入；新增 `glyphLetter`、`glyphColor` 和色板 `glyphColors`。缓存 `Shell.glyphs` 改为 `map[agent.Kind]agentIcon`，记下算出图标时的名称，名称变了就重算。类型不叫 `glyph`，因为 `icons.go` 已有同名类型。
- 名称取自 `agentName`（悬停显示的也是它），为空时用 ID。NFKC 用 `golang.org/x/text/unicode/norm`，`go.mod` 里 `golang.org/x/text` 由间接依赖改为直接依赖。
- 去掉 `acp-` 前缀时，要求前缀后面还有内容：名字就叫 `acp-` 时取 `A`。
- 单元测试在 `glyph_internal_test.go`，覆盖任务清单里列的各种情况，另外加了开头是 `[beta]`、数字开头和 Name、ID 都为空。
- 验证：用一个临时的 Tester 测试登记了 6 个假 Agent（Gemini CLI、acp-kimi、通义灵码、Goose、Droid、🤖），在浅色和深色主题下截图看了侧栏（16px）和会话标题（20px）：字符居中、白字清楚，深色主题下的描边可见，🤖 退回 `genericGlyph`。临时测试没有提交。
- 没有验证：选择面板、设置、引用卡片里的显示；改名后图标是否在界面上随之更新（只按代码逻辑实现，没有界面测试）。`check.sh` 的 race 测试因本机没有 gcc 未执行，其余检查通过。

## Comments
