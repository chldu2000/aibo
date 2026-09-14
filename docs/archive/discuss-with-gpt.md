## 第一轮

### Me

如果软件的外观（布局、组件等）由主题插件决定，具体能力（比如具有哪些界面）由其他插件决定，如何保证能力插件引入的新界面外观符合主题要求

### GPT

核心原则是：**能力插件不能直接决定“怎么画”，只能决定“画什么”；真正的渲染权必须掌握在主题系统手里。**

如果能力插件可以自己随意写 HTML/CSS、Flutter Widget、Qt 控件、React 组件，那么你实际上就**无法保证**它一定符合主题。最多只能靠规范约束。要做到架构层面的保证，需要在插件接口上限制它的 UI 表达能力。

比较稳妥的设计是把系统拆成三层：

```text
能力插件
   ↓
UI 描述 / 语义组件
   ↓
主题提供的组件实现
   ↓
最终界面
```

例如能力插件想增加一个“下载管理”页面，它不要这样写：

```tsx
// 能力插件自己控制外观
<div style={{ background: "#fff", padding: 16 }}>
  <button className="blue-button">暂停</button>
</div>
```

而是声明：

```ts
registerPage({
  id: "downloads",
  title: "下载",
  content: {
    type: "List",
    items: [
      {
        type: "DownloadItem",
        title: file.name,
        progress: 0.7,
        actions: [
          { type: "Action", id: "pause", label: "暂停" }
        ]
      }
    ]
  }
})
```

然后当前主题把这些语义节点解释成自己的视觉组件：

```text
List
DownloadItem
Action
Progress
Navigation
Dialog
Toolbar
...
```

主题 A 可以把 `Action` 渲染成圆角按钮，主题 B 可以渲染成扁平按钮，主题 C 甚至可以把下载项目做成卡片。能力插件完全不需要知道。

这其实类似 **UI ABI / UI Contract**。

可以把插件接口设计成几个层级。

### 1. Design Token 只能作为基础，不能作为唯一保障

主题至少应该暴露一组 token：

```ts
theme.colors.primary
theme.colors.surface
theme.spacing.sm
theme.spacing.md
theme.radius.control
theme.typography.body
theme.typography.title
```

能力插件如果必须画一些东西，只允许使用：

```css
color: var(--text-primary);
padding: var(--spacing-md);
border-radius: var(--radius-control);
```

而禁止：

```css
color: #333;
padding: 13px;
font-family: Arial;
```

但需要注意，**Design Token 只能保证颜色、字号、间距等基础一致性，不能保证组件形态一致性**。

例如一个插件自己实现：

```text
[ 删除 ]
```

另一个实现：

```text
⋮
  删除
```

两者都使用正确 token，但 UX 还是可能完全不一致。

所以真正关键的是下一层。

### 2. 主题提供 Component Registry

宿主定义一套标准语义组件：

```ts
interface ThemeComponents {
  Button
  TextField
  Select
  Table
  List
  Tree
  Dialog
  Drawer
  Tabs
  Toolbar
  Page
  SettingsPage
  DetailPage
  EmptyState
  ContextMenu
}
```

主题插件实现它们：

```ts
registerTheme({
  components: {
    Button: MyButton,
    Dialog: MyDialog,
    Table: MyTable,
    Page: MyPage,
  }
})
```

能力插件则只能获取：

```ts
const { Button, Dialog, Table } = ui;
```

而不能 import 某个具体视觉库。

也就是：

```text
错误：

Capability Plugin
      ↓
Material UI / Ant Design / Bootstrap


正确：

Capability Plugin
      ↓
Host UI API
      ↓
Current Theme
      ↓
实际控件
```

这样一来，换主题后，能力插件添加的新页面自然跟着变化。

### 3. 页面本身最好也由主题控制

更进一步，不要让能力插件直接构建完整页面。

比如定义：

```ts
registerPage({
  type: "settings",
  id: "git",
  sections: [
    {
      title: "Repository",
      fields: [
        {
          type: "text",
          key: "remote",
          label: "Remote URL"
        },
        {
          type: "switch",
          key: "autoFetch",
          label: "Auto fetch"
        }
      ]
    }
  ]
})
```

主题决定：

```text
SettingsPage 怎么布局
Section 是否有 Card
字段是左右布局还是上下布局
Switch 长什么样
标题层级是什么
移动端怎么折叠
```

这比让能力插件写：

```tsx
<Page>
  <Card>
    ...
  </Card>
</Page>
```

控制力更强。

可以理解成：

```text
能力插件：

“这是一个设置页，
 有一个 URL 字段，
 有一个 boolean 字段。”

主题：

“设置页应该长这样。”
```

这通常是保证视觉一致性的最佳方法。

---

不过现实里会遇到一个问题：

> 某些插件会需要主题系统没有预料到的新组件。

比如 Git 插件可能需要：

```text
Commit Graph
Diff Viewer
Branch Graph
```

数据库插件可能需要：

```text
Schema Diagram
Query Plan
```

这时候不能要求主题提前实现所有东西。

比较好的解决方案是把 UI 分成两个等级。

```text
Level 1：标准 UI
100% 由主题控制

Button
Input
Dialog
Page
List
Table
Navigation
...

Level 2：插件自定义 UI
插件实现结构，主题提供视觉原语
```

比如 Git Graph：

```tsx
function GitGraph() {
  return (
    <Surface>
      <Stack gap="md">
        <Text variant="title">Branches</Text>
        <GraphCanvas
          colors={{
            foreground: token("foreground"),
            accent: token("accent"),
            muted: token("muted")
          }}
        />
      </Stack>
    </Surface>
  )
}
```

也就是说，自定义组件可以存在，但是它必须建立在主题提供的：

```text
Surface
Text
Stack
Divider
Icon
Menu
Tooltip
Token
```

之上。

类似浏览器：

```text
HTML 控件 → 浏览器控制

Canvas → 应用自己控制
```

对于 Canvas 那一块，主题只能提供 token，而不能完全控制。

所以你的系统可以明确区分：

```ts
ui.standard.*
ui.primitives.*
ui.tokens.*
ui.customSurface()
```

### 4. 再加一个“主题能力协商”机制

插件可能需要：

```text
DataGrid
CodeEditor
Tree
Graph
Timeline
```

而某个主题可能没有实现。

因此最好有 capability negotiation：

```ts
theme.capabilities = {
  dataGrid: true,
  tree: true,
  codeEditor: false,
  timeline: false
}
```

能力插件：

```ts
if (ui.supports("timeline")) {
  renderTimeline(...)
} else {
  renderList(...)
}
```

或者宿主提供默认 fallback：

```text
能力插件
   ↓
请求 Timeline
   ↓
当前主题有没有？
   ├─ 有 → Theme Timeline
   └─ 没有 → Host Default Timeline
```

这样主题不需要实现所有高级控件。

---

### 5. 不建议让能力插件直接依赖主题插件

例如：

```text
GitPlugin → DarkThemePlugin
GitPlugin → MinimalThemePlugin
```

这是很危险的。

很快就会变成：

```text
Git × 10 个主题
Database × 10 个主题
AI × 10 个主题
...
```

组合爆炸。

应该始终是：

```text
                 UI Contract
                /           \
        Capability          Theme
          Plugin            Plugin
```

两边都只依赖宿主定义的协议，而不互相依赖。

---

如果需要更强的“保证”，还可以从插件 SDK 层面直接禁止一些能力，例如禁止能力插件：

```text
直接设置颜色
直接设置字体
直接设置阴影
直接设置圆角
直接创建顶级窗口
直接操作导航栏
直接注入 CSS
```

只开放：

```ts
ui.createPage()
ui.createDialog()
ui.createMenu()
ui.createForm()
ui.createList()
ui.createCustomView()
```

其中 `createCustomView()` 被明确视为 escape hatch。

这样就形成了一个很清楚的规则：

```text
标准界面
   ↓
主题 100% 控制

特殊界面
   ↓
插件控制结构
   +
主题控制 token / primitives
```

这和浏览器、IDE、操作系统扩展模型其实很类似。

如果让我设计这种插件架构，我会把接口大致定成：

```text
                 Host
                  │
       ┌──────────┴──────────┐
       │                     │
   Capability API         Theme API
       │                     │
       │                ┌────┴────┐
       │                │ Tokens  │
       │                │ Widgets │
       │                │ Layouts │
       │                │ Icons   │
       │                └────┬────┘
       │                     │
       └────── UI Schema ────┘
                  │
              Renderer
                  │
              Final UI
```

其中最关键的不是 `Theme API`，而是中间这个 **UI Schema / Semantic UI**。它让“功能”和“表现”真正解耦。

一句话概括：

> **不要要求能力插件“遵守主题”，而是让能力插件根本没有绕过主题的机会。**

如果是你正在设计一套实际插件系统，我会进一步建议把 API 分为 **导航扩展、页面 Schema、标准组件、主题原语、自定义渲染面、主题能力协商** 六部分。这样既能保证一致性，又不会把复杂插件限制死。


## 第二轮

### Me:

```
核心做法：**能力插件不“画界面”，只向主题提交语义；主题负责怎么画。** 外观由主题独占，能力只声明“这里要一块什么东西”。

## 1. 把界面拆成两层合同

| 层 | 谁拥有 | 内容 |
|---|---|---|
| **主题合同** | 主题插件 + 宿主 | 布局骨架、插槽、组件原语、设计 token |
| **能力合同** | 能力插件 | 命令、数据、业务视图模型（表单字段、列表列、操作 id） |

能力插件依赖的是 **稳定的 UI API**（类型、插槽名、组件 props），不是某一套 CSS 或 DOM。换主题只换实现，能力代码不动。

## 2. 三种递进约束（建议同时用）

**插槽贡献（优先）**  
主题定义具名插槽：`sidebar.item`、`toolbar.action`、`settings.page`、`inspector.panel`、`modal.*`。能力只注册描述符（id、标题、图标、权限、要挂的 view id），**不写布局**。侧栏怎么排、按钮圆不圆角，全是主题的事。VS Code / Eclipse 的 contribution point 就是这条路。

**只允许组合主题原语**  
能力若必须自己拼一块区域，只能用主题导出的组件：`Button`、`Panel`、`Field`、`Dialog`、`Tabs`。颜色、间距、字号一律走 token（`--color-surface`、`--space-2`），禁止写死 hex、禁止自带样式表。图标用 `currentColor` 的 SVG。

**语义视图，而不是控件树**  
更严的做法：能力提交 JSON/DSL，例如 `{ type: "form", fields: [...] }`、`{ type: "list", columns: [...] }`。主题内有对应 renderer。能力甚至不 import 组件，只声明结构。新界面天然跟主题走。

## 3. 新控件不要让能力私自发明

能力需要“主题里没有的控件”时：

1. 先抽 **无外观行为**（状态机、校验、快捷键）放在能力里。  
2. 向主题合同提 **新原语**（版本化：`theme-api@1.3` 增加 `SegmentedControl`）。  
3. 各主题实现该原语后，所有能力复用。

不要让每个能力自己画一套“高级选择器”，那是外观分裂的根源。

## 4. 必须自定义时的逃生口

复杂可视化（画布、图表）很难完全语义化。约定：

- 画在隔离容器里（iframe / Shadow DOM）。  
- 宿主把 **当前主题 token** 注入进去。  
- 容器外的 chrome（标题栏、关闭、滚动、边距）仍用主题组件。  
- 自定义区域禁止改全局布局、禁止覆盖宿主 CSS。

这样“能力可以很花”，但边框和系统仍像同一套产品。

## 5. 用工具把合同钉死

只靠文档不够，需要强制：

- **类型**：能力只能 `import { Button } from '@host/ui'`，`@host/ui` 在运行时绑定到当前主题实现。  
- **静态检查**：禁止独立 `.css`、禁止字面量颜色、禁止未登记插槽。  
- **运行时**：未知插槽拒绝注册；自定义视图必须声明 `usesTokens: true`。  
- **视觉回归**：同一能力在 A/B 两套主题下截图，chrome 应对齐主题，而不是对齐能力作者的审美。

## 6. 一条可执行的产品规则

> 能力可以增加 **做什么**；只有主题可以增加 **看起来像什么**。  
> 能力引入的任何可见物，要么是已有插槽里的贡献，要么是主题原语的组合，要么是注入了 token 的隔离画布。

按这个规则，主题换肤时能力界面跟着变；能力上新功能时，不会各自长出一套皮肤。若你准备落进具体宿主（例如扩展点清单或 `@host/ui` 包边界），可以再说一下目标形态，我可以按那套结构写成合同草案。
```

这个建议怎么样

### GPT：

```
这个建议整体上是**很好的，而且比“只靠 Design Token 保持一致”更完整**。它已经抓住了这类插件架构真正的核心：**主题拥有视觉决策权，能力插件拥有业务语义权**。

如果把它作为实际架构方案，我大概会给 **8.5/10**。主要问题不是方向错误，而是有几个地方如果照字面执行，会让插件系统过于僵硬。

我尤其赞同这几部分。

首先，“**能力插件不画界面，只提交语义**”是最关键的原则。尤其是这句话：

> 能力可以增加做什么；只有主题可以增加看起来像什么。

非常适合作为整个插件系统的设计原则。它比“插件要遵循主题规范”强很多，因为后者靠自觉，前者可以通过 API 结构强制保证。

其次，它把 UI 扩展分成：

```text
插槽贡献
    ↓
主题组件组合
    ↓
语义 DSL
    ↓
自定义区域 escape hatch
```

这个层次也是合理的。实际上我会把它稍微重新排序成一个“自由度阶梯”：

```text
约束最强                                   自由度最高

Contribution
    ↓
Semantic UI Schema
    ↓
Theme Components
    ↓
Theme Primitives
    ↓
Custom Surface
```

能力插件应该尽量待在左边，只有真的表达不了时才向右走。

例如：

```text
增加菜单项
→ contribution

增加设置页面
→ semantic schema

增加普通业务页面
→ theme components

增加特殊 Git commit graph
→ primitives / custom surface
```

这样 API 的使用边界会非常清楚。

不过，我会修改原建议里的几个地方。

### 1. “新控件必须加入 Theme API”不能执行得太严格

原建议说：

> 能力需要主题里没有的控件时，向主题合同提新原语，各主题实现以后所有能力复用。

思想是对的，但如果真的要求**所有主题先实现新控件，插件才能使用**，生态会很难发展。

假设存在：

```text
Theme A
Theme B
Theme C
Theme D
Theme E
```

然后数据库插件提出：

```text
DataGrid
```

Git 插件提出：

```text
CommitGraph
```

AI 插件提出：

```text
ConversationTree
```

如果每加一个组件都要求：

```text
5 个主题 × 新组件
```

主题作者负担会越来越大。

我更推荐 **Core + Optional Capability + Fallback**：

```ts
interface Theme {
  core: {
    Button
    Input
    List
    Dialog
    Menu
    Tabs
    ...
  }

  optional: {
    DataGrid?: ...
    Tree?: ...
    Timeline?: ...
  }
}
```

宿主提供默认实现：

```text
Plugin requests DataGrid

        ↓

Theme implements DataGrid?
      /       \
    yes       no
     ↓         ↓
 Theme impl   Host fallback
```

于是主题作者只必须实现少量 Core UI。

这个差别非常重要。

---

### 2. 不建议把“禁止 CSS”作为绝对规则

原建议：

> 禁止独立 `.css`

对于普通 UI 很合理，但作为 SDK 的绝对规则可能太激进。

例如代码编辑器、Markdown renderer、graph viewer、terminal、canvas overlay 等，很难完全不写样式。

更合理的是：

```text
Host Chrome
    → 禁止插件 CSS

Standard UI
    → 基本禁止插件 CSS

Custom View
    → 可以有 scoped CSS
    → 不能污染宿主
    → 必须消费 theme tokens
```

例如：

```css
.commit-node {
    color: var(--host-text-primary);
    background: var(--host-surface);
    border-radius: var(--host-radius-sm);
}
```

真正应该禁止的是：

```css
body {}
.sidebar {}
button {}
:root {}
```

也就是**跨边界污染**，而不是 CSS 本身。

---

### 3. Shadow DOM 和 iframe 应该区分使用场景

建议中写：

> 复杂可视化放 iframe / Shadow DOM。

这两个其实不是一个级别的机制。

我会定义成：

```text
普通能力插件
    ↓
Shadow DOM / scoped style
    ↓
解决样式隔离

不可信第三方 UI
    ↓
iframe / WebView / 独立进程
    ↓
解决安全 + 资源 + DOM 隔离
```

iframe 隔离很强，但代价也很明显：

* accessibility 更难统一
* keyboard navigation 更复杂
* focus 管理麻烦
* tooltip / dialog 跨边界麻烦
* drag & drop 麻烦
* IPC 成本增加

所以不要因为“主题隔离”就默认 iframe。

---

### 4. “语义 UI DSL”不要发展成自己造一个 HTML

这是这个架构最容易掉进去的坑。

一开始：

```json
{
  "type": "form"
}
```

很好。

后来需求越来越多：

```json
{
  "type": "container",
  "direction": "horizontal",
  "align": "center",
  "padding": 12,
  "children": [...]
}
```

再后来：

```json
{
  "type": "conditional",
  "expression": "...",
  "style": "...",
  "events": [...]
}
```

最后你会发现：

> 自己重新发明了一套 React / HTML / Flutter。

所以 Semantic UI 应该保持**高层语义**：

```ts
SettingsPage
PropertyList
CommandPalette
DetailView
CollectionView
Inspector
Wizard
EmptyState
```

而不是：

```ts
Box
Row
Column
Padding
Margin
AbsolutePosition
```

后者应该属于主题 primitive/component 层。

换句话说：

```text
Schema 描述业务结构
Component 描述 UI 结构
Theme 描述视觉结构
```

这三者不要混在一起。

---

### 5. 我会再增加一个重要概念：Host-owned Chrome

原建议其实已经隐含提到了，但值得正式成为架构规则。

任何插件页面最好拆成：

```text
┌─────────────────────────────────────┐
│ Host-owned Page Chrome              │
│ title / breadcrumb / toolbar / menu │
├─────────────────────────────────────┤
│                                     │
│       Plugin Content Area           │
│                                     │
└─────────────────────────────────────┘
```

能力插件可以说：

```ts
registerPage({
  id: "downloads",
  title: "Downloads",
  icon: "download",
  actions: [...]
})
```

但是：

```text
标题放哪里
返回按钮在哪里
toolbar 高度
菜单位置
页面 padding
滚动行为
响应式行为
```

全部由 Host/Theme 控制。

这是保证第三方页面“看起来还是这个软件”的一个非常有效的办法。

即使中间的插件内容非常特殊，外围体验仍然统一。

---

### 6. 还缺一个我认为很重要的维度：行为一致性

主题一致不只是：

```text
颜色
圆角
间距
字体
```

还有：

```text
Hover
Focus
Disabled
Loading
Error
Selection
Drag
Keyboard navigation
Context menu
Animation
Accessibility
```

例如能力插件自己实现 Button，即使颜色完全使用 token：

```text
颜色 ✔
字号 ✔
圆角 ✔
```

但如果：

```text
Space 不触发
Enter 行为不同
Tab focus 不一致
Disabled 样式不同
Loading 行为不同
```

用户依然会觉得它“不像这个软件”。

所以 Theme Component 最好实际上不是单纯的：

```text
Visual Component
```

而是：

```text
Interaction + Accessibility + Appearance
```

也就是说主题 API 更准确的名称可能甚至不是：

```text
Theme API
```

而是：

```text
UI Platform API
```

主题只是其中视觉实现的一部分。

---

如果让我最终整理这套架构，我会做成这样的分层：

```text
                    Capability Plugin
                           │
             ┌─────────────┴─────────────┐
             │                           │
      Contribution API             View API
             │                           │
     menu / command /           semantic schemas
     toolbar / route             + components
             │                           │
             └─────────────┬─────────────┘
                           │
                     UI Platform
                           │
          ┌────────────────┼────────────────┐
          │                │                │
       Behavior        Components       Primitives
          │                │                │
   focus / keyboard    dialog/list      text/stack
   a11y / states       form/table       surface/icon
          │                │                │
          └────────────────┼────────────────┘
                           │
                       Theme API
                           │
             tokens / variants / metrics
                           │
                    Current Theme
```

然后另外留一条旁路：

```text
Capability
    │
    └── Custom Surface
            │
            ├── isolated styles
            ├── injected tokens
            ├── host-owned container
            └── restricted host access
```

这样我认为就比较完整了。

所以你贴的方案**方向完全值得采用**，尤其适合插件数量较多、允许第三方开发主题和能力的系统。但我会把它从“主题控制一切 UI”进一步修正为：

> **宿主定义 UI 语义与交互合同，主题定义这些合同的视觉实现，能力插件只向合同贡献业务语义。**

这个表述比单纯“能力 → 主题”更稳，因为主题本身也不应该控制所有事情——**交互语义、可访问性、扩展点、生命周期等应该属于宿主，而不是主题。**

这也是我认为这套设计从“主题系统”真正升级成“插件 UI 平台”的关键一步。

## 第三轮

### Me:

这样定义的话，是不是UI主题采用什么框架也不再重要了🤔

### GPT:

基本可以这么理解：**只要“能力插件 → UI”之间隔着稳定的语义协议，UI 主题采用什么框架，对能力插件就不再重要了。**

但要加一个限定：

> **框架变得“不重要”，是对能力插件而言；对宿主和主题实现本身，框架仍然很重要。**

例如如果能力插件只提交：

```ts
registerView({
  type: "settings",
  fields: [
    { type: "text", key: "url", label: "URL" },
    { type: "boolean", key: "enabled", label: "启用" }
  ]
})
```

那么当前主题完全可以是：

```text
Theme A → React
Theme B → Vue
Theme C → Solid
Theme D → 原生 Web Components
```

能力插件根本不知道，也不需要知道。

它看到的世界只是：

```text
Capability Plugin
        │
        │ UI Schema / Contribution
        ▼
      Host
        │
        ▼
   Theme Renderer
        │
   ┌────┼─────┐
 React  Vue  Web Components ...
```

这种情况下，框架确实已经变成了**主题插件的内部实现细节**。

不过这里有一个非常关键的分界。

如果你的能力插件允许写：

```tsx
import { Button, Panel } from "@host/ui";

export function MyPage() {
  return (
    <Panel>
      <Button>Run</Button>
    </Panel>
  );
}
```

那就**没有完全框架无关**。

因为这个能力插件显然还是 JSX/React 风格，意味着至少共享了：

```text
组件模型
生命周期模型
渲染模型
事件模型
```

哪怕 `Button` 的具体外观由主题控制，能力插件仍然与 React 类框架耦合。

所以可以把解耦程度分成三档。

### 第一档：共享框架，只换组件实现

```text
能力插件：React
主题：React
宿主：React
```

能力插件：

```tsx
<Button />
```

主题负责提供实际 `Button`。

这是最容易实现的。

优点是开发体验很好，类型提示强，而且能力插件可以自由组合复杂 UI。缺点是**框架锁定明显**。

---

### 第二档：框架无关的 UI Schema

能力插件：

```ts
{
  type: "form",
  fields: [...]
}
```

主题：

```text
React Renderer
Vue Renderer
Native Renderer
...
```

这是你现在讨论的架构真正厉害的地方。

能力插件甚至不需要 UI framework。

它可能只是普通 TypeScript：

```ts
export const view: SettingsView = {
  fields: [...]
};
```

那么：

```text
能力插件
  ≠ React plugin
  ≠ Vue plugin

能力插件
  = application capability plugin
```

这个解耦层次就很高了。

---

### 第三档：连平台都可以换

如果协议设计得更彻底：

```json
{
  "kind": "collection",
  "columns": [...],
  "actions": [...]
}
```

理论上同一个 capability 甚至可以被：

```text
Desktop Theme → React
Web Theme     → Vue
Mobile Theme  → Flutter
CLI Theme     → Terminal UI
```

解释。

例如能力说：

```text
有一个操作：
id = git.commit
label = Commit
requiresSelection = true
```

Web 主题可能画成按钮：

```text
[ Commit ]
```

移动主题可能放进：

```text
⋮ → Commit
```

CLI 可能变成：

```text
[c] Commit
```

能力本身完全不用变。

到这个程度，其实已经不应该把它叫简单的“UI 插件协议”了，更接近：

> **Presentation-independent Application Model**

即业务能力只描述：

```text
有什么
能做什么
状态是什么
```

至于：

```text
显示在哪里
长什么样
怎么布局
```

全部交给 presentation layer。

这很强。

---

不过我会提醒一个很现实的问题：**越追求框架无关，UI 协议就越容易变成新的“框架”。**

比如一开始只有：

```ts
Form
List
Action
```

后来你需要：

```ts
Conditional
Repeater
AsyncState
VirtualList
DragDrop
Popover
Tree
SplitView
StateBinding
EventBinding
Validation
```

最后得到：

```text
你没有依赖 React……

但你自己发明了 React 2。
```

所以我反而建议 UI Schema **故意保持“不够强”**。

只解决大约 70–90% 的普通界面：

```text
Settings
List
Details
Inspector
Wizard
Toolbar
Menu
Command
Form
Table
```

复杂 UI：

```text
Editor
Canvas
Graph
Terminal
Timeline
Rich visualization
```

走 Custom Surface。

于是架构会比较健康：

```text
                   Capability
                       │
          ┌────────────┴────────────┐
          │                         │
     Semantic UI              Custom Surface
      80% UI                     20% UI
          │                         │
          ▼                         ▼
    Theme Renderer             isolated runtime
          │                    + theme tokens
          ▼
      Any Framework
```

还有一个容易忽视的问题：如果真的允许**每个主题使用完全不同的框架**，宿主插件加载机制也必须相应设计。

比如 React 主题和 Vue 主题不应该直接往同一个 DOM tree 里互相 mount：

```text
Host React tree
   └── Vue component
```

这样生命周期、context、事件、portal、error boundary 都会越来越麻烦。

比较干净的做法是：

```text
Host Core
   │
   ├── Theme Renderer Adapter
   │
   └── Semantic View Model
```

主题只需要实现一个框架无关接口，例如：

```ts
interface ThemeRenderer {
  mount(
    container: HTMLElement,
    view: ViewModel,
    context: UIContext
  ): MountedView;

  update(
    mounted: MountedView,
    view: ViewModel
  ): void;

  unmount(
    mounted: MountedView
  ): void;
}
```

至于内部：

```ts
class ReactThemeRenderer implements ThemeRenderer {}
class VueThemeRenderer implements ThemeRenderer {}
```

宿主根本不关心。

所以如果你现在这套设计继续往下推，我认为一个非常漂亮的边界是：

```text
能力插件 ABI
    ↓
纯数据 / Command / ViewModel
    ↓
────────────────────────
这里以上完全框架无关
────────────────────────
    ↓
Theme Renderer ABI
    ↓
React / Vue / Svelte / ...
```

这样以后你甚至可以规定：

> **Capability SDK 中根本不出现 React、Vue、DOM 等类型。**

例如公共 API 只出现：

```ts
ViewId
CommandId
Action
Field
Collection
Selection
DataSource
ViewModel
Contribution
```

而不出现：

```ts
ReactNode
VNode
HTMLElement
CSSProperties
JSX.Element
```

只要把这条边界守住，**UI 框架基本就真的成为可替换实现细节了。**

而且我觉得这对你这个插件模型还有一个更大的好处：以后可能不只是“换主题”，甚至可以做到**同一套能力插件复用于完全不同的 Shell**——桌面版、Web 版、移动端甚至 CLI，都可以消费同一份能力模型。

所以最准确的说法不是：

> UI 用什么框架不重要。

而是：

> **UI 框架被降级成 Presentation Adapter 的实现细节，不再成为整个插件生态的公共依赖。**

这其实是一个非常值得追求的架构性质。
