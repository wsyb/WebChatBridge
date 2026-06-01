use anyhow::Result;
use async_trait::async_trait;
use serde_json::{json, Value};

use super::task_manager::SharedTaskManager;
use super::{Tool, ToolContext, ToolOutput};

pub struct TaskRestartTool {
    pub task_manager: SharedTaskManager,
}

#[async_trait]
impl Tool for TaskRestartTool {
    fn name(&self) -> &str {
        "task_restart"
    }

    fn description(&self) -> &str {
        "Restart a background task. Stops the old process and starts a new one with the same command."
    }

    fn parameters_schema(&self) -> Value {
        json!({
            "type": "object",
            "properties": {
                "task_id": {
                    "type": "string",
                    "description": "The task ID to restart"
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
        let (new_task, old_stderr) = tm.restart_task(task_id).await?;

        let mut output = json!({
            "task_id": new_task.id,
            "pid": new_task.pid,
            "status": "running",
            "command": new_task.command,
            "message": "Task restarted"
        });

        if !old_stderr.trim().is_empty() {
            output["old_stderr"] = json!(old_stderr);
        }

        Ok(ToolOutput::new(serde_json::to_string_pretty(&output)?))
    }
}
