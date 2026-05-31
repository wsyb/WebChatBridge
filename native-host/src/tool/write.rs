use super::{Tool, ToolContext, ToolOutput};
use anyhow::Result;
use async_trait::async_trait;
use serde::Deserialize;
use serde_json::{Value, json};
use std::path::Path;

pub struct WriteTool;

#[derive(Deserialize)]
struct WriteInput {
    file_path: String,
    #[serde(default)]
    content: String,
}

#[async_trait]
impl Tool for WriteTool {
    fn name(&self) -> &str {
        "write"
    }

    fn description(&self) -> &str {
        "Write a file. Creates parent directories if needed."
    }

    fn parameters_schema(&self) -> Value {
        json!({
            "type": "object",
            "required": ["file_path", "content"],
            "properties": {
                "file_path": {
                    "type": "string",
                    "description": "File path."
                },
                "content": {
                    "type": "string",
                    "description": "File content."
                }
            }
        })
    }

    async fn execute(&self, input: Value, ctx: ToolContext) -> Result<ToolOutput> {
        let params: WriteInput = serde_json::from_value(input)?;

        let path = ctx.resolve_path(Path::new(&params.file_path));

        if let Some(parent) = path.parent() {
            if !parent.exists() {
                tokio::fs::create_dir_all(parent).await?;
            }
        }

        let existed = path.exists();
        let old_content = if existed {
            tokio::fs::read_to_string(&path).await.ok()
        } else {
            None
        };

        tokio::fs::write(&path, &params.content).await?;

        let new_len = params.content.len();

        if existed {
            if let Some(old) = old_content {
                let changes = similar::TextDiff::from_lines(&old, &params.content);
                let added = changes
                    .iter_all_changes()
                    .filter(|c| c.tag() == similar::ChangeTag::Insert)
                    .count();
                let removed = changes
                    .iter_all_changes()
                    .filter(|c| c.tag() == similar::ChangeTag::Delete)
                    .count();
                Ok(ToolOutput::new(format!(
                    "File updated: {}\n{} lines added, {} lines removed",
                    params.file_path, added, removed
                )))
            } else {
                Ok(ToolOutput::new(format!(
                    "File updated: {} ({} bytes)",
                    params.file_path, new_len
                )))
            }
        } else {
            Ok(ToolOutput::new(format!(
                "File created: {} ({} bytes)",
                params.file_path, new_len
            )))
        }
    }
}
