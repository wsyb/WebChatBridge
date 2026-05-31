# Web Chat Bridge

让网页版 AI 助手直接操作你的电脑——读写文件、执行命令、管理后台任务。

## 它能做什么

你在浏览器里和 AI 对话，告诉它"帮我建一个 Flask 应用"，AI 会自动在你电脑上创建文件、安装依赖、启动服务器，全程无需你手动操作。

AI 通过输出特定格式的代码块来下达指令，浏览器扩展检测到后自动在本地执行，再把结果返回给 AI 继续工作。

## 支持的平台

| 平台 | 状态 |
|------|------|
| [DeepSeek](https://chat.deepseek.com) | ✅ 完整支持 |
| [Kimi](https://kimi.moonshot.cn) | ✅ 完整支持 |
| [豆包](https://www.doubao.com) | ✅ 完整支持 |

## 工作原理

四个角色协作：

```
用户 ←→ AI（网页对话）←→ Chrome 扩展 ←→ Native Host（本地执行）
```

1. 用户在 AI 网页对话框输入需求
2. AI 分析需求，输出 tool_call 代码块
3. Chrome 扩展检测到代码块，解析出工具名和参数
4. 扩展通过 HTTP 发送给 Native Host（Rust 程序）
5. Native Host 在本地执行操作，返回结果
6. 扩展把结果注入回 AI 对话框
7. AI 看到结果，继续下一步

详细架构说明见 [docs/architecture.md](docs/architecture.md)

## 安装

### 1. 加载 Chrome 扩展

1. 打开 Chrome，访问 `chrome://extensions/`
2. 启用"开发者模式"
3. 点击"加载已解压的扩展程序"
4. 选择 `extension` 目录
5. 复制扩展 ID（32 位字母字符串）

### 2. 编译并安装 Native Host

```bash
cd native-host

# 编译
cargo build --release

# 安装（会提示输入扩展 ID）
./install.sh
```

Windows 用户用 `install.bat` 替代 `install.sh`。

### 3. 使用

1. 打开 DeepSeek / Kimi / 豆包的网页
2. 页面顶部出现浮动工具栏
3. 点击"注入提示词"
4. 在对话框输入你的需求，AI 会自动执行

详细安装说明见 [docs/installation.md](docs/installation.md)

## 可用工具

| 工具 | 说明 |
|------|------|
| `ls` | 列出目录 |
| `read` | 读取文件 |
| `write` | 写入文件 |
| `edit` | 编辑文件 |
| `grep` | 搜索文本 |
| `glob` | 搜索文件 |
| `run_shell_command` | 执行短命令 |
| `task_start` | 启动后台任务 |
| `task_list` | 列出后台任务 |
| `task_logs` | 查看任务日志 |
| `task_kill` | 终止后台任务 |
| `task_restart` | 重启后台任务 |

## 已知限制

这个项目有一些架构层面的限制，不是 bug，是当前方案的固有边界：

- **依赖 AI 输出格式**：AI 必须按提示词规定的格式输出 tool_call 代码块，我们只能通过提示词约束，不能强制
- **不同平台 DOM 结构不同**：每个 AI 平台的网页结构不同，需要单独写适配器
- **文本协议脆弱**：用 `===` 和 `<<<>>>` 做分隔符，内容中出现这些符号会解析错误，没有转义机制
- **流式输出可能不完整**：AI 逐字输出时，tool_call 代码块可能还没写完就被检测到
- **AI 可能不遵守提示词**：概率性问题，AI 有时会忽略提示词中的约束

详细说明见 [docs/limitations.md](docs/limitations.md)

## 开发

### 项目结构

```
WebChatBridge/
├── extension/                   # Chrome 扩展
│   ├── src/
│   │   ├── adapters/            # 平台适配器
│   │   ├── agent/               # Agent Loop 核心循环
│   │   ├── detector/            # tool_call 检测和解析
│   │   ├── prompts/             # 提示词模板
│   │   └── core/                # 基础设施
│   └── dist/                    # 构建产物
├── native-host/                 # Rust Native Host
│   └── src/
│       └── tool/
│           ├── task_manager.rs  # 后台任务管理
│           └── ...
└── docs/                        # 文档
```

### 添加新平台适配器

1. 在 `extension/src/adapters/impl/` 创建新适配器
2. 实现三个核心接口：`isGenerating()`、`getLastAIMessageElement()`、`findSendButton()`
3. 在 `content/index.ts` 中注册适配器
4. 在 `manifest.json` 中添加域名权限
5. 在 `prompts/templates.ts` 中添加提示词模板

详细开发指南见 [docs/development.md](docs/development.md)

## 许可证

MIT License
