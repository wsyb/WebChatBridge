#!/bin/bash

# Web Chat Bridge Native Host 安装脚本
# 支持 Linux、macOS、Windows (Git Bash/WSL)

set -e

# 颜色定义
RED='\033[0;31m'
GREEN='\033[0;32m'
YELLOW='\033[1;33m'
BLUE='\033[0;34m'
NC='\033[0m' # No Color

# 项目信息
APP_NAME="com.webchatbridge.host"
BINARY_NAME="wcb"

# 检测操作系统
detect_os() {
    case "$(uname -s)" in
        Linux*)     echo "linux";;
        Darwin*)    echo "macos";;
        CYGWIN*|MINGW*|MSYS*) echo "windows";;
        *)          echo "unknown"
    esac
}

# 获取Chrome Native Messaging Hosts目录
get_hosts_dir() {
    local os=$1
    case $os in
        linux)
            local dirs=(
                "$HOME/.config/google-chrome/NativeMessagingHosts"
                "$HOME/.config/chromium/NativeMessagingHosts"
                "$HOME/.config/BraveSoftware/Brave-Browser/NativeMessagingHosts"
                "$HOME/.config/microsoft-edge/NativeMessagingHosts"
            )
            for dir in "${dirs[@]}"; do
                if [ -d "$(dirname "$dir")" ]; then
                    echo "$dir"
                    return
                fi
            done
            echo "${dirs[0]}"
            ;;
        macos)
            local dirs=(
                "$HOME/Library/Application Support/Google/Chrome/NativeMessagingHosts"
                "$HOME/Library/Application Support/Chromium/NativeMessagingHosts"
                "$HOME/Library/Application Support/BraveSoftware/Brave-Browser/NativeMessagingHosts"
                "$HOME/Library/Application Support/Microsoft Edge/NativeMessagingHosts"
            )
            for dir in "${dirs[@]}"; do
                if [ -d "$(dirname "$dir")" ]; then
                    echo "$dir"
                    return
                fi
            done
            echo "${dirs[0]}"
            ;;
        windows)
            echo "$APPDATA/Google/Chrome/NativeMessagingHosts"
            ;;
    esac
}

# 获取二进制文件路径
get_binary_path() {
    local os=$1
    local install_dir=$2
    case $os in
        linux|macos)
            echo "$install_dir/$BINARY_NAME"
            ;;
        windows)
            echo "$install_dir/$BINARY_NAME.exe"
            ;;
    esac
}

# 从现有配置中读取扩展ID
get_existing_extension_id() {
    local manifest_path=$1
    if [ -f "$manifest_path" ]; then
        grep -o '"chrome-extension://[^/]*/"' "$manifest_path" | sed 's/chrome-extension:\/\///' | sed 's/\///' | head -1
    fi
}

# 生成manifest文件
generate_manifest() {
    local binary_path=$1
    local extension_id=$2

    cat <<EOF
{
  "name": "$APP_NAME",
  "description": "Web Chat Bridge Native Messaging Host",
  "path": "$binary_path",
  "type": "stdio",
  "allowed_origins": [
    "chrome-extension://$extension_id/"
  ]
}
EOF
}

# 输入扩展ID
input_extension_id() {
    echo -e "${YELLOW}╔═══════════════════════════════════════════════════════════╗${NC}"
    echo -e "${YELLOW}║                    获取扩展 ID                           ║${NC}"
    echo -e "${YELLOW}╚═══════════════════════════════════════════════════════════╝${NC}"
    echo ""
    echo -e "请按以下步骤获取扩展 ID:"
    echo -e "  1. 打开 Chrome 浏览器"
    echo -e "  2. 访问 ${BLUE}chrome://extensions/${NC}"
    echo -e "  3. 找到 ${GREEN}Web Chat Bridge${NC} 扩展"
    echo -e "  4. 复制扩展 ID (32位字母字符串)"
    echo ""
    echo -e "${YELLOW}示例扩展 ID: hfklelokmfapnejgbieeeoalpcdpmpkn${NC}"
    echo ""

    while true; do
        read -p "$(echo -e ${BLUE}[输入]${NC} 请粘贴扩展 ID: )" EXTENSION_ID
        if [[ "$EXTENSION_ID" =~ ^[a-z]{32}$ ]]; then
            echo -e "${GREEN}[验证]${NC} 扩展 ID 格式正确: $EXTENSION_ID"
            return 0
        else
            echo -e "${RED}[错误]${NC} 扩展 ID 格式不正确，应为32位小写字母"
        fi
    done
}

# 主安装流程
main() {
    echo -e "${GREEN}╔═══════════════════════════════════════════════════════════╗${NC}"
    echo -e "${GREEN}║           Web Chat Bridge Native Host 安装程序              ║${NC}"
    echo -e "${GREEN}╚═══════════════════════════════════════════════════════════╝${NC}"
    echo ""

    # 检测操作系统
    OS=$(detect_os)
    echo -e "${BLUE}[系统检测]${NC} 操作系统: ${YELLOW}$OS${NC}"

    # 获取安装目录
    INSTALL_DIR="$HOME/.webchatbridge"
    HOSTS_DIR=$(get_hosts_dir $OS)
    BINARY_PATH=$(get_binary_path $OS $INSTALL_DIR)
    MANIFEST_PATH="$HOSTS_DIR/$APP_NAME.json"

    echo -e "${BLUE}[路径配置]${NC} 安装目录: ${YELLOW}$INSTALL_DIR${NC}"
    echo -e "${BLUE}[路径配置]${NC} Hosts目录: ${YELLOW}$HOSTS_DIR${NC}"
    echo ""

    # 创建目录
    mkdir -p "$INSTALL_DIR"
    mkdir -p "$HOSTS_DIR"

    # 编译或更新二进制文件
    SCRIPT_DIR="$(cd "$(dirname "$0")" && pwd)"

    # 先编译最新版本
    echo -e "${YELLOW}[编译]${NC} 正在编译最新版本..."
    cd "$SCRIPT_DIR"
    cargo build --release
    echo -e "${GREEN}[编译]${NC} 编译完成!"

    # 停止运行中的进程
    pkill -f "$BINARY_NAME" 2>/dev/null || true
    sleep 1

    # 覆盖安装
    echo -e "${YELLOW}[安装]${NC} 正在安装到 $BINARY_PATH..."
    rm -f "$BINARY_PATH"
    cp "target/release/$BINARY_NAME" "$BINARY_PATH"
    chmod +x "$BINARY_PATH"
    echo -e "${GREEN}[安装]${NC} 安装完成!"

    echo ""

    # 检查是否已有配置
    EXISTING_ID=$(get_existing_extension_id "$MANIFEST_PATH")

    if [ -n "$EXISTING_ID" ]; then
        echo -e "${GREEN}[配置]${NC} 检测到已有配置，当前扩展ID: ${YELLOW}$EXISTING_ID${NC}"
        echo -e "${BLUE}[提示]${NC} 如需更新扩展ID，请输入 y，否则直接回车跳过"
        echo ""
        read -p "$(echo -e ${BLUE}[选择]${NC} 是否更新扩展ID? [y/N]: )" UPDATE_NOW

        if [[ "$UPDATE_NOW" =~ ^[Yy]$ ]]; then
            input_extension_id
            generate_manifest "$BINARY_PATH" "$EXTENSION_ID" > "$MANIFEST_PATH"
            echo -e "${GREEN}[配置]${NC} Manifest 已更新"
        else
            echo -e "${GREEN}[配置]${NC} 保留当前配置"
        fi
    else
        # 首次安装，需要输入扩展ID
        input_extension_id
        generate_manifest "$BINARY_PATH" "$EXTENSION_ID" > "$MANIFEST_PATH"
        echo -e "${GREEN}[配置]${NC} Manifest 已生成"
    fi

    echo ""

    # 显示配置内容
    echo -e "${BLUE}[配置]${NC} Manifest 内容:"
    cat "$MANIFEST_PATH"
    echo ""

    # 验证安装
    echo -e "${BLUE}[验证]${NC} 检查安装状态..."

    if [ -f "$BINARY_PATH" ]; then
        echo -e "${GREEN}[验证]${NC} ✓ 二进制文件存在"
    else
        echo -e "${RED}[验证]${NC} ✗ 二进制文件不存在"
        exit 1
    fi

    if [ -f "$MANIFEST_PATH" ]; then
        echo -e "${GREEN}[验证]${NC} ✓ Manifest文件存在"
    else
        echo -e "${RED}[验证]${NC} ✗ Manifest文件不存在"
        exit 1
    fi

    echo ""
    echo -e "${GREEN}╔═══════════════════════════════════════════════════════════╗${NC}"
    echo -e "${GREEN}║                    安装完成!                             ║${NC}"
    echo -e "${GREEN}╚═══════════════════════════════════════════════════════════╝${NC}"
    echo ""
    echo -e "接下来请:"
    echo -e "  1. 刷新 Chrome 扩展页面"
    echo -e "  2. 点击 ${GREEN}重新加载${NC} 按钮"
    echo -e "  3. 开始使用!"
    echo ""

    # 显示日志路径
    case $OS in
        linux|macos)
            echo -e "${YELLOW}[日志文件]${NC} /tmp/webchatbridge.log"
            ;;
        windows)
            echo -e "${YELLOW}[日志文件]${NC} %TEMP%\\webchatbridge.log"
            ;;
    esac

    echo -e "${YELLOW}[卸载命令]${NC} rm -rf $INSTALL_DIR $MANIFEST_PATH"
    echo ""
}

# 运行主程序
main "$@"
