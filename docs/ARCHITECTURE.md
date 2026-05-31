# Web Chat Bridge 架构设计

## 参考项目

- **jcode** (Rust): https://github.com/1jehuang/jcode
- **Gemini CLI** (TypeScript): https://github.com/google-gemini/gemini-cli

## 整体架构

```
┌─────────────────────────────────────────────────────────────┐
│                    Chrome Extension                          │
│  ┌─────────────┐  ┌─────────────┐  ┌─────────────────────┐ │
│  │ Content     │  │ Background  │  │ Popup               │ │
│  │ Script      │  │ Service     │  │ UI                  │ │
│  │             │  │ Worker      │  │                     │ │
│  │ - 注入提示词 │  │ - 消息路由   │  │ - 状态显示          │ │
│  │ - 解析回复   │  │ - Native    │  │ - 配置管理          │ │
│  │ - 执行工具   │  │   Messaging │  │                     │ │
│  └─────────────┘  └─────────────┘  └─────────────────────┘ │
└─────────────────────────────────────────────────────────────┘
                              │
                              │ Native Messaging
                              ▼
┌─────────────────────────────────────────────────────────────┐
│                    Native Host (Rust)                        │
│  ┌─────────────────────────────────────────────────────────┐│
│  │                    Tool System                          ││
│  │  ┌─────────┐ ┌─────────┐ ┌─────────┐ ┌─────────────┐  ││
│  │  │ ls      │ │ read    │ │ grep    │ │ glob        │  ││
│  │  └─────────┘ └─────────┘ └─────────┘ └─────────────┘  ││
│  │  ┌─────────┐ ┌─────────┐ ┌─────────┐ ┌─────────────┐  ││
│  │  │ write   │ │ edit    │ │ shell   │ │ web_search  │  ││
│  │  └─────────┘ └─────────┘ └─────────┘ └─────────────┘  ││
│  └─────────────────────────────────────────────────────────┘│
│  ┌─────────────────────────────────────────────────────────┐│
│  │                    Core Systems                         ││
│  │  ┌─────────────┐ ┌─────────────┐ ┌─────────────────┐  ││
│  │  │ Config      │ │ Session     │ │ Memory          │  ││
│  │  │ Management  │ │ Management  │ │ Management      │  ││
│  │  └─────────────┘ └─────────────┘ └─────────────────┘  ││
│  │  ┌─────────────┐ ┌─────────────┐ ┌─────────────────┐  ││
│  │  │ MCP         │ │ Skills      │ │ Agent           │  ││
│  │  │ Protocol    │ │ System      │ │ Runtime         │  ││
│  │  └─────────────┘ └─────────────┘ └─────────────────┘  ││
│  └─────────────────────────────────────────────────────────┘│
└─────────────────────────────────────────────────────────────┘
```

## 核心设计原则

### 1. 工具系统设计（参考 jcode）

```rust
// 参考 jcode/crates/jcode-tool-core/src/lib.rs
#[async_trait]
pub trait Tool: Send + Sync {
    fn name(&self) -> &str;
    fn description(&self) -> &str;
    fn parameters_schema(&self) -> Value;
    async fn execute(&self, input: Value, ctx: ToolContext) -> Result<ToolOutput>;
}
```

**关键点：**
- 直接使用 Rust 文件系统 API，不调用 shell 命令
- 使用 `tokio` 进行异步执行
- 使用 `anyhow` 进行错误处理
- 使用 `serde_json` 进行 JSON 序列化

### 2. 工具实现（直接复制 jcode）

| 工具 | jcode 文件 | 说明 |
|------|-----------|------|
| ls | `src/tool/ls.rs` | 列出目录内容 |
| read | `src/tool/read.rs` | 读取文件 |
| grep | `src/tool/grep.rs` | 搜索文件内容 |
| glob | `src/tool/glob.rs` | 查找文件 |
| write | `src/tool/write.rs` | 写入文件 |
| edit | `src/tool/edit.rs` | 编辑文件 |
| shell | `src/tool/bash.rs` | 执行命令 |

### 3. 浏览器扩展架构（参考 Gemini CLI）

```
chrome-extension/
├── manifest.json
├── background/
│   └── service-worker.js      # 消息路由、Native Messaging
├── content/
│   ├── content.js             # 主逻辑
│   ├── adapters/              # AI 服务适配器
│   │   ├── base.js            # 基础适配器
│   │   ├── manager.js         # 适配器管理器
│   │   ├── deepseek.js        # DeepSeek 适配器
│   │   ├── kimi.js            # Kimi 适配器
│   │   ├── chatgpt.js         # ChatGPT 适配器
│   │   ├── claude.js          # Claude 适配器
│   │   └── gemini.js          # Gemini 适配器
│   └── tools/                 # 工具定义（参考 Gemini CLI）
│       ├── definitions.ts     # 工具定义
│       ├── registry.ts        # 工具注册
│       └── executor.ts        # 工具执行
└── popup/
    └── popup.html             # 配置界面
```

### 4. 消息流

```
用户输入 → AI 服务 → 回复（包含 tool_call）
    ↓
Content Script 解析 tool_call
    ↓
发送到 Background Service Worker
    ↓
通过 Native Messaging 发送到 Native Host
    ↓
Native Host 执行工具
    ↓
返回结果到 Background Service Worker
    ↓
发送到 Content Script
    ↓
注入结果到输入框并发送
```

## 未来功能规划

### 1. MCP 支持（参考 Gemini CLI）

```
packages/core/src/tools/mcp-client.ts
packages/core/src/tools/mcp-client-manager.ts
packages/core/src/tools/mcp-tool.ts
```

**实现要点：**
- MCP 协议实现
- MCP 服务器连接管理
- MCP 工具注册和执行

### 2. Memory 支持（参考 jcode）

```
src/tool/memory.rs
crates/jcode-memory-types/
```

**实现要点：**
- 会话记忆
- 长期记忆
- 语义搜索（可选）

### 3. Skills 支持（参考 Gemini CLI）

```
packages/core/src/tools/activate-skill.ts
```

**实现要点：**
- 技能定义
- 技能激活
- 技能执行

### 4. Agent 支持（参考 jcode）

```
src/agent.rs
crates/jcode-agent-runtime/
```

**实现要点：**
- Agent 循环
- 工具调用编排
- 错误处理和重试

## 实施计划

### Phase 1: 重写 Native Host（1-2 周）

1. 复制 jcode 的工具实现
2. 适配 Native Messaging 协议
3. 添加配置管理
4. 测试所有工具

### Phase 2: 重构浏览器扩展（1-2 周）

1. 参考 Gemini CLI 重构工具定义
2. 优化注入和发送逻辑
3. 添加适配器管理
4. 测试所有 AI 服务

### Phase 3: 添加高级功能（2-4 周）

1. MCP 支持
2. Memory 支持
3. Skills 支持
4. Agent 支持

## 依赖项

### Native Host (Rust)

```toml
[dependencies]
tokio = { version = "1", features = ["full"] }
serde = { version = "1", features = ["derive"] }
serde_json = "1"
anyhow = "1"
async-trait = "0.1"
glob = "0.3"
ignore = "0.4"
walkdir = "2"
regex = "1"
similar = "2"
```

### 浏览器扩展 (TypeScript)

```json
{
  "devDependencies": {
    "typescript": "^5.0.0",
    "@types/chrome": "^0.0.0"
  }
}
```

## 测试策略

### 单元测试

- 每个工具都有独立的测试
- 测试正常情况和边界情况
- 测试错误处理

### 集成测试

- 测试 Native Messaging 通信
- 测试浏览器扩展和 Native Host 的集成
- 测试完整的工具调用流程

### 端到端测试

- 测试真实的 AI 服务
- 测试完整的用户流程
- 测试性能和稳定性

## 参考资源

### jcode

- 工具实现: `src/tool/`
- 工具核心: `crates/jcode-tool-core/`
- Agent 运行时: `crates/jcode-agent-runtime/`
- Memory 系统: `crates/jcode-memory-types/`

### Gemini CLI

- 工具定义: `packages/core/src/tools/definitions/`
- 工具实现: `packages/core/src/tools/`
- MCP 客户端: `packages/core/src/tools/mcp-client.ts`
- 技能系统: `packages/core/src/tools/activate-skill.ts`
