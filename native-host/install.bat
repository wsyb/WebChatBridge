@echo off
chcp 65001 >nul
setlocal enabledelayedexpansion

echo ╔═══════════════════════════════════════════════════════════╗
echo ║           Web Chat Bridge Native Host 安装程序              ║
echo ╚═══════════════════════════════════════════════════════════╝
echo.

REM 检测操作系统
echo [系统检测] 操作系统: Windows

REM 获取安装目录
set INSTALL_DIR=%USERPROFILE%\.webchatbridge
set HOSTS_DIR=%APPDATA%\Google\Chrome\NativeMessagingHosts
set BINARY_NAME=wcb.exe

echo [路径配置] 安装目录: %INSTALL_DIR%
echo [路径配置] Hosts目录: %HOSTS_DIR%
echo.

REM 创建目录
if not exist "%INSTALL_DIR%" mkdir "%INSTALL_DIR%"
if not exist "%HOSTS_DIR%" mkdir "%HOSTS_DIR%"

REM 编译最新版本
echo [编译] 正在编译最新版本...
cd /d "%~dp0"
cargo build --release
if errorlevel 1 (
    echo [错误] 编译失败
    pause
    exit /b 1
)
echo [编译] 编译完成!

REM 停止运行中的进程
taskkill /f /im %BINARY_NAME% 2>nul

REM 覆盖安装
echo [安装] 正在安装到 %INSTALL_DIR%\%BINARY_NAME%...
copy /y "target\release\%BINARY_NAME%" "%INSTALL_DIR%\%BINARY_NAME%"
echo [安装] 安装完成!

echo.
echo ╔═══════════════════════════════════════════════════════════╗
echo ║                    获取扩展 ID                           ║
echo ╚═══════════════════════════════════════════════════════════╝
echo.
echo 请按以下步骤获取扩展 ID:
echo   1. 打开 Chrome 浏览器
echo   2. 访问 chrome://extensions/
echo   3. 找到 Web Chat Bridge 扩展
echo   4. 复制扩展 ID (32位字母字符串)
echo.
echo 示例扩展 ID: hfklelokmfapnejgbieeeoalpcdpmpkn
echo.

:input_id
set /p EXTENSION_ID=[输入] 请粘贴扩展 ID:

REM 验证扩展ID长度
set ID_LEN=0
for /l %%i in (0,1,31) do set /a ID_LEN+=1

if !ID_LEN! equ 32 (
    echo [验证] 扩展 ID 格式正确: %EXTENSION_ID%
    goto :write_manifest
) else (
    echo [错误] 扩展 ID 格式不正确，应为32位小写字母
    echo [提示] 示例: hfklelokmfapnejgbieeeoalpcdpmpkn
    goto :input_id
)

:write_manifest
echo.
echo [配置] 生成manifest文件...

REM 获取二进制文件完整路径
set BINARY_PATH=%INSTALL_DIR%\%BINARY_NAME%
set MANIFEST_PATH=%HOSTS_DIR%\com.webchatbridge.host.json

REM 生成JSON文件
(
echo {
echo   "name": "com.webchatbridge.host",
echo   "description": "Web Chat Bridge Native Messaging Host",
echo   "path": "%BINARY_PATH:\=/%",
echo   "type": "stdio",
echo   "allowed_origins": [
echo     "chrome-extension://%EXTENSION_ID%/"
echo   ]
echo }
) > "%MANIFEST_PATH%"

echo [配置] Manifest 内容:
type "%MANIFEST_PATH%"
echo.

REM 验证安装
echo [验证] 检查安装状态...

if exist "%BINARY_PATH%" (
    echo [验证] ✓ 二进制文件存在
) else (
    echo [验证] ✗ 二进制文件不存在
    pause
    exit /b 1
)

if exist "%MANIFEST_PATH%" (
    echo [验证] ✓ Manifest文件存在
) else (
    echo [验证] ✗ Manifest文件不存在
    pause
    exit /b 1
)

echo.
echo ╔═══════════════════════════════════════════════════════════╗
echo ║                    安装完成!                             ║
echo ╚═══════════════════════════════════════════════════════════╝
echo.
echo 接下来请:
echo   1. 刷新 Chrome 扩展页面
echo   2. 点击 重新加载 按钮
echo   3. 开始使用!
echo.
echo [日志文件] %TEMP%\webchatbridge.log
echo [卸载命令] rmdir /s /q %INSTALL_DIR% && del "%MANIFEST_PATH%"
echo.
pause
