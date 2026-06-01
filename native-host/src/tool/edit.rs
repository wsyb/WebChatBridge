use super::{Tool, ToolContext, ToolOutput};
use anyhow::Result;
use async_trait::async_trait;
use serde::Deserialize;
use serde_json::{json, Value};
use std::path::Path;

pub struct EditTool;

#[derive(Deserialize)]
struct EditInput {
    file_path: String,
    start_line: usize,
    end_line: usize,
    new_content: String,
}

#[async_trait]
impl Tool for EditTool {
    fn name(&self) -> &str {
        "edit"
    }

    fn description(&self) -> &str {
        "Replace lines in a file. Specify start_line and end_line (1-based, inclusive) to replace with new_content."
    }

    fn parameters_schema(&self) -> Value {
        json!({
            "type": "object",
            "required": ["file_path", "start_line", "end_line", "new_content"],
            "properties": {
                "file_path": {
                    "type": "string",
                    "description": "Path to the file."
                },
                "start_line": {
                    "type": "integer",
                    "description": "1-based start line (inclusive)."
                },
                "end_line": {
                    "type": "integer",
                    "description": "1-based end line (inclusive)."
                },
                "new_content": {
                    "type": "string",
                    "description": "New content to replace the specified lines."
                }
            }
        })
    }

    async fn execute(&self, input: Value, ctx: ToolContext) -> Result<ToolOutput> {
        let params: EditInput = serde_json::from_value(input)?;

        if params.start_line == 0 {
            return Err(anyhow::anyhow!("start_line must be >= 1"));
        }
        if params.end_line == 0 {
            return Err(anyhow::anyhow!("end_line must be >= 1"));
        }
        if params.end_line < params.start_line {
            return Err(anyhow::anyhow!(
                "end_line ({}) must be >= start_line ({})",
                params.end_line,
                params.start_line
            ));
        }

        let path = ctx.resolve_path(Path::new(&params.file_path));

        if !path.exists() {
            return Err(anyhow::anyhow!("File not found: {}", params.file_path));
        }

        let content = tokio::fs::read_to_string(&path).await?;
        let lines: Vec<&str> = content.lines().collect();
        let total_lines = lines.len();

        if params.start_line > total_lines {
            return Err(anyhow::anyhow!(
                "start_line ({}) exceeds file length ({} lines)",
                params.start_line,
                total_lines
            ));
        }

        // Clamp end_line to file length
        let end_line = params.end_line.min(total_lines);

        // Build new content: lines before + new_content + lines after
        let mut result = String::new();

        // Lines before (0 to start_line-2 in 0-indexed)
        for line in &lines[..params.start_line - 1] {
            result.push_str(line);
            result.push('\n');
        }

        // New content
        result.push_str(&params.new_content);
        if !params.new_content.is_empty() && !params.new_content.ends_with('\n') {
            result.push('\n');
        }

        // Lines after (end_line to end in 0-indexed)
        for line in &lines[end_line..] {
            result.push_str(line);
            result.push('\n');
        }

        tokio::fs::write(&path, &result).await?;

        let replaced = end_line - params.start_line + 1;
        Ok(ToolOutput::new(format!(
            "Replaced lines {}-{} ({} lines) in {}. File now has {} lines.",
            params.start_line,
            end_line,
            replaced,
            params.file_path,
            result.lines().count()
        )))
    }
}
