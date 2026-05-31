# Web Chat Bridge

让网页版 AI 助手直接操作你的电脑——读写文件、执行命令、管理后台任务。

## 它能做什么

你在浏览器里和 AI 对话，告诉它"帮我建一个 Flask 应用"，AI 会自动在你电脑上创建文件、安装依赖、启动服务器，全程无需你手动操作。

AI 通过输出特定格式的代码块来下达指令，浏览器扩展检测到后自动在本地执行，再把结果返回给 AI 继续工作。

## 支持的平台

| 平台 | 状态 |
|------|------|
| [DeepSeek](https://chat.deepseek.com) | ✅ 完整支持（最佳兼容） |
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

## 快速安装

### 第一步：下载

前往 [GitHub Releases](https://github.com/wsyb/WebChatBridge/releases) 下载：

- **Native Host**：选择对应你操作系统的 `wcb` 二进制文件
- **Chrome 扩展**：下载 `webchatbridge-extension.zip`

### 第二步：安装 Native Host

将 `wcb` 复制到你的 PATH 目录：

**Linux / macOS：**

```bash
# 创建目录（如果不存在）
mkdir -p ~/.local/bin

# 复制并赋予执行权限
cp wcb ~/.local/bin/wcb
chmod +x ~/.local/bin/wcb
```

**Windows (PowerShell)：**

```powershell
# 复制到 PATH 目录
Copy-Item wcb.exe $env:LOCALAPPDATA\Microsoft\WindowsApps\
```

### 第三步：加载 Chrome 扩展

1. 打开 Chrome，访问 `chrome://extensions/`
2. 启用「开发者模式」
3. 点击「加载已解压的扩展程序」
4. 选择解压后的扩展目录

### 第四步：启动并使用

```bash
# 启动 Native Host 服务器（默认监听 127.0.0.1:18789）
wcb
```

然后：

1. 打开 DeepSeek / Kimi / 豆包的网页
2. 页面顶部出现浮动工具栏
3. 点击「注入提示词」
4. 在对话框输入你的需求，AI 会自动执行

### 命令行参数

```bash
wcb                           # 默认：127.0.0.1:18789
wcb --port 19999              # 自定义端口
wcb --host 0.0.0.0 --port 18789  # 监听所有网络接口（支持远程连接）
wcb --help                    # 查看帮助
```

## 远程操控

WebChatBridge 支持远程操控：将 Native Host 部署在远程机器上，Chrome 扩展通过网络连接执行操作。

### 使用方式

**远程机器（服务端）：**

```bash
# 启动时监听所有网络接口
wcb --host 0.0.0.0 --port 18789
```

**本地电脑（客户端）：**

1. 打开扩展设置（点击工具栏图标 → 设置）
2. 配置 Native Host 地址：`远程机器IP:端口`（如 `192.168.1.100:18789`）
3. 保存后刷新 AI 聊天页面

### 网络要求

- 远程机器需要开放指定端口（默认 18789）
- 确保防火墙允许该端口的入站连接
- 建议在同一局域网内使用，或通过 VPN 连接

### 安全注意事项

- ⚠️ 远程模式会暴露命令执行能力，请确保网络环境安全
- ⚠️ 不建议直接暴露在公网，建议通过 VPN 或 SSH 隧道
- ⚠️ Native Host 无认证机制，任何能访问该端口的客户端都可执行命令
- 生产环境建议配合 SSH 隧道使用：`ssh -L 18789:localhost:18789 user@remote-host`

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
- **单窗口使用**：同一时间只能在一个 AI 聊天窗口中使用，不支持多窗口并发
- **串行执行**：tool_call 必须一个一个执行，不支持并行

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
