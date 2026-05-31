pub mod edit;
pub mod glob;
pub mod grep;
pub mod ls;
pub mod read;
pub mod shell;
pub mod write;
pub mod task_manager;
pub mod task_start;
pub mod task_list;
pub mod task_logs;
pub mod task_kill;
pub mod task_restart;

use anyhow::Result;
use async_trait::async_trait;
use serde::{Deserialize, Serialize};
use serde_json::Value;
use std::path::{Path, PathBuf};
use task_manager::SharedTaskManager;

/// Flexible boolean deserializer that accepts bool, string ("true"/"false"), or number.
/// Used for tool parameters where AI may send boolean values as strings.
pub fn deserialize_bool_flexible<'de, D>(deserializer: D) -> Result<bool, D::Error>
where
    D: serde::Deserializer<'de>,
{
    let value = Value::deserialize(deserializer)?;
    match &value {
        Value::Bool(b) => Ok(*b),
        Value::String(s) => match s.to_lowercase().as_str() {
            "true" | "1" | "yes" => Ok(true),
            "false" | "0" | "no" => Ok(false),
            _ => Err(serde::de::Error::custom(format!(
                "cannot convert string '{}' to bool", s
            ))),
        },
        Value::Number(n) => Ok(n.as_f64().map_or(false, |f| f != 0.0)),
        _ => Err(serde::de::Error::custom(format!(
            "expected bool, got {}", value
        ))),
    }
}

/// Flexible Option<bool> deserializer — returns None for null/missing, Some(bool) otherwise.
pub fn deserialize_optional_bool_flexible<'de, D>(deserializer: D) -> Result<Option<bool>, D::Error>
where
    D: serde::Deserializer<'de>,
{
    let value = Value::deserialize(deserializer)?;
    match &value {
        Value::Null => Ok(None),
        Value::Bool(b) => Ok(Some(*b)),
        Value::String(s) => match s.to_lowercase().as_str() {
            "true" | "1" | "yes" => Ok(Some(true)),
            "false" | "0" | "no" => Ok(Some(false)),
            _ => Err(serde::de::Error::custom(format!(
                "cannot convert string '{}' to bool", s
            ))),
        },
        Value::Number(n) => Ok(Some(n.as_f64().map_or(false, |f| f != 0.0))),
        _ => Err(serde::de::Error::custom(format!(
            "expected bool or null, got {}", value
        ))),
    }
}

/// Tool output
#[derive(Debug, Serialize, Deserialize)]
pub struct ToolOutput {
    pub content: String,
}

impl ToolOutput {
    pub fn new(content: String) -> Self {
        Self { content }
    }
}

/// Tool context for execution
#[derive(Clone)]
#[allow(dead_code)]
pub struct ToolContext {
    pub working_dir: Option<PathBuf>,
    pub task_manager: Option<SharedTaskManager>,
}

impl Default for ToolContext {
    fn default() -> Self {
        Self {
            working_dir: std::env::current_dir().ok(),
            task_manager: None,
        }
    }
}

impl ToolContext {
    pub fn resolve_path(&self, path: &Path) -> PathBuf {
        let s = path.to_string_lossy();
        if s.starts_with('~') {
            if let Some(home) = dirs::home_dir() {
                let rest = &s[1..];
                if rest.is_empty() {
                    return home;
                } else if rest.starts_with('/') {
                    return home.join(&rest[1..]);
                }
            }
        }
        if path.is_absolute() {
            path.to_path_buf()
        } else if let Some(ref base) = self.working_dir {
            base.join(path)
        } else {
            path.to_path_buf()
        }
    }
}

/// A tool that can be executed by the agent
#[async_trait]
pub trait Tool: Send + Sync {
    /// Tool name (must match what's sent to the API)
    fn name(&self) -> &str;

    /// Human-readable description
    fn description(&self) -> &str;

    /// JSON Schema for the input parameters
    fn parameters_schema(&self) -> Value;

    /// Execute the tool with the given input
    async fn execute(&self, input: Value, ctx: ToolContext) -> Result<ToolOutput>;
}

/// Registry of available tools
pub struct ToolRegistry {
    tools: Vec<Box<dyn Tool>>,
}

impl ToolRegistry {
    #[allow(dead_code)]
    pub fn new() -> Self {
        Self {
            tools: vec![
                Box::new(ls::LsTool),
                Box::new(read::ReadTool),
                Box::new(write::WriteTool),
                Box::new(edit::EditTool),
                Box::new(grep::GrepTool),
                Box::new(glob::GlobTool),
                Box::new(shell::ShellTool),
            ],
        }
    }

    pub fn with_task_manager(task_manager: SharedTaskManager) -> Self {
        Self {
            tools: vec![
                Box::new(ls::LsTool),
                Box::new(read::ReadTool),
                Box::new(write::WriteTool),
                Box::new(edit::EditTool),
                Box::new(grep::GrepTool),
                Box::new(glob::GlobTool),
                Box::new(shell::ShellTool),
                Box::new(task_start::TaskStartTool { task_manager: task_manager.clone() }),
                Box::new(task_list::TaskListTool { task_manager: task_manager.clone() }),
                Box::new(task_logs::TaskLogsTool { task_manager: task_manager.clone() }),
                Box::new(task_kill::TaskKillTool { task_manager: task_manager.clone() }),
                Box::new(task_restart::TaskRestartTool { task_manager }),
            ],
        }
    }

    pub fn get(&self, name: &str) -> Option<&dyn Tool> {
        self.tools.iter().find(|t| t.name() == name).map(|t| t.as_ref())
    }

    pub fn list_tools(&self) -> Vec<Value> {
        self.tools
            .iter()
            .map(|t| {
                serde_json::json!({
                    "name": t.name(),
                    "description": t.description(),
                    "parameters": t.parameters_schema(),
                })
            })
            .collect()
    }
}
