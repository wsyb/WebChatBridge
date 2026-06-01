# 开发指南

## 环境要求

| 工具 | 版本 | 说明 |
|------|------|------|
| Node.js | >= 18 | 扩展构建 |
| npm | >= 9 | 依赖管理 |
| Rust | >= 1.75 | Native Host 编译 |
| Chrome | >= 110 | 测试扩展 |

## 快速开始

### 1. 克隆仓库

```bash
git clone https://github.com/wsyb/WebChatBridge.git
cd WebChatBridge
```

### 2. 构建 Chrome 扩展

```bash
cd extension
npm install
npm run build
```

构建产物在 `extension/dist/`。

### 3. 编译 Native Host

```bash
cd native-host
cargo build --release
```

编译产物在 `native-host/target/release/wcb`。

### 4. 加载扩展测试

1. 打开 Chrome，访问 `chrome://extensions/`
2. 启用「开发者模式」
3. 点击「加载已解压的扩展程序」
4. 选择 `extension` 目录
5. 打开 DeepSeek / Kimi / 豆包网页，检查工具栏是否显示

## 开发命令

### Chrome 扩展

```bash
cd extension

npm install          # 安装依赖
npm run build        # 构建
npm run dev          # 开发模式（文件变更自动重新构建）
npm run lint         # 代码检查
npm run format       # 代码格式化
npm run typecheck    # 类型检查
npm run test         # 运行测试
```

### Native Host

```bash
cd native-host

cargo build          # 调试构建
cargo build --release  # 发布构建
cargo test           # 运行测试
cargo clippy         # 代码检查
cargo fmt            # 代码格式化
```

## 代码规范

### TypeScript

- 使用 ESLint + Prettier
- 运行 `npm run lint` 检查
- 运行 `npm run format` 格式化

### Rust

- 遵循 rustfmt 默认格式
- 使用 `cargo clippy` 检查
- 运行 `cargo fmt` 格式化

### 提交信息

遵循 [Conventional Commits](https://www.conventionalcommits.org/) 规范：

```
<type>(<scope>): <description>

[optional body]

[optional footer]
```

类型：
- `feat`: 新功能
- `fix`: 修复 bug
- `docs`: 文档更新
- `style`: 代码格式（不影响功能）
- `refactor`: 重构
- `test`: 测试相关
- `chore`: 构建/工具相关

示例：
```
feat(doubao): 添加豆包平台适配器
fix(agent-loop): 修复 tool_call 检测失败的问题
docs: 更新安装指南
```

## 项目结构

```
WebChatBridge/
├── extension/                   # Chrome 扩展
│   ├── src/
│   │   ├── adapters/            # 平台适配器
│   │   │   ├── impl/            # 具体适配器实现
│   │   │   ├── base.ts          # 适配器基类
│   │   │   ├── types.ts         # 接口定义
│   │   │   └── manager.ts       # 适配器管理器
│   │   ├── agent/               # Agent Loop 核心循环
│   │   ├── detector/            # tool_call 检测和解析
│   │   ├── prompts/             # 提示词模板
│   │   ├── core/                # 基础设施（配置、日志、状态）
│   │   ├── content/             # Content Script（工具栏）
│   │   └── tools/               # 工具注册表
│   ├── dist/                    # 构建产物（git ignore）
│   └── tests/                   # 测试文件
├── native-host/                 # Rust Native Host
│   ├── src/
│   │   ├── main.rs              # 入口
│   │   ├── server.rs            # HTTP 服务器
│   │   ├── log.rs               # 日志系统
│   │   └── tool/                # 工具实现
│   └── Cargo.toml
├── docs/                        # 文档
└── .github/                     # GitHub 配置
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
4. 检查工具栏是否显示「已连接」
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
