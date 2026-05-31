# 开发指南

## 项目结构

```
WebChatBridge/
├── extension/           # Chrome 扩展
│   ├── src/
│   │   ├── adapters/              # 平台适配器
│   │   │   ├── impl/
│   │   │   │   ├── deepseek.ts    # DeepSeek 适配器
│   │   │   │   ├── kimi.ts        # Kimi 适配器
│   │   │   │   └── doubao.ts      # 豆包适配器
│   │   │   ├── base.ts            # 适配器基类
│   │   │   ├── types.ts           # 适配器接口定义
│   │   │   └── manager.ts         # 适配器管理器
│   │   ├── agent/
│   │   │   ├── loop.ts            # Agent Loop 核心循环
│   │   │   └── storage.ts         # 状态持久化
│   │   ├── detector/
│   │   │   ├── parser.ts          # tool_call 解析器
│   │   │   └── text-parser.ts     # 文本协议解析器
│   │   ├── prompts/
│   │   │   ├── index.ts           # 提示词管理
│   │   │   └── templates.ts       # 提示词模板
│   │   ├── core/
│   │   │   ├── config.ts          # 配置管理
│   │   │   ├── http-client.ts     # HTTP 通信
│   │   │   ├── logger.ts          # 日志系统
│   │   │   ├── state.ts           # 状态管理
│   │   │   └── types.ts           # 类型定义
│   │   ├── content/
│   │   │   ├── index.ts           # Content Script 入口
│   │   │   └── toolbar.ts         # 浮动工具栏
│   │   └── tools/
│   │       ├── impl/              # 工具实现
│   │       └── registry.ts        # 工具注册表
│   └── dist/                      # 构建产物
├── native-host/                   # Rust Native Host
│   ├── src/
│   │   ├── main.rs                # 入口
│   │   └── tool/
│   │       ├── task_manager.rs    # 后台任务管理
│   │       ├── read.rs            # 读取文件
│   │       ├── write.rs           # 写入文件
│   │       ├── shell.rs           # 执行命令
│   │       └── ...
│   └── Cargo.toml
├── docs/                          # 文档
└── README.md
```

## 添加新平台适配器

### 1. 创建适配器文件

在 `extension/src/adapters/impl/` 创建新文件，如 `chatgpt.ts`：

```typescript
import { BaseAdapter } from '../base';

export class ChatGPTAdapter extends BaseAdapter {
  name = 'chatgpt';

  messageSelectors: string[] = [
    '[data-message-author-role="assistant"]',
  ];

  detect(): boolean {
    return window.location.hostname.includes('chat.openai.com');
  }

  getConversationId(): string {
    return window.location.pathname.split('/').pop() || '';
  }

  // 实现三个核心接口
  isGenerating(): boolean {
    // 检查是否在生成中
  }

  getLastAIMessageElement(): Element | null {
    // 获取最后一条 AI 消息
  }

  findSendButton(): HTMLButtonElement | null {
    // 找到发送按钮
  }

  // 其他可选接口
  findInput(): HTMLElement | null { }
  findInputContainer(): HTMLElement | null { }
  findContinueButton(): HTMLButtonElement | null { }
  findRegenerateButton(): HTMLElement | null { }
  injectTextSafely(text: string): boolean { }
  async clickSend(): Promise<boolean> { }
}
```

### 2. 注册适配器

在 `content/index.ts` 中：

```typescript
import { ChatGPTAdapter } from './adapters/impl/chatgpt.js';

// 在初始化时注册
adapterManager.register(new ChatGPTAdapter());
```

### 3. 添加域名权限

在 `manifest.json` 中添加：

```json
{
  "content_scripts": [{
    "matches": ["https://chat.openai.com/*"]
  }],
  "host_permissions": ["https://chat.openai.com/*"]
}
```

### 4. 添加提示词模板

在 `prompts/templates.ts` 中：

```typescript
const CHATGPT_PROMPT = `你的提示词...`;

export const PROMPT_TEMPLATES: PromptTemplate[] = [
  { name: 'chatgpt', label: 'ChatGPT', defaultPrompt: CHATGPT_PROMPT },
  // ...
];
```

### 5. 测试

1. 构建扩展：`npm run build`
2. 重新加载扩展
3. 打开目标平台网页
4. 检查工具栏是否显示"已连接"
5. 注入提示词，测试 tool_call 检测和执行

## Agent Loop 执行链路

```
checkStatusChange → emitGenerationComplete → onGenerationComplete
→ detectAndProcess → executeToolCall → injectResult → clickSend
→ waitForGeneration → (循环)
```

排查问题时，沿这条链路逐个检查：
1. `isGenerating()` 返回值是否正确
2. `getLastAIMessageElement()` 能否拿到正确的元素
3. `findSendButton()` 能否找到发送按钮
4. tool_call 解析是否成功
5. 注入和发送是否成功

## 提示词管理

提示词优先级：用户自定义 > 代码默认模板

用户可以在工具栏中编辑提示词，保存到 `chrome.storage.local`。代码中的默认模板只在用户未自定义时使用。
