use anyhow::Result;
use async_trait::async_trait;
use serde_json::{json, Value};

use super::task_manager::SharedTaskManager;
use super::{Tool, ToolContext, ToolOutput};

pub struct TaskLogsTool {
    pub task_manager: SharedTaskManager,
}

#[async_trait]
impl Tool for TaskLogsTool {
    fn name(&self) -> &str {
        "task_logs"
    }

    fn description(&self) -> &str {
        "Get stdout and stderr logs from a background task."
    }

    fn parameters_schema(&self) -> Value {
        json!({
            "type": "object",
            "properties": {
                "task_id": {
                    "type": "string",
                    "description": "The task ID to get logs for"
                },
                "tail": {
                    "type": "integer",
                    "description": "Number of last lines to return (optional, default: 100)"
                },
                "max_bytes": {
                    "type": "integer",
                    "description": "Maximum bytes to read from file (optional, default: 1MB). Larger files are read from the end."
                }
            },
            "required": ["task_id"]
        })
    }

    async fn execute(&self, input: Value, _ctx: ToolContext) -> Result<ToolOutput> {
        let task_id = input["task_id"]
            .as_str()
            .ok_or_else(|| anyhow::anyhow!("Missing 'task_id' parameter"))?;

        let tail = input["tail"].as_u64().map(|n| n as usize);
        let max_bytes = input["max_bytes"].as_u64().map(|n| n as usize);

        let tm = self.task_manager.lock().await;
        let (stdout, stderr) = tm.get_logs(task_id, tail, max_bytes)?;

        let task = tm.get_task(task_id);
        let status = task
            .map(|t| &t.status)
            .unwrap_or(&super::task_manager::TaskStatus::Exited);
        let exit_code = task.and_then(|t| t.exit_code);
        let failed =
            matches!(status, super::task_manager::TaskStatus::Exited) && exit_code != Some(0);

        let output = json!({
            "task_id": task_id,
            "command": task.map(|t| t.command.as_str()).unwrap_or("unknown"),
            "status": status,
            "exit_code": exit_code,
            "failed": failed,
            "stdout": stdout,
            "stderr": stderr
        });

        Ok(ToolOutput::new(serde_json::to_string_pretty(&output)?))
    }
}
