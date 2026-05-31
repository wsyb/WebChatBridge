# 安装指南

## 前置要求

- Chrome 浏览器（或基于 Chromium 的浏览器）
- Rust 工具链（用于编译 Native Host）
- Node.js（用于构建扩展）

## 1. 编译 Chrome 扩展

```bash
cd extension
npm install
npm run build
```

构建产物在 `dist/` 目录。

## 2. 加载 Chrome 扩展

1. 打开 Chrome，地址栏输入 `chrome://extensions/`
2. 右上角启用"开发者模式"
3. 点击"加载已解压的扩展程序"
4. 选择 `extension` 目录
5. 页面上会显示扩展 ID（32 位字母字符串），**复制保存**

## 3. 编译 Native Host

```bash
cd native-host
cargo build --release
```

编译产物在 `target/release/WebChatBridge-native-host`。

## 4. 安装 Native Host

### Linux / macOS

```bash
cd native-host
chmod +x install.sh
./install.sh
# 按提示粘贴扩展 ID
```

### Windows (Git Bash / WSL)

```bash
cd native-host
./install.sh
# 按提示粘贴扩展 ID
```

### Windows (CMD / PowerShell)

```cmd
cd native-host
install.bat
# 按提示粘贴扩展 ID
```

安装脚本会自动：
- 检测操作系统和浏览器
- 生成 manifest 文件
- 注册 Native Messaging Host

## 5. 启动 Native Host 服务

Native Host 以 HTTP 服务器模式运行，监听 `localhost:18789`：

```bash
cd native-host
./target/release/WebChatBridge-native-host
```

## 6. 验证安装

1. 打开 DeepSeek / Kimi / 豆包网页
2. 页面顶部出现浮动工具栏
3. 工具栏显示"已连接"
4. 点击"注入提示词"
5. 在对话框输入需求，AI 会自动执行

## 常见安装问题

### 扩展加载后看不到工具栏

- 检查扩展是否已启用
- 检查当前页面是否是支持的平台
- 刷新页面重试

### 工具栏显示"未连接"

- Native Host 服务是否在运行
- 端口 18789 是否被占用
- 检查 Native Host 日志

### 注入提示词失败

- 检查输入框是否可编辑
- 尝试手动点击输入框后再注入
