# Web Chat Bridge 统一日志系统 — 需求与方案文档

## 一、需求背景

### 1.1 问题

Web Chat Bridge 是一个 Chrome 扩展 + Rust 本地服务器的系统，让网页 AI（DeepSeek 等）能操作本地文件系统。系统有两个独立组件：

- **Chrome 扩展**（content script）：注入到 AI 聊天页面，检测 AI 输出的 `tool_call`，发送给服务器执行，注入结果
- **Rust 本地服务器**（native host）：接收工具调用请求，执行文件操作和 shell 命令

调试这个系统时，需要看到**两侧的完整事件链**：扫描 → 检测 → 解析 → 发送 → 执行 → 结果 → 注入。任何一环出问题，都需要日志来定位。

### 1.2 当前日志现状

| 组件 | 日志机制 | 状态 |
|------|----------|------|
| Native host | 手写 `FileLogger` → `/tmp/webchatbridge-native-debug.log` + stderr | 正常工作 |
| Extension | Logger 类 → 内存 LogManager 数组 | 只在内存，看不到 |
| Extension | `console.log` | MV3 content script isolated world 中**不可见** |
| Extension | `chrome.runtime.sendMessage({ type: 'WRITE_LOG' })` | **死路** — background 无接收者 |

**核心矛盾**：扩展内部有完整的日志记录（53 条），但 AI 调试时一条都看不到。

### 1.3 直接原因

Chrome MV3 的 content script 运行在 isolated world 中，其 `console.log` 输出不会出现在页面的 DevTools Console 中。这是一个已知的 Chrome 行为，不是代码 bug。

---

## 二、目的

**日志系统的唯一消费者是 AI 智能体。**

不是给人看的（人可以用 DevTools），是给 AI 用的。AI 需要：
1. 读取一个文件就能看到完整的事件链
2. 通过搜索关键词快速定位问题环节
3. 根据时间戳判断哪个环节卡住或延迟

---

## 三、方案

### 3.1 核心思路

Extension 的日志通过 HTTP POST 发送到 native host，native host 追加写入同一个日志文件。AI 直接 `Read` 该文件。

### 3.2 改动范围

**仅改 2 个文件：**

#### 文件 1：`native-host/src/server.rs`

新增 `POST /api/log` 端点：

```
POST /api/log
Content-Type: application/json

{
  "module": "Observer",
  "msg": "Found new tool_call: edit",
  "data": { "file_path": "/tmp/test.py" }
}
```

- 用现有 `flog!` 宏写入 `/tmp/webchatbridge-native-debug.log`
- 前缀加 `[ext]` 标识来源：`[1748516107545][ext] [Observer] Found new tool_call: edit`
- Native 自身日志不变：`[1748516107545] Listening on http://127.0.0.1:18789`
- 返回 `{ "ok": true }`

#### 文件 2：`chrome-extension-v2/src/core/logger.ts`

修改 `writeToBackground()` 方法：

- 删除 `chrome.runtime.sendMessage({ type: 'WRITE_LOG' })` 死代码
- 改为 `fetch POST` 到 `http://localhost:{port}/api/log`
- 端口从 http-client.ts 的 baseUrl 获取（已有端口发现逻辑）

### 3.3 不改什么

- 日志文件格式不变（保持 `[timestamp] message`）
- 不加日志轮转
- 不加 `/api/logs` 读取端点
- 不改 native host 的 FileLogger 实现
- 不改 `flog!` 宏
- 不改 LogManager 内存存储（debug bridge 仍可用）

---

## 四、AI 调试使用方式

### 4.1 日常调试

当工具调用链路出问题时：

```
1. Read /tmp/webchatbridge-native-debug.log
2. 搜索 `[ext]` — 找 extension 侧日志
3. 搜索关键事件：
   - "Found new tool_call" — 扫描检测到了
   - "Executing" — 开始执行了
   - "Succeeded" / "Failed" — 执行完成了
   - "Result injected" — 结果注入了
4. 根据时间戳判断哪个环节缺失或延迟
```

### 4.2 QA 测试中的使用

QA 测试流程中，用日志替代 console 检查：

```
旧流程（失效）:
  list_console_messages → 看不到扩展日志

新流程:
  Read /tmp/webchatbridge-native-debug.log → 看到完整事件链
```

### 4.3 日志格式示例

```
[1748516106545] === HTTP Server Starting ===
[1748516106549] Tool registry: 7 tools
[1748516106550] Listening on http://127.0.0.1:18789
[1748516107545][ext] [Observer] Starting periodic scanner (1s interval)
[1748516108545][ext] [Observer] Found new tool_call: run_shell_command
[1748516108546][ext] [Observer] Executing: run_shell_command {"command":"echo hello"}
[1748516108592] Tool call: run_shell_command | Args: {"command":"echo hello"}
[1748516108593] Tool result: run_shell_command | OK (4 bytes)
[1748516108594][ext] [Content] Tool execution result: run_shell_command {"success":true}
[1748516108595][ext] [Observer] Succeeded: run_shell_command
[1748516108613][ext] [Content] Result injected for: run_shell_command
```

AI 读取后可以判断：
- `[ext]` 前缀 = extension 侧事件
- 无前缀 = native 侧事件
- 完整链路从 Found → Executing → Tool call → Tool result → Succeeded → Result injected

---

## 五、验证方式

1. 构建 native host：`cd native-host && cargo build --release`
2. 重启服务器
3. 构建扩展：`cd chrome-extension-v2 && npm run build`
4. 重载扩展
5. 在 DeepSeek 发送一条工具调用消息（如"执行 echo hello"）
6. `Read /tmp/webchatbridge-native-debug.log`
7. 验证：
   - 有 `[ext]` 前缀的日志条目
   - 完整链路：Found → Executing → native execute → Succeeded → Result injected
   - 时间戳连续，无异常间隔
