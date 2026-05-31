# Web Chat Bridge 渐进式测试记录

## 测试环境
- 浏览器: Chrome
- 目标站点: DeepSeek (https://chat.deepseek.com/)
- 扩展版本: 0.2.0
- 测试日期: 2026-05-29

---

## 阶段一：基础工具测试

### 测试 1.1: ls - 列出目录
- **状态**: ✅ 通过
- **步骤**: 向 DeepSeek 发送"列出 /tmp 目录下的文件"
- **结果**: 扩展检测到 tool_call，执行 ls /tmp，返回文件列表，结果注入成功，AI 正确总结
- **问题**: 无

### 测试 1.2: read - 读取文件
- **状态**: ✅ 通过
- **步骤**: 向 DeepSeek 发送"读取 /etc/hostname 文件内容"
- **结果**: 扩展执行 read /etc/hostname，返回文件内容，AI 正确展示
- **问题**: 无

### 测试 1.3: write - 写入文件
- **状态**: ✅ 通过
- **步骤**: 向 DeepSeek 发送"创建文件 /tmp/test-webchatbridge.txt 内容为 Hello Web Chat Bridge"
- **结果**: 扩展执行 write，文件创建成功，AI 确认文件已创建
- **问题**: 无

### 测试 1.4: edit - 编辑文件
- **状态**: ✅ 通过
- **步骤**: 向 DeepSeek 发送"将 /tmp/test-webchatbridge.txt 中的 Hello 替换为 Hi"
- **结果**: 扩展执行 edit，替换成功，AI 确认内容已修改
- **问题**: 无

### 测试 1.5: grep - 搜索内容
- **状态**: ✅ 通过
- **步骤**: 向 DeepSeek 发送"在 /tmp 目录下搜索包含 'Web Chat Bridge' 的文件"
- **结果**: 扩展执行 grep，找到匹配文件，AI 正确展示搜索结果
- **问题**: 无

### 测试 1.6: glob - 查找文件
- **状态**: ✅ 通过
- **步骤**: 向 DeepSeek 发送"在 /tmp 目录下查找所有 .txt 文件"
- **结果**: 扩展执行 glob，找到 test-webchatbridge.txt，AI 正确总结
- **问题**: 无

### 测试 1.7: run_shell_command - 执行命令
- **状态**: ✅ 通过
- **步骤**: 向 DeepSeek 发送"执行 shell 命令 date 看看当前时间"
- **结果**: 扩展执行 `date`，返回 "2026年 05月 29日 星期五 13:29:55 CST"，AI 正确展示
- **问题**: 无

---

## 阶段二：中级测试

### 测试 2.1: 多工具串联
- **状态**: 🔧 修复中
- **描述**: ls → read → edit 组合操作
- **步骤**: 
- **结果**: 
- **问题**: 发现旧 tool_call 执行 bug — 页面刷新后 periodic scan 执行了上一轮对话遗留的旧 tool_call，且新 tool_call 因 hash 相同被错误过滤

### Bug 修复记录

**Bug #1: 旧 tool_call 误执行 + hash 碰撞（严重）**
- **现象**: 页面刷新后，periodic scan 执行了上一轮对话的旧 `run_shell_command`，导致新 `ls` 的结果被错误覆盖
- **根因**: 启动宽限期内 periodic scan 已开始运行，执行了旧 tool_call；新 tool_call 与旧 tool_call 同 hash 被过滤
- **修复**: 
  1. 新增 `startupSnapshot` — 启动时捕获页面上所有已存在 tool_call 的 hash
  2. periodic scan 和 processMutations 均跳过 startupSnapshot 中的 hash
  3. periodic scan 延迟到启动宽限期结束后才启动
- **文件**: `src/content/observer.ts`

**Bug #2: ToolResult 类型缺少 content 字段**
- **现象**: Native host 返回 `{ content: "...", success: true }` 但接口只有 `stdout`/`data`，导致注入内容包含 `{"content":"...","success":true}`
- **修复**: 
  1. `ToolResult` 接口新增 `content?: string` 字段
  2. 结果提取优先级: `stdout > content > data > JSON.stringify(result)`
- **文件**: `src/core/types.ts`, `src/content/index.ts`

---

## 阶段三：高级测试

### 测试 3.1: 多轮对话工具调用
- **状态**: 待测试
- **描述**: 连续多轮对话中触发工具调用
- **步骤**: 
- **结果**: 
- **问题**: 

### 测试 3.2: 复杂工作流
- **状态**: 待测试
- **描述**: read → 分析 → edit → 验证
- **步骤**: 
- **结果**: 
- **问题**: 

---

## 阶段四：终极测试 - 项目构建

### 测试 4.1: 构建简单项目
- **状态**: 待测试
- **描述**: 通过多轮对话让 AI 构建一个简单项目（TODO 应用 / 计算器 / 小游戏）
- **步骤**: 
- **结果**: 
- **问题**: 

---

## 总结
- 总测试数: 7
- 通过: 7
- 失败: 0
- 修复: 0
