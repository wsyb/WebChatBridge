# 安装指南

## 前置要求

- Chrome 浏览器（或基于 Chromium 的浏览器）
- Rust 工具链（用于编译 Native Host，可选）
- Node.js（用于构建扩展，可选）

## 方式一：下载预编译版本（推荐）

### 1. 下载

前往 [GitHub Releases](https://github.com/wsyb/WebChatBridge/releases) 下载：

- **Native Host**：选择对应你操作系统的 `wcb` 二进制文件
- **Chrome 扩展**：下载 `webchatbridge-extension.zip`

### 2. 安装 Native Host

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

### 3. 加载 Chrome 扩展

1. 解压 `webchatbridge-extension.zip`
2. 打开 Chrome，访问 `chrome://extensions/`
3. 启用「开发者模式」
4. 点击「加载已解压的扩展程序」
5. 选择解压后的扩展目录

### 4. 启动并使用

```bash
# 启动 Native Host 服务器
wcb
```

然后：

1. 打开 DeepSeek / Kimi / 豆包的网页
2. 页面顶部出现浮动工具栏
3. 点击「注入提示词」
4. 在对话框输入你的需求，AI 会自动执行

## 方式二：从源码编译

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

### 3. 编译 Native Host

```bash
cd native-host
cargo build --release
```

### 4. 安装 Native Host

将编译产物复制到 PATH 目录：

**Linux / macOS：**

```bash
cp target/release/wcb ~/.local/bin/wcb
chmod +x ~/.local/bin/wcb
```

**Windows (PowerShell)：**

```powershell
Copy-Item target\release\wcb.exe $env:LOCALAPPDATA\Microsoft\WindowsApps\
```

### 5. 加载 Chrome 扩展

1. 打开 Chrome，访问 `chrome://extensions/`
2. 启用「开发者模式」
3. 点击「加载已解压的扩展程序」
4. 选择 `extension` 目录

### 6. 启动并使用

```bash
wcb
```

## 验证安装

1. 打开 DeepSeek / Kimi / 豆包网页
2. 页面顶部出现浮动工具栏
3. 工具栏显示「已连接」
4. 点击「注入提示词」
5. 在对话框输入需求，AI 会自动执行

## 常见问题

### 扩展加载后看不到工具栏

- 检查扩展是否已启用
- 检查当前页面是否是支持的平台
- 刷新页面重试

### 工具栏显示「未连接」

- Native Host 服务是否在运行（执行 `wcb` 启动）
- 端口 18789 是否被占用

### 注入提示词失败

- 检查输入框是否可编辑
- 尝试手动点击输入框后再注入
