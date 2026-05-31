use anyhow::Result;
use async_trait::async_trait;
use serde_json::{json, Value};

use super::{Tool, ToolContext, ToolOutput};
use super::task_manager::SharedTaskManager;

pub struct TaskListTool {
    pub task_manager: SharedTaskManager,
}

#[async_trait]
impl Tool for TaskListTool {
    fn name(&self) -> &str { "task_list" }

    fn description(&self) -> &str {
        "List all background tasks with their status, command, uptime, etc."
    }

    fn parameters_schema(&self) -> Value {
        json!({
            "type": "object",
            "properties": {
                "include_exited": {
                    "type": "boolean",
                    "description": "Include exited/killed tasks (default: false, only shows running tasks)"
                }
            }
        })
    }

    async fn execute(&self, input: Value, _ctx: ToolContext) -> Result<ToolOutput> {
        let include_exited = input["include_exited"].as_bool().unwrap_or(false);
        let mut tm = self.task_manager.lock().await;
        tm.scan_tasks().await;
        let tasks = tm.list_tasks(include_exited);

        let task_list: Vec<Value> = tasks.iter().map(|t| {
            let uptime = compute_uptime(&t.start_time, t.end_time.as_deref());
            json!({
                "id": t.id,
                "command": t.command,
                "cwd": t.cwd,
                "status": t.status,
                "pid": t.pid,
                "uptime": uptime,
                "start_time": t.start_time,
                "end_time": t.end_time,
                "exit_code": t.exit_code,
            })
        }).collect();

        let output = json!({
            "tasks": task_list,
            "total": task_list.len()
        });

        Ok(ToolOutput::new(serde_json::to_string_pretty(&output)?))
    }
}

fn compute_uptime(start: &str, end: Option<&str>) -> String {
    if let Ok(start_time) = chrono::DateTime::parse_from_rfc3339(start) {
        let elapsed = if let Some(end_str) = end {
            if let Ok(end_time) = chrono::DateTime::parse_from_rfc3339(end_str) {
                end_time.signed_duration_since(start_time)
            } else {
                chrono::Utc::now().signed_duration_since(start_time)
            }
        } else {
            chrono::Utc::now().signed_duration_since(start_time)
        };

        let secs = elapsed.num_seconds().max(0) as u64;
        if secs < 60 {
            format!("{}s", secs)
        } else if secs < 3600 {
            format!("{}m {}s", secs / 60, secs % 60)
        } else {
            format!("{}h {}m", secs / 3600, (secs % 3600) / 60)
        }
    } else {
        "unknown".to_string()
    }
}
