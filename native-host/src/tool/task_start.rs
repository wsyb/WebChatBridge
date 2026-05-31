use anyhow::Result;
use async_trait::async_trait;
use serde_json::{json, Value};

use super::{Tool, ToolContext, ToolOutput};
use super::task_manager::SharedTaskManager;

pub struct TaskStartTool {
    pub task_manager: SharedTaskManager,
}

#[async_trait]
impl Tool for TaskStartTool {
    fn name(&self) -> &str { "task_start" }

    fn description(&self) -> &str {
        "Start a command as a background task. Returns task_id for later management. \
         Use this for long-running processes like servers (python app.py), \
         build watchers (npm run dev), docker containers, etc. \
         The process runs independently and won't block."
    }

    fn parameters_schema(&self) -> Value {
        json!({
            "type": "object",
            "properties": {
                "command": {
                    "type": "string",
                    "description": "The command to run in background"
                },
                "cwd": {
                    "type": "string",
                    "description": "Working directory (optional, defaults to server working dir)"
                }
            },
            "required": ["command"]
        })
    }

    async fn execute(&self, input: Value, _ctx: ToolContext) -> Result<ToolOutput> {
        let command = input["command"]
            .as_str()
            .ok_or_else(|| anyhow::anyhow!("Missing 'command' parameter"))?;

        let cwd = input["cwd"].as_str().map(|s| std::path::PathBuf::from(s));

        let cwd_ref = cwd.as_deref();

        let mut tm = self.task_manager.lock().await;
        let entry = tm.start_task(command, cwd_ref).await?;

        // 同步等待后检查状态：短命命令会在 3 秒内退出
        let (status_str, message, stderr_tail) = match entry.status {
            super::task_manager::TaskStatus::Running => {
                ("running", "Task started in background".to_string(), None)
            }
            super::task_manager::TaskStatus::Exited => {
                let stderr = tm.get_stderr_tail(&entry.id, 30).unwrap_or_default();
                let exit_info = entry.exit_code
                    .map(|c| format!(" (exit code: {})", c))
                    .unwrap_or_default();
                ("failed", format!("Task exited immediately{}", exit_info), Some(stderr))
            }
            super::task_manager::TaskStatus::Killed => {
                ("killed", "Task was killed".to_string(), None)
            }
        };

        let mut output = json!({
            "task_id": entry.id,
            "pid": entry.pid,
            "status": status_str,
            "command": entry.command,
            "message": message,
        });

        if let Some(stderr) = stderr_tail {
            if !stderr.trim().is_empty() {
                output["stderr"] = json!(stderr);
            }
        }

        Ok(ToolOutput::new(serde_json::to_string_pretty(&output)?))
    }
}
