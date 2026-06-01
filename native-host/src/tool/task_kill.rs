use anyhow::Result;
use async_trait::async_trait;
use serde_json::{json, Value};

use super::task_manager::SharedTaskManager;
use super::{Tool, ToolContext, ToolOutput};

pub struct TaskKillTool {
    pub task_manager: SharedTaskManager,
}

#[async_trait]
impl Tool for TaskKillTool {
    fn name(&self) -> &str {
        "task_kill"
    }

    fn description(&self) -> &str {
        "Stop a running background task. Sends SIGTERM, waits 2s, then SIGKILL if needed."
    }

    fn parameters_schema(&self) -> Value {
        json!({
            "type": "object",
            "properties": {
                "task_id": {
                    "type": "string",
                    "description": "The task ID to kill"
                }
            },
            "required": ["task_id"]
        })
    }

    async fn execute(&self, input: Value, _ctx: ToolContext) -> Result<ToolOutput> {
        let task_id = input["task_id"]
            .as_str()
            .ok_or_else(|| anyhow::anyhow!("Missing 'task_id' parameter"))?;

        let mut tm = self.task_manager.lock().await;
        let (entry, stderr_tail) = tm.kill_task(task_id).await?;

        let mut output = json!({
            "task_id": task_id,
            "status": "killed",
            "command": entry.command,
            "exit_code": entry.exit_code,
            "message": "Task terminated"
        });

        if !stderr_tail.trim().is_empty() {
            output["stderr"] = json!(stderr_tail);
        }

        Ok(ToolOutput::new(serde_json::to_string_pretty(&output)?))
    }
}
