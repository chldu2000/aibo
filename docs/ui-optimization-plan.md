# UI 优化计划

> 分支：`ui-optimization`。本文档在重构 `base.css`/`shadcn.css`/`material3.css` 之前完成，用于对齐问题诊断与整改范围。重构落地后如引入新的架构约定，需回写 [ui-architecture.md](./ui-architecture.md)。

## 1. 背景

现有 UI 皮肤（shadcn / material3）切换后，整体视觉与 shadcn-svelte、Material Design 3 官方示例相比仍有差距。目标是在**不改动 `.workspace-grid` 三栏布局结构**的前提下，让两套皮肤应用后尽量贴近各自官方示例的质感（形状、层级/阴影、色彩语义），同时保留当前的信息密度（这是产品决策，不在本次范围内）。

## 2. 现状分析

### 2.1 结构性缺口：`UiKitAdapter` 契约范围小于实际可见皮肤化诉求

[contract.ts](../src/lib/ui-kit/contract.ts) 中 `UiKitAdapter` 只包含：

```
PluginView, AgentStatusMark, AlertDialog, Badge, Button, Card, CardContent,
CardFooter, CardHeader, CardTitle, ColumnSplitter, Icon, Input, Label,
ModelMatrix, Separator, Textarea
```

而应用里视觉体量最大、最容易被拿来跟官方示例比较的复合表面——`Composer`（输入区）、`TimelineEntry`（消息气泡）、`Toast`、`SettingsPanel`、`CommandPalette`、`DiagnosticsPanel`、以及 `pi-navigation-dialog`/`pi-tree-dialog`——都不在契约内，物理上位于 `src/lib/components/app/`，不是可替换组件，只能靠 `base.css` / `shadcn.css` / `material3.css` 里的类选择器去"化妆"。这意味着：

- 这些表面永远共享同一套 DOM 结构和间距，皮肤只能改颜色/阴影/圆角，不能改交互结构（例如 shadcn 官方 Dialog 的动画进出、Card 的 padding 节奏）。
- 一旦某个皮肤的 CSS 文件没有覆盖到某个类，该表面就完全退化为 `base.css` 的默认硬编码样式（见 2.2），与皮肤本身脱节。

这是本次能在"保持布局"前提下改善皮肤贴近度的主要杠杆：**扩大皮肤 CSS 对这些结构性表面的覆盖，而不是扩大 `UiKitAdapter` 契约**（契约扩张成本更高，且 `AGENTS.md` 要求新增复合控件必须同时改契约、runtime proxy 和每个已注册皮肤，风险大于收益）。

### 2.2 `base.css` 中的硬编码视觉字面量

[base.css](../src/lib/ui-kit/kits/base.css) 对结构性表面直接写死了阴影、圆角、字号，没有走 token：

- 圆角：composer `border-radius: 18px`([base.css:230](../src/lib/ui-kit/kits/base.css#L230))；沿用大量互不一致的字面量（`8px`/`9px`/`10px`/`12px`）分散在 workspace-tool-panel、workspace-item、agent-card 等选择器里。
- 阴影：`composer-suggestions`([:241](../src/lib/ui-kit/kits/base.css#L241)) `0 12px 28px rgb(0 0 0 / 28%)`，`composer-menu`([:264](../src/lib/ui-kit/kits/base.css#L264))、`settings-panel`([:500](../src/lib/ui-kit/kits/base.css#L500))、`command-palette`([:531](../src/lib/ui-kit/kits/base.css#L531))、`toast`([:549](../src/lib/ui-kit/kits/base.css#L549))、`alert-dialog`([:555](../src/lib/ui-kit/kits/base.css#L555))、`pi-navigation-dialog`([:559](../src/lib/ui-kit/kits/base.css#L559))、`pi-tree-dialog`([:570](../src/lib/ui-kit/kits/base.css#L570)) 都各写了一份不同的 `rgb(0 0 0 / x%)` / `#000000xx` 阴影，且 `.composer` 本身**没有任何阴影**（[:230](../src/lib/ui-kit/kits/base.css#L230)-[232](../src/lib/ui-kit/kits/base.css#L232)），无论切换到哪个皮肤都不会获得层级感。
- 这些字面量是全局共享的（`base.css` 对两个皮肤都生效），所以任何皮肤都无法在不新增 CSS 覆盖规则的情况下改变这些表面的形状语言——material3 通过在 `material3.css` 里逐条覆盖 `.composer.m3-aibo-card` 之类的组合类做到了部分改写（见 2.4），shadcn 则完全没有覆盖（见 2.3）。

### 2.3 `shadcn.css` 覆盖面过窄

[shadcn.css](../src/lib/ui-kit/kits/shadcn.css) 共 190 行，实际覆盖的类选择器只有：`.side-panel-tabs*`、`.git-summary-card`、`.git-section-tabs*`、`.git-review-button`、`.git-change-group*`、`.changeset-file-*`、`.git-history-item`/`copy`、`.window-actions [active]`、`.workspace-item-row`/`.session-item-row.selected`、`.window-system-actions [close]`、`.workspace-splitter*`、focus-visible outline、`.shadcn-agent-status-mark` 动画。

`.composer`、`.timeline-entry`、`.alert-dialog`、`.toast`、`.settings-panel`、`.command-palette`、`.pi-navigation-dialog`、`.pi-tree-dialog` 一行都没有被 shadcn.css 覆盖，全部落回 2.2 中 `base.css` 的硬编码默认值。这是 shadcn 皮肤下"看起来不像官方示例"最主要的原因：真正的 shadcn 组件原语（`card.svelte`、`button-variants.ts`、`input.svelte`、`textarea.svelte`）已经正确消费 `var(--radius)`/`var(--border)`/`var(--background)` 等通用语义 token（已通过 grep 确认），本身没问题；问题在于 composer/timeline/dialog 等复合表面并未使用这些真正的 shadcn 组件去搭建，而是手写 DOM + `base.css` 类选择器，天然绕开了 shadcn 的语义系统。

### 2.4 `material3.css` 覆盖面更全，但 elevation 有遗漏

[material3.css](../src/lib/ui-kit/kits/material3.css) 793 行，比 shadcn.css 覆盖面大得多，`.composer.m3-aibo-card`([:254-277](../src/lib/ui-kit/kits/material3.css#L254-L277)) 有专门覆盖：`border-radius: var(--m3-shape-large)`、`background: var(--m3c-surface-container)`，focus-within 状态有主色描边阴影。但通用规则 `.m3-aibo-card`([:335-341](../src/lib/ui-kit/kits/material3.css#L335-L341)) 显式写了 `box-shadow: none`，且 composer 没有覆盖回去——这与 M3 官方 Filled/Elevated Card 的"有层级"质感不符。

作为对比，`.m3-aibo-alert-dialog`([:710-713](../src/lib/ui-kit/kits/material3.css#L710-L713)) 和 `.toast`([:755-765](../src/lib/ui-kit/kits/material3.css#L755-L765)) 都正确用了 `box-shadow: var(--m3-elevation-2)`。说明 `--m3-elevation-1`/`--m3-elevation-2` 这套 token 本身是可用且被验证过的，只是没有应用到 `.m3-aibo-card`（进而影响 composer）上。这是 material3 皮肤里最小成本、最高收益的一处修复。

### 2.5 密度差异：需要作为决策点而非自动"纠正"

`base.css` 里大量 8-12px 字号（如 `.session-updated` 9px、`.git-history-meta` 8px、`.usage-strip` 10px）明显比官方 shadcn/M3 示例更紧凑。这很可能是有意为之的产品密度选择（应用需要在有限窗口里展示大量会话/工具调用信息），而不是简单的"没做对"。本次优化**不会**批量放大字号去贴近官方示例的宽松间距，只在改动确实必要（比如某个表面因为使用官方组件而自带更大字号）时顺带处理，并在实施时逐项标注给用户确认。

## 3. 整改方案

### 3.1 新增皮肤桥接的 shape / elevation token

延续 `base.css` 现有的 `--aibo-*` 桥接模式（如 `--aibo-border`、`--aibo-surface`），新增：

- `--aibo-radius`（结构性表面圆角，如 composer/dialog/panel）
- `--aibo-radius-sm`（小控件圆角，如 badge/input）
- `--aibo-elevation-1` / `--aibo-elevation-2`（两级阴影，供 composer/menu 用 1 级，dialog/panel/toast 用 2 级）

在 `base.css:root` 里给出 shadcn 风格的默认值（当前硬编码的字面量原样降级为默认值，保证未设置皮肤覆盖时行为不变）；`shadcn.ts`/`material3.ts` 的 `semanticTokens()` 里各自补充这三组 token 的皮肤专属值（shadcn 用其现有 `--radius`/柔和阴影；material3 用 `--m3-shape-large`/`--m3-elevation-1/2`，与已验证的 alert-dialog/toast 保持一致）。

### 3.2 `base.css` 用桥接 token 替换硬编码字面量

把 2.2 列出的每一处 `border-radius: <px>` / `box-shadow: <literal>` 换成 `var(--aibo-radius)` / `var(--aibo-elevation-1|2)`。不改变选择器结构、不改变布局相关属性（grid/flex/宽高），只替换视觉字面量，确保 `.workspace-grid` 三栏结构不受影响。

### 3.3 扩展 `shadcn.css` 覆盖结构性表面

为 `.composer`、`.timeline-entry`、`.alert-dialog`（如需要，覆盖真实 shadcn AlertDialog 已有类之外的细节）、`.toast`、`.settings-panel`、`.command-palette`、`.pi-navigation-dialog`、`.pi-tree-dialog` 补充 shadcn 专属规则，统一使用 `var(--border)`/`var(--card)`/`var(--popover)`/`var(--ring)` 等真正的 shadcn 语义 token（而不是新增的 `--aibo-*` 桥接层），让这些表面在 shadcn 皮肤下的圆角/边框/阴影质感与 `card.svelte`/`alert-dialog.svelte` 保持一致。

### 3.4 修复 `material3.css` 的卡片 elevation

给 `.m3-aibo-card` 增加 `box-shadow: var(--m3-elevation-1)`（而不是 `none`），或者更精确地只给 `.composer.m3-aibo-card` 单独加，避免影响其他已经故意做成"无阴影、靠色块区分层级"的卡片场景（需要逐个检查 `.m3-aibo-card` 的现有使用点，避免引入非预期的阴影）。

### 3.5 回写 `ui-architecture.md`

重构落地后，把新增的 `--aibo-radius`/`--aibo-elevation-1/2` 桥接 token 约定，以及"结构性表面仍非 `UiKitAdapter` 契约、但两套皮肤 CSS 必须对齐覆盖清单"的规则，补充进 [ui-architecture.md](./ui-architecture.md)。

## 4. 实施顺序

1. 本文档评审通过。
2. `base.css`：新增桥接 token 默认值 + 替换硬编码字面量（3.1、3.2）。
3. `shadcn.ts`/`material3.ts`：补充皮肤专属的桥接 token 值。
4. `shadcn.css`：扩展结构性表面覆盖（3.3）。
5. `material3.css`：修复卡片 elevation（3.4）。
6. 手动过一遍两套皮肤下的 composer/timeline/dialog/toast/settings/command-palette，对比官方示例截图，检查是否有遗漏或视觉回退。
7. 回写 `ui-architecture.md`（3.5）。

## 5. 风险与不做的事

- 不改变 `.workspace-grid` 三栏布局的 grid-template-columns 结构。
- 不批量调整字号密度（见 2.5），除非某项改动本身需要。
- 不扩张 `UiKitAdapter` 契约，本次改动全部落在 CSS/token 层。
- material3 的 elevation 修复需要人工核查是否有页面依赖了"无阴影卡片"的现状（例如内嵌在已有阴影容器内的卡片，叠加阴影会显得突兀）。
