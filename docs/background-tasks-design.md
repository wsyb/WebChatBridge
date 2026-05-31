# Background Tasks 设计文档

## 1. 问题

当前 `shell` 工具有 60 秒超时，进程会被 kill。无法运行持久任务（Flask 服务器、webpack dev server、docker 容器等）。

## 2. 目标

- 支持后台启动持久进程
- 跨平台（Linux / macOS / Windows）
- 任务生命周期管理：查看、日志、停止、重启
- 进程退出后保留日志，可事后查看
- 任务注册表在 native host 运行期间持久化

## 3. 架构

```
Extension (TypeScript)
    │
    │  HTTP API 调用
    ▼
Native Host (Rust)
    │
    ├── ToolRegistry
    │   ├── shell (现有，60s 超时)
    │   ├── task_start (新)
    │   ├── task_list (新)
    │   ├── task_logs (新)
    │   ├── task_kill (新)
    │   └── task_restart (新)
    │
    └── TaskManager (新，Arc<Mutex<>>)
        ├── TaskEntry { id, command, pid, status, logs, start_time }
        ├── stdout log file per task
        ├── stderr log file per task
        └── 跨平台进程管理
```

## 4. TaskManager 设计

### 4.1 数据结构

```rust
pub struct TaskManager {
    tasks: HashMap<String, TaskEntry>,
    data_dir: PathBuf,  // ~/.webchatbridge/tasks/
}

pub struct TaskEntry {
    pub id: String,           // UUID 或简短 ID
    pub command: String,      // 原始命令
    pub pid: Option<u32>,     // 进程 PID（Windows 用 HANDLE）
    pub status: TaskStatus,   // Running / Exited / Killed
    pub exit_code: Option<i32>,
    pub start_time: DateTime<Utc>,
    pub end_time: Option<DateTime<Utc>>,
    pub stdout_path: PathBuf, // 日志文件路径
    pub stderr_path: PathBuf,
}

pub enum TaskStatus {
    Running,
    Exited,
    Killed,
}
```

### 4.2 存储结构

```
~/.webchatbridge/tasks/
├── <task-id>/
│   ├── meta.json          # TaskEntry 序列化
│   ├── stdout.log         # stdout 日志（追加写入）
│   └── stderr.log         # stderr 日志（追加写入）
```

### 4.3 跨平台进程管理

| 操作 | Linux/macOS | Windows |
|------|------------|---------|
| 启动 | `Command::new("sh").arg("-c").arg(cmd)` | `Command::new("cmd").arg("/C").arg(cmd)` |
| 获取 PID | `child.id()` | `child.id()` |
| 检查存活 | `kill(pid, 0)` / `waitpid(WNOHANG)` | `OpenProcess` + `WaitForSingleObject` |
| 杀进程 | `kill(pid, SIGTERM)` → 等 2s → `kill(pid, SIGKILL)` | `TerminateProcess` |
| 杀进程树 | `kill(-pid, SIGTERM)` (进程组) | `taskkill /T /PID` |

### 4.4 进程启动方式

```
Linux/macOS:
  sh -c "nohup command > stdout.log 2> stderr.log &"

Windows:
  cmd /C "start /B command > stdout.log 2> stderr.log"
```

关键：用 `nohup` / `start /B` 让进程脱离父进程，这样 native host 不会等待它退出。

### 4.5 进程监控

TaskManager 启动一个后台 tokio task，每 5 秒检查一次：
- 遍历 Running 状态的任务
- 检查进程是否存活
- 如果退出，更新状态为 Exited，记录 exit_code 和 end_time

## 5. API 设计

### 5.1 task_start

```json
// 请求
{
  "command": "cd /home/fy/temp && python3 app.py",
  "cwd": "/home/fy/temp"           // 可选，默认 working_dir
}

// 响应
{
  "task_id": "a1b2c3d4",
  "pid": 12345,
  "status": "running",
  "message": "Task started in background"
}
```

### 5.2 task_list

```json
// 请求：无参数

// 响应
{
  "tasks": [
    {
      "id": "a1b2c3d4",
      "command": "python3 app.py",
      "status": "running",
      "pid": 12345,
      "uptime": "5m 30s",
      "start_time": "2026-05-30T08:00:00Z"
    },
    {
      "id": "e5f6g7h8",
      "command": "npm run dev",
      "status": "exited",
      "exit_code": 0,
      "start_time": "2026-05-30T07:30:00Z",
      "end_time": "2026-05-30T07:45:00Z"
    }
  ],
  "total": 2
}
```

### 5.3 task_logs

```json
// 请求
{
  "task_id": "a1b2c3d4",
  "tail": 100              // 可选，默认全部，返回最后 N 行
}

// 响应
{
  "task_id": "a1b2c3d4",
  "command": "python3 app.py",
  "status": "running",
  "stdout": " * Running on http://0.0.0.0:5000\n * Press CTRL+C to quit\n",
  "stderr": ""
}
```

### 5.4 task_kill

```json
// 请求
{
  "task_id": "a1b2c3d4"
}

// 响应
{
  "task_id": "a1b2c3d4",
  "status": "killed",
  "message": "Task terminated"
}
```

### 5.5 task_restart

```json
// 请求
{
  "task_id": "a1b2c3d4"    // 可选，不传则启动新的
}

// 响应
{
  "task_id": "i9j0k1l2",   // 新的 task_id
  "pid": 12346,
  "status": "running",
  "message": "Task restarted"
}
```

## 6. Tool 实现

### 6.1 文件结构

```
native-host/src/tool/
├── task_start.rs    # 启动后台任务
├── task_list.rs     # 列出任务
├── task_logs.rs     # 查看日志
├── task_kill.rs     # 停止任务
├── task_restart.rs  # 重启任务
└── task_manager.rs  # TaskManager 核心逻辑
```

### 6.2 注册

在 `ToolRegistry::new()` 中添加 5 个新工具。

### 6.3 TaskManager 共享

TaskManager 需要跨工具共享（Arc<Mutex<TaskManager>>），通过 ToolContext 传递。

修改 Tool trait：
```rust
pub trait Tool: Send + Sync {
    fn name(&self) -> &str;
    fn description(&self) -> &str;
    fn parameters_schema(&self) -> Value;
    async fn execute(&self, input: Value, ctx: ToolContext) -> Result<ToolOutput>;
}
```

ToolContext 扩展：
```rust
pub struct ToolContext {
    pub working_dir: Option<PathBuf>,
    pub task_manager: Option<Arc<Mutex<TaskManager>>>,  // 新增
}
```

## 7. 安全考虑

- 任务只能在 working_dir 下运行（防止任意命令执行）
- 最大并发任务数：10
- 单个日志文件最大 10MB（超过后轮转）
- 进程退出后日志保留 24 小时
- native host 关闭时 kill 所有 Running 任务

## 8. 实现顺序

1. TaskManager 核心（数据结构 + 进程管理）
2. task_start 工具
3. task_list 工具
4. task_logs 工具
5. task_kill 工具
6. task_restart 工具
7. 进程监控后台 task
8. 优雅关闭（Ctrl+C 时 kill 所有任务）
9. TypeScript 端适配（extension 调用新工具）
