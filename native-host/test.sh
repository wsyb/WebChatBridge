#!/bin/bash

# 测试Web Chat Bridge Native Host

set -e

BINARY="./target/release/wcb"

if [ ! -f "$BINARY" ]; then
    echo "Binary not found. Building..."
    cargo build --release
fi

echo "Testing Web Chat Bridge Native Host..."
echo ""

# 创建测试脚本
cat > /tmp/test_native_host.py << 'EOF'
import sys
import struct
import json

def send_message(msg):
    """发送Native Messaging格式的消息"""
    json_str = json.dumps(msg)
    sys.stdout.buffer.write(struct.pack('<I', len(json_str)))
    sys.stdout.buffer.write(json_str.encode())
    sys.stdout.buffer.flush()

def receive_message():
    """接收Native Messaging格式的消息"""
    length_bytes = sys.stdin.buffer.read(4)
    if not length_bytes:
        return None
    length = struct.unpack('<I', length_bytes)[0]
    msg_bytes = sys.stdin.buffer.read(length)
    return json.loads(msg_bytes.decode())

# 测试1: 读取文件
print("Test 1: read_file")
send_message({
    "type": "TOOL_CALL",
    "requestId": 1,
    "tool": "read_file",
    "arguments": {"file_path": "/etc/hostname"}
})
response = receive_message()
print(json.dumps(response, indent=2))
print()

# 测试2: 列出目录
print("Test 2: list_directory")
send_message({
    "type": "TOOL_CALL",
    "requestId": 2,
    "tool": "list_directory",
    "arguments": {"dir_path": "."}
})
response = receive_message()
print(json.dumps(response, indent=2))
print()

# 测试3: 执行命令
print("Test 3: run_shell_command")
send_message({
    "type": "TOOL_CALL",
    "requestId": 3,
    "tool": "run_shell_command",
    "arguments": {"command": "echo Hello World"}
})
response = receive_message()
print(json.dumps(response, indent=2))
print()

print("All tests completed!")
EOF

# 运行测试
python3 /tmp/test_native_host.py | $BINARY 2>/dev/null

rm /tmp/test_native_host.py
