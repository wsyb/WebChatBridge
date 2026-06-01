use anyhow::{Context, Result};
use serde::{Deserialize, Serialize};
use std::collections::HashMap;
use std::path::{Path, PathBuf};
use std::process::Stdio;
use std::sync::Arc;
use tokio::io::AsyncWriteExt;
use tokio::process::Command;
use tokio::sync::Mutex;
use uuid::Uuid;

// ============================================================
// 数据结构
// ============================================================

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct TaskEntry {
    pub id: String,
    pub command: String,
    pub cwd: Option<String>,
    pub pid: Option<u32>,
    pub status: TaskStatus,
    pub exit_code: Option<i32>,
    pub start_time: String,
    pub end_time: Option<String>,
    pub stdout_path: PathBuf,
    pub stderr_path: PathBuf,
}

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq)]
#[serde(rename_all = "lowercase")]
pub enum TaskStatus {
    Running,
    Exited,
    Killed,
}

/// 同步等待窗口（秒）：启动后等待此时间，如果进程已退出则立即返回结果
const SYNC_WAIT_SECS: u64 = 3;

// ============================================================
// TaskManager
// ============================================================

pub struct TaskManager {
    tasks: HashMap<String, TaskEntry>,
    data_dir: PathBuf,
    max_tasks: usize,
}

impl TaskManager {
    pub fn new(data_dir: PathBuf) -> Self {
        let _ = std::fs::create_dir_all(&data_dir);
        let mut manager = Self {
            tasks: HashMap::new(),
            data_dir,
            max_tasks: 50,
        };
        manager.load_tasks();
        manager
    }

    /// 启动后台任务
    pub async fn start_task(&mut self, command: &str, cwd: Option<&Path>) -> Result<TaskEntry> {
        // 启动前清理已退出的任务，避免上限被僵尸任务占满
        self.cleanup_old_tasks();

        if self.tasks.len() >= self.max_tasks {
            anyhow::bail!("Maximum concurrent tasks reached ({})", self.max_tasks);
        }

        let id = Uuid::new_v4().to_string()[..8].to_string();
        let task_dir = self.data_dir.join(&id);
        let _ = std::fs::create_dir_all(&task_dir);

        let stdout_path = task_dir.join("stdout.log");
        let stderr_path = task_dir.join("stderr.log");

        std::fs::File::create(&stdout_path)?;
        std::fs::File::create(&stderr_path)?;

        // 直接 spawn 命令（不包装），stdout/stderr 通过 pipe 捕获
        let (shell, flag) = get_shell();

        let mut cmd = Command::new(shell);
        cmd.arg(flag)
            .arg(command)
            .stdout(Stdio::piped())
            .stderr(Stdio::piped());

        if let Some(dir) = cwd {
            cmd.current_dir(dir);
        }

        let mut child = cmd.spawn().context("Failed to spawn background process")?;

        let pid = child.id();
        let now = chrono::Utc::now().to_rfc3339();

        // 后台读取 stdout/stderr 到文件
        let stdout_file = child.stdout.take();
        let stderr_file = child.stderr.take();
        let stdout_path_clone = stdout_path.clone();
        let stderr_path_clone = stderr_path.clone();

        tokio::spawn(async move {
            if let Some(stdout) = stdout_file {
                let mut reader = tokio::io::BufReader::new(stdout);
                let mut file = tokio::fs::OpenOptions::new()
                    .create(true)
                    .append(true)
                    .open(&stdout_path_clone)
                    .await;
                if let Ok(ref mut f) = file {
                    let mut buf = String::new();
                    use tokio::io::AsyncBufReadExt;
                    while let Ok(n) = reader.read_line(&mut buf).await {
                        if n == 0 {
                            break;
                        }
                        let _ = f.write_all(buf.as_bytes()).await;
                        buf.clear();
                    }
                }
            }
        });

        tokio::spawn(async move {
            if let Some(stderr) = stderr_file {
                let mut reader = tokio::io::BufReader::new(stderr);
                let mut file = tokio::fs::OpenOptions::new()
                    .create(true)
                    .append(true)
                    .open(&stderr_path_clone)
                    .await;
                if let Ok(ref mut f) = file {
                    let mut buf = String::new();
                    use tokio::io::AsyncBufReadExt;
                    while let Ok(n) = reader.read_line(&mut buf).await {
                        if n == 0 {
                            break;
                        }
                        let _ = f.write_all(buf.as_bytes()).await;
                        buf.clear();
                    }
                }
            }
        });

        let entry = TaskEntry {
            id: id.clone(),
            command: command.to_string(),
            cwd: cwd.map(|p| p.to_string_lossy().to_string()),
            pid,
            status: TaskStatus::Running,
            exit_code: None,
            start_time: now,
            end_time: None,
            stdout_path,
            stderr_path,
        };

        self.tasks.insert(id.clone(), entry.clone());
        save_task_to_disk(&entry)?;

        // 同步等待窗口：短命命令（如 syntax error）会在 3 秒内退出
        // 等待后检查状态，失败则立即返回错误信息给 AI
        tokio::time::sleep(std::time::Duration::from_secs(SYNC_WAIT_SECS)).await;

        // 扫描更新状态
        if let Some(task) = self.tasks.get_mut(&id) {
            if task.status == TaskStatus::Running {
                if let Some(pid) = task.pid {
                    if !is_process_alive(pid).await {
                        task.status = TaskStatus::Exited;
                        task.end_time = Some(chrono::Utc::now().to_rfc3339());
                        // 尝试通过 waitpid 获取 exit_code
                        #[cfg(unix)]
                        {
                            let mut status: i32 = 0;
                            unsafe {
                                libc::waitpid(pid as i32, &mut status, libc::WNOHANG);
                            }
                            if libc::WIFEXITED(status) {
                                task.exit_code = Some(libc::WEXITSTATUS(status));
                            }
                        }
                        let entry = task.clone();
                        let _ = task;
                        let _ = save_task_to_disk(&entry);
                    }
                }
            }
        }

        // 返回最新状态
        let entry = self.tasks.get(&id).cloned().unwrap_or(entry);
        Ok(entry)
    }

    /// 列出任务（默认只返回运行中的，include_exited=true 返回全部）
    pub fn list_tasks(&self, include_exited: bool) -> Vec<TaskEntry> {
        if include_exited {
            return self.tasks.values().cloned().collect();
        }
        self.tasks
            .values()
            .filter(|t| {
                // 只保留 running 任务
                t.status == TaskStatus::Running
            })
            .cloned()
            .collect()
    }

    /// 清理已退出的任务，释放名额给新任务
    pub fn cleanup_old_tasks(&mut self) {
        let to_remove: Vec<String> = self
            .tasks
            .iter()
            .filter(|(_, t)| t.status != TaskStatus::Running)
            .map(|(id, _)| id.clone())
            .collect();

        for id in &to_remove {
            self.tasks.remove(id);
            // 清理磁盘上的任务目录
            let task_dir = self.data_dir.join(id);
            let _ = std::fs::remove_dir_all(&task_dir);
        }
    }

    /// 获取任务详情
    pub fn get_task(&self, id: &str) -> Option<&TaskEntry> {
        self.tasks.get(id)
    }

    /// 读取任务日志
    pub fn get_logs(
        &self,
        id: &str,
        tail: Option<usize>,
        max_bytes: Option<usize>,
    ) -> Result<(String, String)> {
        let task = self.tasks.get(id).context("Task not found")?;
        let stdout = read_log_file(&task.stdout_path, tail, max_bytes)?;
        let stderr = read_log_file(&task.stderr_path, tail, max_bytes)?;
        Ok((stdout, stderr))
    }

    /// 停止任务
    /// 终止任务，返回 (entry, stderr_tail)
    pub async fn kill_task(&mut self, id: &str) -> Result<(TaskEntry, String)> {
        let task = self.tasks.get_mut(id).context("Task not found")?;

        if task.status != TaskStatus::Running {
            anyhow::bail!("Task is not running (status: {:?})", task.status);
        }

        let stderr_path = task.stderr_path.clone();
        let pid = task.pid;

        if let Some(pid) = pid {
            kill_process_tree(pid).await?;
        }

        // 读取 stderr 最后 20 行
        let stderr_tail = read_log_file(&stderr_path, Some(20), None).unwrap_or_default();

        // 更新状态
        if let Some(t) = self.tasks.get_mut(id) {
            t.status = TaskStatus::Killed;
            t.end_time = Some(chrono::Utc::now().to_rfc3339());
            let entry = t.clone();
            let _ = t;
            let _ = save_task_to_disk(&entry);
        }

        let entry = self
            .tasks
            .get(id)
            .cloned()
            .ok_or_else(|| anyhow::anyhow!("Task disappeared after kill"))?;
        Ok((entry, stderr_tail))
    }

    /// 重启任务
    /// 重启任务，返回 (新entry, 旧任务stderr)
    pub async fn restart_task(&mut self, id: &str) -> Result<(TaskEntry, String)> {
        let old_task = self.tasks.get(id).context("Task not found")?.clone();
        let command = old_task.command.clone();
        let cwd = old_task
            .cwd
            .as_deref()
            .map(std::path::PathBuf::from)
            .unwrap_or_else(|| self.data_dir.clone());

        // 读取旧任务 stderr（终止前读取）
        let old_stderr = read_log_file(&old_task.stderr_path, Some(20), None).unwrap_or_default();

        // 停止旧任务
        if old_task.status == TaskStatus::Running {
            if let Some(pid) = old_task.pid {
                kill_process_tree(pid).await?;
            }
            if let Some(t) = self.tasks.get_mut(id) {
                t.status = TaskStatus::Killed;
                t.end_time = Some(chrono::Utc::now().to_rfc3339());
                let entry = t.clone();
                let _ = t;
                let _ = save_task_to_disk(&entry);
            }
        }

        // 启动新任务
        let new_entry = self.start_task(&command, Some(&cwd)).await?;
        Ok((new_entry, old_stderr))
    }

    /// 获取任务 stderr 最后 n 行
    pub fn get_stderr_tail(&self, task_id: &str, tail: usize) -> Result<String> {
        let task = self
            .tasks
            .get(task_id)
            .ok_or_else(|| anyhow::anyhow!("Task not found: {}", task_id))?;
        read_log_file(&task.stderr_path, Some(tail), None)
    }

    /// 扫描并更新任务状态
    pub async fn scan_tasks(&mut self) {
        let ids: Vec<String> = self.tasks.keys().cloned().collect();
        for id in ids {
            if let Some(task) = self.tasks.get_mut(&id) {
                if task.status == TaskStatus::Running {
                    if let Some(pid) = task.pid {
                        if !is_process_alive(pid).await {
                            task.status = TaskStatus::Exited;
                            task.end_time = Some(chrono::Utc::now().to_rfc3339());
                            let entry = task.clone();
                            let _ = task;
                            let _ = save_task_to_disk(&entry);
                        }
                    }
                }
            }
        }
    }

    // ============================================================
    // 持久化
    // ============================================================

    fn load_tasks(&mut self) {
        if let Ok(entries) = std::fs::read_dir(&self.data_dir) {
            for entry in entries.flatten() {
                let meta_path = entry.path().join("meta.json");
                if meta_path.exists() {
                    if let Ok(data) = std::fs::read_to_string(&meta_path) {
                        if let Ok(mut task) = serde_json::from_str::<TaskEntry>(&data) {
                            if task.status == TaskStatus::Running {
                                if let Some(pid) = task.pid {
                                    if !check_pid_alive_sync(pid) {
                                        task.status = TaskStatus::Exited;
                                        task.end_time = Some(chrono::Utc::now().to_rfc3339());
                                        let _ = save_task_to_disk(&task);
                                    }
                                }
                            }
                            self.tasks.insert(task.id.clone(), task);
                        }
                    }
                }
            }
        }
    }
}

// ============================================================
// 辅助函数
// ============================================================

fn save_task_to_disk(task: &TaskEntry) -> Result<()> {
    let dir = std::path::Path::new(&task.stdout_path)
        .parent()
        .unwrap_or(std::path::Path::new("/tmp"));
    let path = dir.join("meta.json");
    let json = serde_json::to_string_pretty(task)?;
    std::fs::write(&path, json)?;
    Ok(())
}

fn get_shell() -> (&'static str, &'static str) {
    if cfg!(target_os = "windows") {
        ("cmd", "/C")
    } else {
        ("sh", "-c")
    }
}

// 不再包装命令 - 直接 spawn，stdout/stderr 通过 pipe 捕获
// 进程独立运行，不需要 nohup/& 包装

async fn kill_process_tree(pid: u32) -> Result<()> {
    #[cfg(target_os = "windows")]
    {
        let _ = Command::new("taskkill")
            .args(["/T", "/F", "/PID", &pid.to_string()])
            .stdout(Stdio::null())
            .stderr(Stdio::null())
            .status()
            .await;
    }
    #[cfg(not(target_os = "windows"))]
    {
        // 先检查进程是否存活
        if !is_process_alive(pid).await {
            return Ok(()); // 已死，立即返回
        }

        // 发送 SIGTERM，检查返回值
        let ret = unsafe { libc::kill(pid as i32, libc::SIGTERM) };
        if ret != 0 {
            // SIGTERM 失败（进程不存在或权限不足），立即返回
            return Ok(());
        }

        // SIGTERM 成功发送，等待最多 2 秒让进程优雅退出
        for _ in 0..20 {
            tokio::time::sleep(std::time::Duration::from_millis(100)).await;
            if !is_process_alive(pid).await {
                return Ok(()); // 已退出，立即返回
            }
        }

        // 还活着，发 SIGKILL
        let _ = unsafe { libc::kill(pid as i32, libc::SIGKILL) };
    }
    Ok(())
}

async fn is_process_alive(pid: u32) -> bool {
    #[cfg(target_os = "windows")]
    {
        let output = Command::new("tasklist")
            .args(["/FI", &format!("PID eq {}", pid), "/NH"])
            .output()
            .await;
        match output {
            Ok(o) => {
                let stdout = String::from_utf8_lossy(&o.stdout);
                stdout.contains(&pid.to_string())
            }
            Err(_) => false,
        }
    }
    #[cfg(not(target_os = "windows"))]
    {
        unsafe { libc::kill(pid as i32, 0) == 0 }
    }
}

fn check_pid_alive_sync(pid: u32) -> bool {
    #[cfg(target_os = "windows")]
    {
        let _ = pid;
        true
    }
    #[cfg(not(target_os = "windows"))]
    {
        unsafe { libc::kill(pid as i32, 0) == 0 }
    }
}

const DEFAULT_TAIL_LINES: usize = 100;
const MAX_LOG_BYTES: usize = 1024 * 1024; // 1MB default

fn read_log_file(path: &Path, tail: Option<usize>, max_bytes: Option<usize>) -> Result<String> {
    let meta = std::fs::metadata(path).unwrap_or_else(|_| {
        // 返回一个最小的 Result 以兼容
        panic!("metadata failed")
    });
    let file_size = meta.len() as usize;
    let limit = max_bytes.unwrap_or(MAX_LOG_BYTES);

    // 如果文件超过限制，只读取最后 limit 字节
    let content = if file_size > limit {
        use std::io::{Read, Seek, SeekFrom};
        let mut file = std::fs::File::open(path)?;
        file.seek(SeekFrom::End(-(limit as i64)))?;
        let mut buf = vec![0u8; limit];
        file.read_exact(&mut buf)?;
        // 跳过可能不完整的首行
        let start = buf
            .iter()
            .position(|&b| b == b'\n')
            .map(|p| p + 1)
            .unwrap_or(0);
        String::from_utf8_lossy(&buf[start..]).into_owned()
    } else {
        std::fs::read_to_string(path).unwrap_or_default()
    };

    let n = tail.unwrap_or(DEFAULT_TAIL_LINES);
    let lines: Vec<&str> = content.lines().collect();
    let total_lines = lines.len();
    let start = total_lines.saturating_sub(n);
    let result = lines[start..].join("\n");

    // 添加截断提示
    if file_size > limit || total_lines > n {
        let truncated_bytes = file_size > limit;
        let truncated_lines = total_lines > n;
        let mut hint = String::from("[truncated]");
        if truncated_bytes {
            hint = format!(
                "[truncated: showing last {} bytes of {} bytes total]",
                limit, file_size
            );
        } else if truncated_lines {
            hint = format!("[truncated: showing last {} of {} lines]", n, total_lines);
        }
        Ok(format!("{}\n{}", hint, result))
    } else {
        Ok(result)
    }
}

// ============================================================
// 类型别名
// ============================================================

pub type SharedTaskManager = Arc<Mutex<TaskManager>>;

pub fn new_shared_task_manager(data_dir: PathBuf) -> SharedTaskManager {
    Arc::new(Mutex::new(TaskManager::new(data_dir)))
}
