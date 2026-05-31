# 第三阶段执行计划：元素交互

## 目标

实现 3 个工具：`browser_search_elements`、`browser_click`、`browser_fill`
核心依赖：AIPex 的 `dom-snapshot` 包（DOM 遍历 + 快照 + 搜索）

## 架构决策

**所有操作都在 background service worker 中执行**，通过 `chrome.scripting.executeScript()` 注入到页面：

```
content script → port.postMessage({ BROWSER_TOOL })
    ↓
background → chrome.scripting.executeScript()
    ↓ 注入 JS 到目标页面
页面中执行：DOM 遍历 / 元素定位 / 点击 / 填写
    ↓ 返回结果
background → port.postMessage({ result })
    ↓
content script → 注入回 AI 对话
```

**不需要 content script 参与**，因为 `chrome.scripting.executeScript()` 可以从 background 直接注入 JS 到任意页面。

## 文件清单

### 第一步：复制 dom-snapshot 包（5 个文件）

| 源文件（AIPex） | 目标文件（WebChatBridge） | 改动 |
|---|---|---|
| `dom-snapshot/src/types.ts` | `browser/dom-snapshot/types.ts` | 原样复制 |
| `dom-snapshot/src/collector.ts` | `browser/dom-snapshot/collector.ts` | 改 `data-aipex-nodeid` → `data-wcb-nodeid` |
| `dom-snapshot/src/manager.ts` | `browser/dom-snapshot/manager.ts` | 原样复制 |
| `dom-snapshot/src/query.ts` | `browser/dom-snapshot/query.ts` | 原样复制 |
| `dom-snapshot/src/snapshot-formatter.ts` | `browser/dom-snapshot/snapshot-formatter.ts` | 原样复制 |
| `dom-snapshot/src/index.ts` | `browser/dom-snapshot/index.ts` | 修改 export |

**依赖分析**：这 5 个文件只依赖浏览器 DOM API，无外部 npm 包，可直接复制。

### 第二步：创建 DomLocator（元素操作核心）

| 源文件（AIPex） | 目标文件（WebChatBridge） | 改动 |
|---|---|---|
| `automation/dom-locator.ts` | `browser/dom-locator.ts` | 改 `data-aipex-nodeid` → `data-wcb-nodeid` |

**DomLocator 的工作方式**：
- `chrome.scripting.executeScript()` 注入 `runDomAction()` 函数到页面
- 该函数通过 `[data-wcb-nodeid="xxx"]` 选择器定位元素
- 执行 click / fill / hover / boundingBox 等操作
- 返回操作结果

**可直接复制**，只需改属性名。

### 第三步：创建搜索逻辑

| 源文件（AIPex） | 目标文件（WebChatBridge） | 改动 |
|---|---|---|
| `automation/snapshot-provider.ts` 的搜索部分 | `browser/snapshot-search.ts` | 提取核心逻辑，简化 |

**搜索流程**：
1. `chrome.scripting.executeScript()` 注入 `collectDomSnapshot()` 到页面
2. 页面返回 `SerializedDomSnapshot`（JSON 树）
3. Background 中调用 `buildTextSnapshot()` + `formatSnapshot()` 转为文本
4. 调用 `searchSnapshotText()` 用 glob 模式搜索
5. 返回匹配的行（含 UID）

### 第四步：创建 3 个工具

| 文件 | 说明 |
|---|---|
| `browser/tools/search-elements.ts` | 工具定义（参数：tabId, query, contextLevels?） |
| `browser/tools/click.ts` | 工具定义（参数：tabId, uid） |
| `browser/tools/fill.ts` | 工具定义（参数：tabId, uid, value） |

### 第五步：更新 background 处理器

在 `background/browser-tools.ts` 中添加 3 个新 case。

### 第六步：更新注册和提示词

- `tools/index.ts` — 注册 3 个新工具
- `prompts/system-prompt-browser.md` — 添加工具说明和示例

## 执行顺序

1. 复制 dom-snapshot（5 文件）— 改属性名
2. 复制 dom-locator.ts — 改属性名
3. 创建 snapshot-search.ts — 提取搜索逻辑
4. 创建 3 个工具定义文件
5. 更新 background/browser-tools.ts
6. 更新 tools/index.ts
7. 更新提示词
8. 构建验证

## 风险点

1. **dom-snapshot 的 collector.ts 有 861 行**，是最复杂的文件，需要仔细改属性名
2. **DomLocator 的 runDomAction 函数很长**（~300 行），注入到页面执行，需要确保无外部依赖
3. **快照数据量可能很大**，通过端口传输时注意大小
4. **页面动态变化**：快照是某一时刻的，点击时页面可能已变化，需要处理"元素未找到"的情况
