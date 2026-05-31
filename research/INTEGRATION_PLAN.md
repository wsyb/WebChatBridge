# WebChatBridge × AIPex 集成方案

## 核心原则

**最大化复用 AIPex 源码**，减少重写。但 AIPex 有两个与 WebChatBridge 不兼容的地方需要适配：

1. **工具定义格式不同** — AIPex 用 `@openai/agents` 的 `tool()` + Zod schema，WebChatBridge 用 `ToolDefinition` + JSON Schema
2. **执行路径不同** — AIPex 工具直接在扩展层执行，WebChatBridge 当前全部走 Rust 后端

**策略**：复制 AIPex 的 Chrome API 调用逻辑，包装成 WebChatBridge 的 `ToolDefinition` 格式。

---

## 架构变化

```
当前：
AI tool_call → 扩展 → HTTP → Rust 后端 → 本地执行

集成后：
AI tool_call → 扩展
    ├─ browser_* 工具 → 直接调用 Chrome API（新增）
    └─ 其他工具 → HTTP → Rust 后端（不变）
```

---

## 文件清单

### 阶段一：标签管理（最简单，可直接复用）

| 操作 | 文件 | 来源 |
|------|------|------|
| 复制 | `extension/src/browser/tab-utils.ts` | ← AIPex `tools/tab-utils.ts`（原样复制） |
| 复制 | `extension/src/browser/tab.ts` | ← AIPex `tools/tab.ts`（改写为 WebChatBridge 格式） |
| 新建 | `extension/src/tools/impl/browser_list_tabs.ts` | 包装 tab.ts |
| 新建 | `extension/src/tools/impl/browser_create_tab.ts` | 包装 tab.ts |
| 新建 | `extension/src/tools/impl/browser_close_tab.ts` | 包装 tab.ts |
| 新建 | `extension/src/tools/impl/browser_switch_tab.ts` | 包装 tab.ts |
| 新建 | `extension/src/tools/impl/browser_navigate.ts` | 包装 tab.ts |

**可直接复用的代码**：

`tab-utils.ts` — **原样复制**，无任何依赖：
```typescript
// 来源: AIPex packages/browser-runtime/src/tools/tab-utils.ts
// 依赖: 仅 chrome.tabs API，无外部依赖
// 改动: 无
```

`tab.ts` 中的 Chrome API 调用逻辑 — **提取核心逻辑**：
- `chrome.tabs.query({})` — 获取所有标签
- `chrome.tabs.create({ url, active })` — 创建标签
- `chrome.tabs.remove(tabId)` — 关闭标签
- `chrome.tabs.update(tabId, { active: true })` — 切换标签
- `chrome.tabs.get(tabId)` — 获取标签信息

### 阶段二：页面内容和截图

| 操作 | 文件 | 来源 |
|------|------|------|
| 复制 | `extension/src/browser/screenshot-helpers.ts` | ← AIPex `tools/screenshot-helpers.ts`（需适配） |
| 复制 | `extension/src/browser/page.ts` | ← AIPex `tools/page.ts`（改写） |
| 新建 | `extension/src/tools/impl/browser_screenshot.ts` | 包装 |
| 新建 | `extension/src/tools/impl/browser_get_page_content.ts` | 新写 |
| 新建 | `extension/src/tools/impl/browser_evaluate_js.ts` | 新写 |

**可直接复用的代码**：

`screenshot-helpers.ts` — **提取核心函数**：
```typescript
// 来源: AIPex packages/browser-runtime/src/tools/screenshot-helpers.ts
// 核心: chrome.tabs.captureVisibleTab() + canvas 压缩
// 改动: 移除 AIPex 特有的 caching/UID 逻辑
```

`page.ts` — **提取核心函数**：
```typescript
// 来源: AIPex packages/browser-runtime/src/tools/page.ts
// 核心: chrome.scripting.executeScript() 注入 JS 获取页面数据
// 改动: 移除 Zod schema，改为 WebChatBridge 参数格式
```

`compressImage()` — **原样复制**：
```typescript
// 来源: AIPex packages/browser-runtime/src/tools/screenshot.ts
// 功能: canvas 缩放 + JPEG 压缩
// 依赖: 无（纯浏览器 API）
// 改动: 无
```

### 阶段三：页面交互（需要 snapshot 系统）

| 操作 | 文件 | 来源 |
|------|------|------|
| 复制 | `extension/src/browser/snapshot/text-snapshot.ts` | ← AIPex `automation/types.ts` + `snapshot-manager.ts` |
| 复制 | `extension/src/browser/snapshot/query.ts` | ← AIPex `automation/query.ts`（**原样复制**） |
| 复制 | `extension/src/browser/snapshot/provider.ts` | ← AIPex `automation/snapshot-provider.ts`（需适配） |
| 复制 | `extension/src/browser/dom-snapshot/` | ← AIPex `packages/dom-snapshot/src/`（整体复制） |
| 新建 | `extension/src/tools/impl/browser_search_elements.ts` | 包装 |
| 新建 | `extension/src/tools/impl/browser_click.ts` | 包装 |
| 新建 | `extension/src/tools/impl/browser_fill.ts` | 包装 |

**可直接复用的代码**：

`dom-snapshot/` 包 — **整体复制**：
```
来源: AIPex packages/dom-snapshot/src/
文件:
  - collector.ts    — DOM 遍历收集器
  - manager.ts      — 快照管理器
  - query.ts        — 查询引擎
  - snapshot-formatter.ts — 格式化输出
  - types.ts        — 类型定义
依赖: 无外部依赖（纯 DOM API）
改动: 修改 import 路径
```

`automation/query.ts` — **原样复制**：
```typescript
// 来源: AIPex packages/browser-runtime/src/automation/query.ts
// 功能: glob/grep 模式搜索快照文本
// 依赖: 无
// 改动: 无
```

`automation/snapshot-manager.ts` — **提取核心**：
```typescript
// 来源: AIPex packages/browser-runtime/src/automation/snapshot-manager.ts
// 功能: CDP-based 快照管理
// 依赖: chrome.debugger API
// 改动: 移除 AIPex 特有的 mode 切换逻辑
```

---

## 具体实现步骤

### Step 1: 修改 executor.ts（关键改动）

当前 executor 把所有工具调用都发给 Rust 后端。需要添加浏览器工具的本地执行路径：

```typescript
// extension/src/tools/executor.ts — 修改

// 新增：浏览器工具列表
const BROWSER_TOOLS = new Set([
  'browser_list_tabs', 'browser_create_tab', 'browser_close_tab',
  'browser_switch_tab', 'browser_navigate', 'browser_screenshot',
  'browser_get_page_content', 'browser_evaluate_js',
  'browser_search_elements', 'browser_click', 'browser_fill',
]);

async execute(call: ToolCall): Promise<ToolResult> {
  // 浏览器工具：直接在扩展层执行
  if (BROWSER_TOOLS.has(call.name)) {
    const tool = this.registry.get(call.name);
    if (tool) return tool.execute(call.arguments);
    return { success: false, error: `Unknown browser tool: ${call.name}` };
  }

  // 其他工具：走 Rust 后端（不变）
  return httpClient.executeTool(call);
}
```

### Step 2: 复制 tab-utils.ts（原样）

直接从 AIPex 复制，无需修改：

```
源文件: research/aipex/packages/browser-runtime/src/tools/tab-utils.ts
目标: extension/src/browser/tab-utils.ts
改动: 无
```

### Step 3: 创建浏览器工具实现

每个浏览器工具 = 从 AIPex 提取 Chrome API 调用 + 包装成 WebChatBridge 格式。

以 `browser_list_tabs` 为例：

```typescript
// extension/src/tools/impl/browser_list_tabs.ts
import type { ToolResult } from '../../core/types.js';
import type { ToolDefinition } from '../types.js';

const browser_list_tabs: ToolDefinition = {
  name: 'browser_list_tabs',
  description: 'List all open browser tabs with their IDs, titles, and URLs',
  parameters: {
    type: 'object',
    properties: {},
    required: [],
  },
  async execute(_args: Record<string, unknown>): Promise<ToolResult> {
    // === 以下代码来自 AIPex tab.ts getAllTabsTool ===
    const tabs = await chrome.tabs.query({});
    const tabList = tabs.map((tab) => ({
      id: tab.id,
      url: tab.url,
      title: tab.title,
      active: tab.active,
      windowId: tab.windowId,
      index: tab.index,
    }));
    // === AIPex 代码结束 ===

    return {
      success: true,
      content: JSON.stringify({ tabs: tabList, count: tabList.length }, null, 2),
    };
  },
};

export default browser_list_tabs;
```

### Step 4: 复制 snapshot 系统（阶段三）

```
源目录: research/aipex/packages/dom-snapshot/src/
目标目录: extension/src/browser/dom-snapshot/

需要复制的文件:
  collector.ts      — DOM 遍历收集器（核心，原样复制）
  manager.ts        — 快照管理器（原样复制）
  query.ts          — 查询引擎（原样复制）
  snapshot-formatter.ts — 格式化（原样复制）
  types.ts          — 类型定义（原样复制）
  index.ts          — 入口（修改 export）

依赖: 无外部 npm 包，纯浏览器 DOM API
```

### Step 5: 修改 manifest.json

```json
{
  "permissions": [
    "activeTab", "scripting", "storage",
    "tabs",           // 新增：标签管理
    "debugger",       // 新增：CDP 快照
    "windows"         // 新增：窗口管理
  ],
  "host_permissions": [
    "http://localhost:*/*",
    "https://kimi.moonshot.cn/*",
    "https://www.kimi.com/*",
    "https://chat.deepseek.com/*",
    "https://www.doubao.com/*"
  ]
}
```

### Step 6: 修改 system-prompt.md

在现有工具列表后添加浏览器工具说明。

---

## 复用率统计

| 类别 | 总文件数 | 可直接复制 | 需适配 | 需新写 |
|------|---------|-----------|--------|--------|
| 标签管理 | 5 | 1 (tab-utils.ts) | 1 (tab.ts → 提取) | 5 (工具定义) |
| 页面/截图 | 4 | 2 (compressImage, page APIs) | 1 (screenshot-helpers) | 3 (工具定义) |
| Snapshot 系统 | 6 | 5 (dom-snapshot 整包) | 1 (snapshot-provider) | 0 |
| 页面交互 | 3 | 0 | 0 | 3 (工具定义) |
| **合计** | **18** | **8 (44%)** | **3 (17%)** | **11 (39%)** |

**核心发现**：AIPex 的 `dom-snapshot` 包（5个文件）和 `tab-utils.ts` 可以**原样复制**，占总代码量约 44%。其余需要适配的主要是工具定义格式（Zod → JSON Schema）。

---

## 风险点

1. **AIPex 依赖 `@openai/agents`** — 工具定义用了这个包的 `tool()` 函数，但我们不需要它，直接用 WebChatBridge 的 `ToolDefinition` 接口即可
2. **AIPex 依赖 `@aipexstudio/dom-snapshot`** — 这是 workspace 包，已包含在源码中，可直接复制
3. **snapshot 需要 `chrome.debugger` 权限** — 需要用户授权，且某些页面（如 chrome://）不允许
4. **content script 注入** — AIPex 的 dom-snapshot 需要 content script 配合收集 DOM，WebChatBridge 需要在 manifest 中配置

---

## UX 设计方案（已确认）

### 工具栏按钮

```
[标题] [状态点] | [工作目录] | [任务] | [注入本机操控能力] [注入浏览器操控能力]
```

### 按钮语义

| 按钮 | 功能 | 注入的 prompt |
|------|------|---------------|
| 注入本机操控能力 | 注入基础系统提示词（文件/命令/任务工具） | system-prompt-local.md |
| 注入浏览器操控能力 | 注入包含浏览器控制工具的系统提示词 | system-prompt-browser.md |

### 交互流程

1. 用户点击「注入本机操控能力」→ 注入本地工具 prompt → AI 可操作文件/命令
2. 用户点击「注入浏览器操控能力」→ 注入浏览器工具 prompt → AI 可操控浏览器
3. 两个按钮独立，不需要先开开关再重新注入，一步到位

### 提示词结构

**system-prompt-local.md**（现有提示词，改名）：
- 包含：ls、read、write、edit、grep、glob、shell、task_* 等工具
- 不包含：任何浏览器工具

**system-prompt-browser.md**（新增）：
- 包含：browser_list_tabs、browser_create_tab、browser_close_tab、browser_switch_tab、browser_navigate、browser_screenshot、browser_get_page_content、browser_evaluate_js、browser_search_elements、browser_click、browser_fill 等工具
- 不包含：本地文件/命令工具（浏览器场景不需要）

### 注意事项

- 两个按钮注入的 prompt 互斥（不会同时生效）
- 用户可以随时切换——点了「注入浏览器操控能力」后，再点「注入本机操控能力」会覆盖
- 浏览器按钮需要 `tabs`、`debugger`、`windows` 权限，Chrome 会弹权限请求
