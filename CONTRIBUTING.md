# 贡献指南

感谢你对 WebChatBridge 的关注！本文档将帮助你参与项目开发。

## 如何贡献

### 报告 Bug

1. 在 [GitHub Issues](https://github.com/wsyb/WebChatBridge/issues) 搜索是否已有相同问题
2. 如果没有，点击「New Issue」选择「Bug Report」模板
3. 填写问题描述、复现步骤、预期行为、实际行为
4. 附上浏览器版本、操作系统、扩展版本等信息

### 提出功能建议

1. 在 [GitHub Issues](https://github.com/wsyb/WebChatBridge/issues) 搜索是否已有相同建议
2. 如果没有，点击「New Issue」选择「Feature Request」模板
3. 描述你想要的功能、使用场景、期望行为

### 提交代码

#### 1. Fork 仓库

点击 GitHub 页面右上角的「Fork」按钮。

#### 2. Clone 到本地

```bash
git clone https://github.com/你的用户名/WebChatBridge.git
cd WebChatBridge
```

#### 3. 创建功能分支

```bash
git checkout -b feat/your-feature-name
```

分支命名规范：
- `feat/xxx` — 新功能
- `fix/xxx` — 修复 bug
- `docs/xxx` — 文档更新
- `refactor/xxx` — 重构

#### 4. 安装依赖并构建

```bash
# 扩展
cd extension
npm install
npm run build

# Native Host
cd ../native-host
cargo build
```

#### 5. 修改代码

- 遵循项目代码规范（见 `docs/development.md`）
- 保持提交信息清晰（遵循 Conventional Commits）
- 如果添加新功能，请添加测试

#### 6. 提交更改

```bash
git add .
git commit -m "feat: 添加你的功能描述"
```

#### 7. 推送到你的 Fork

```bash
git push origin feat/your-feature-name
```

#### 8. 创建 Pull Request

1. 打开你的 Fork 页面
2. 点击「Compare & pull request」
3. 填写 PR 描述，说明你做了什么、为什么做、如何测试
4. 提交 PR

## 开发环境

详细开发环境配置见 [docs/development.md](docs/development.md)。

### 快速开始

```bash
# 克隆仓库
git clone https://github.com/wsyb/WebChatBridge.git
cd WebChatBridge

# 安装扩展依赖并构建
cd extension && npm install && npm run build

# 编译 Native Host
cd ../native-host && cargo build
```

## 代码规范

### 提交信息

遵循 [Conventional Commits](https://www.conventionalcommits.org/)：

```
<type>(<scope>): <description>
```

示例：
- `feat(doubao): 添加豆包平台适配器`
- `fix(agent-loop): 修复 tool_call 检测失败`
- `docs: 更新安装指南`

### 代码格式

- TypeScript：运行 `npm run format`
- Rust：运行 `cargo fmt`

### 代码检查

- TypeScript：运行 `npm run lint`
- Rust：运行 `cargo clippy`

## 添加新平台适配器

这是最常见的贡献方式。详细步骤见 [docs/development.md](docs/development.md)。

简要流程：
1. 在 `extension/src/adapters/impl/` 创建新适配器
2. 实现三个核心接口：`isGenerating()`、`getLastAIMessageElement()`、`findSendButton()`
3. 在 `content/index.ts` 注册适配器
4. 在 `manifest.json` 添加域名权限
5. 在 `prompts/templates.ts` 添加提示词模板

## 问题排查

如果遇到问题：

1. 查看 [docs/development.md](docs/development.md) 中的 Agent Loop 执行链路
2. 检查浏览器控制台日志
3. 检查 Native Host 日志（`/tmp/webchatbridge.log`）
4. 在 GitHub Issues 搜索类似问题

## 行为准则

- 尊重每一位贡献者
- 接受建设性的批评
- 专注于对社区最有利的事情
- 对其他社区成员表示同理心

## 许可证

贡献代码即表示你同意你的代码在 MIT 协议下发布。
