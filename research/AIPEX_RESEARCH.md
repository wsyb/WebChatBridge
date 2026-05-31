# AIPex 调研报告

## 项目概况

| 项目 | 详情 |
|------|------|
| 名称 | AIPex |
| Stars | 1,198 |
| 仓库 | https://github.com/AIPexStudio/AIPex |
| 语言 | TypeScript |
| 许可 | MIT |
| 核心理念 | 在用户现有浏览器中实现 AI 自动化，不装新浏览器 |

## 架构分析

AIPex 采用三层架构：

```
AI Agent (IDE/Chat)
    ↓ stdio (MCP 协议)
aipex-mcp-bridge (Node.js 进程)
    ↓ WebSocket
AIPex Chrome Extension (浏览器内)
    ↓ Chrome Extension APIs
浏览器控制
```

### 关键组件

1. **aipex-mcp-bridge** — MCP 服务器，接收 AI 的工具调用，通过 WebSocket 转发给扩展
2. **browser-runtime** — Chrome 扩展核心，实现所有浏览器控制工具
3. **browser-ext** — Chrome 扩展的 UI 层（Side Panel、Options 等）
4. **aipex-core** — 工具定义框架（`tool()` 函数 + Zod schema）

## 工具清单

AIPex 共暴露约 34 个工具，分为以下几类：

### 浏览器/标签管理（7 个）
- `get_all_tabs` — 获取所有标签页
- `get_current_tab` — 获取当前标签页
- `switch_to_tab` — 切换到指定标签
- `create_new_tab` — 创建新标签
- `get_tab_info` — 获取标签详情
- `close_tab` — 关闭标签
- `ungroup_tabs` — 取消标签分组

### 页面交互（8 个）
- `search_elements` — 搜索页面元素（核心创新）
- `click` — 点击元素（通过 UID）
- `fill_element_by_uid` — 填写输入框
- `fill_form` — 批量填写表单
- `hover_element_by_uid` — 悬停元素
- `get_editor_value` — 获取编辑器内容
- `computer` — 坐标级鼠标/键盘操作（降级方案）

### 页面内容（4 个）
- `get_page_metadata` — 获取页面元数据
- `scroll_to_element` — 滚动到元素
- `highlight_element` — 高亮元素
- `highlight_text_inline` — 高亮文本

### 截图（3 个）
- `capture_screenshot` — 截图
- `capture_screenshot_with_highlight` — 截图+高亮
- `capture_tab_screenshot` — 标签页截图

### 下载（2 个）
- `download_image` — 下载图片
- `download_chat_images` — 批量下载图片

### 干预（4 个）
- 用于请求用户介入（语音输入、选择等）

### 技能系统（6 个）
- 用于加载和执行技能

## 核心创新：search_elements

AIPex 最大的创新是 `search_elements` 工具，它：

1. 通过 Chrome Accessibility Tree 生成页面快照
2. 为每个交互元素分配唯一 UID
3. 支持 glob/grep 模式搜索
4. 返回带 UID 的元素列表
5. 后续操作（click、fill）通过 UID 直接定位元素

**优势**：比截图快得多，不消耗 LLM 视觉 token，更可靠。

## 权限要求

AIPex 的 manifest.json 需要以下权限：

```json
{
  "permissions": [
    "tabs", "windows", "tabGroups", "activeTab",
    "bookmarks", "browsingData", "history", "scripting",
    "commands", "storage", "contextMenus", "sessions",
    "sidePanel", "management", "downloads", "debugger",
    "cookies", "webNavigation", "audioCapture", "alarms"
  ],
  "host_permissions": ["https://*/*", "http://*/*", "<all_urls>"]
}
```

## 对 WebChatBridge 的集成参考

### 可直接复用的模式

1. **工具定义模式** — AIPex 使用 Zod schema 定义工具参数，WebChatBridge 可以参考
2. **标签管理 API** — `chrome.tabs` 的调用方式可以直接借鉴
3. **search_elements 思路** — 通过 Accessibility Tree 做页面快照+搜索，这是最有价值的参考
4. **截图压缩** — AIPex 的截图压缩逻辑（canvas 缩放 + JPEG 压缩）

### 需要适配的部分

1. **通信方式** — AIPex 用 WebSocket + MCP，WebChatBridge 用 HTTP + 自定义 tool_call 格式
2. **工具注册** — WebChatBridge 用 `ToolRegistry`，需要适配新的浏览器工具
3. **执行路径** — 浏览器工具需要在扩展层直接执行，不走 Rust 后端

### 推荐集成方案

在 WebChatBridge 中增加浏览器工具，需要：

1. **修改 `executor.ts`** — 判断工具类型，浏览器工具直接在扩展层执行
2. **新增 `tools/impl/browser_*.ts`** — 每个浏览器工具的实现
3. **修改 `manifest.json`** — 添加 `tabs`、`debugger` 等权限
4. **修改 `system-prompt.md`** — 添加浏览器工具的使用说明

### 优先级建议

**P0（核心）**：
- `browser_list_tabs` — 列出所有标签
- `browser_create_tab` — 创建标签
- `browser_close_tab` — 关闭标签
- `browser_navigate` — 导航到 URL
- `browser_get_page_content` — 获取页面内容

**P1（重要）**：
- `browser_click` — 点击元素
- `browser_type` — 输入文字
- `browser_screenshot` — 截图
- `browser_evaluate_js` — 执行 JS

**P2（增强）**：
- `browser_search_elements` — 搜索元素（参考 AIPex）
- `browser_highlight` — 高亮元素
- `browser_scroll` — 滚动页面

## 参考资源

- AIPex 源码：`research/aipex/`
- Chrome Tabs API：https://developer.chrome.com/docs/extensions/reference/api/tabs
- Chrome Scripting API：https://developer.chrome.com/docs/extensions/reference/api/scripting
- Chrome Debugger API：https://developer.chrome.com/docs/extensions/reference/api/debugger
