use super::{Tool, ToolContext, ToolOutput, deserialize_optional_bool_flexible};
use anyhow::Result;
use async_trait::async_trait;
use serde::Deserialize;
use serde_json::{Value, json};
use tokio::process::Command;
use std::time::Duration;

const DEFAULT_TIMEOUT_SECS: u64 = 60;
const MAX_OUTPUT_LEN: usize = 30000;

pub struct ShellTool;

#[derive(Deserialize)]
struct ShellInput {
    command: String,
    #[serde(default)]
    content: Option<String>,
    #[serde(default, deserialize_with = "deserialize_optional_bool_flexible")]
    is_background: Option<bool>,
    #[serde(default)]
    timeout: Option<u64>,
}

#[async_trait]
impl Tool for ShellTool {
    fn name(&self) -> &str {
        "run_shell_command"
    }

    fn description(&self) -> &str {
        "Execute a shell command and return stdout, stderr, and exit code."
    }

    fn parameters_schema(&self) -> Value {
        json!({
            "type": "object",
            "required": ["command"],
            "properties": {
                "command": {
                    "type": "string",
                    "description": "The shell command to execute."
                },
                "is_background": {
                    "type": "boolean",
                    "description": "Whether to run in background without waiting for result."
                },
                "timeout": {
                    "type": "integer",
                    "description": "Timeout in seconds. Default 60."
                }
            }
        })
    }

    async fn execute(&self, input: Value, _ctx: ToolContext) -> Result<ToolOutput> {
        let params: ShellInput = serde_json::from_value(input)?;

        let is_background = params.is_background.unwrap_or(false);
        let timeout_secs = params.timeout.unwrap_or(DEFAULT_TIMEOUT_SECS);

        // Content field: write to temp file and execute with command as interpreter
        if let Some(content) = params.content {
            return execute_with_content(&params.command, &content, timeout_secs).await;
        }

        if is_background {
            let (shell, flag) = get_shell();
            let child = Command::new(shell)
                .arg(flag)
                .arg(&params.command)
                .spawn()?;

            Ok(ToolOutput::new(format!(
                "Background command started with PID: {:?}",
                child.id()
            )))
        } else if is_multiline(&params.command) {
            // Multiline commands: write to temp file, execute with appropriate interpreter
            execute_multiline(&params.command, timeout_secs).await
        } else {
            // Single-line commands: spawn + timeout + explicit kill on timeout
            execute_with_timeout(&params.command, timeout_secs).await
        }
    }
}

/// Check if a command contains multiline content or complex quoting.
fn is_multiline(cmd: &str) -> bool {
    cmd.contains('\n') || cmd.matches('"').count() > 2 || cmd.matches('\'').count() > 2
}

/// Execute with content field: write content to temp file, execute with command as interpreter.
/// Used by the text protocol where AI passes `command: python3` and `content: <script body>`.
async fn execute_with_content(interpreter: &str, content: &str, timeout_secs: u64) -> Result<ToolOutput> {
    let ext = match interpreter {
        "python3" | "python" => ".py",
        "node" => ".js",
        "ruby" => ".rb",
        "perl" => ".pl",
        "php" => ".php",
        _ => ".sh",
    };

    let pid = std::process::id();
    let path = format!("/tmp/webai-content-{}{}", pid, ext);

    tokio::fs::write(&path, content).await?;

    let result = execute_with_timeout_inner(interpreter, &[&path], timeout_secs).await;

    let _ = tokio::fs::remove_file(&path).await;
    result
}

/// Execute a multiline command by writing it to a temp file.
async fn execute_multiline(cmd: &str, timeout_secs: u64) -> Result<ToolOutput> {
    let (interpreter, ext) = detect_interpreter(cmd);
    let pid = std::process::id();
    let path = format!("/tmp/webai-script-{}{}", pid, ext);

    tokio::fs::write(&path, cmd).await?;

    let result = execute_with_timeout_inner(
        interpreter,
        &[&path],
        timeout_secs,
    )
    .await;

    // Always clean up temp file
    let _ = tokio::fs::remove_file(&path).await;

    result
}

/// Detect the appropriate interpreter from command content.
fn detect_interpreter(cmd: &str) -> (&'static str, &'static str) {
    let trimmed = cmd.trim_start();
    if trimmed.starts_with("#!/usr/bin/env python") || trimmed.starts_with("#!/usr/bin/python") {
        ("python3", ".py")
    } else if trimmed.starts_with("#!/usr/bin/env node") || trimmed.starts_with("#!/usr/bin/node") {
        ("node", ".js")
    } else if trimmed.contains("python") || trimmed.contains("def ") || trimmed.contains("import ") {
        ("python3", ".py")
    } else {
        ("bash", ".sh")
    }
}

/// Execute a single-line command with timeout and proper subprocess cleanup.
async fn execute_with_timeout(cmd: &str, timeout_secs: u64) -> Result<ToolOutput> {
    let (shell, flag) = get_shell();
    execute_with_timeout_inner(shell, &[flag, cmd], timeout_secs).await
}

/// Core execution with timeout — spawns child, waits, kills on timeout.
async fn execute_with_timeout_inner(
    program: &str,
    args: &[&str],
    timeout_secs: u64,
) -> Result<ToolOutput> {
    let mut child = Command::new(program)
        .args(args)
        .stdout(std::process::Stdio::piped())
        .stderr(std::process::Stdio::piped())
        .spawn()?;

    // Take stdout/stderr handles before waiting
    let stdout = child.stdout.take();
    let stderr = child.stderr.take();

    // Read stdout/stderr in background
    let stdout_handle = tokio::spawn(async move {
        match stdout {
            Some(mut s) => {
                let mut buf = Vec::new();
                use tokio::io::AsyncReadExt;
                let _ = s.read_to_end(&mut buf).await;
                buf
            }
            None => Vec::new(),
        }
    });
    let stderr_handle = tokio::spawn(async move {
        match stderr {
            Some(mut s) => {
                let mut buf = Vec::new();
                use tokio::io::AsyncReadExt;
                let _ = s.read_to_end(&mut buf).await;
                buf
            }
            None => Vec::new(),
        }
    });

    // Wait with timeout
    match tokio::time::timeout(Duration::from_secs(timeout_secs), child.wait()).await {
        Ok(Ok(status)) => {
            let stdout_bytes = stdout_handle.await.unwrap_or_default();
            let stderr_bytes = stderr_handle.await.unwrap_or_default();
            let output = std::process::Output {
                status,
                stdout: stdout_bytes,
                stderr: stderr_bytes,
            };
            format_output(output)
        }
        Ok(Err(e)) => Err(anyhow::anyhow!("Command failed: {}", e)),
        Err(_) => {
            // Timeout: kill the child process and reap it
            let _ = child.kill().await;
            let _ = child.wait().await;
            // Cancel the read handles
            stdout_handle.abort();
            stderr_handle.abort();
            Err(anyhow::anyhow!(
                "Command timed out after {} seconds",
                timeout_secs
            ))
        }
    }
}

/// Format command output into ToolOutput.
fn format_output(output: std::process::Output) -> Result<ToolOutput> {
    let stdout = String::from_utf8_lossy(&output.stdout);
    let stderr = String::from_utf8_lossy(&output.stderr);
    let exit_code = output.status.code().unwrap_or(-1);

    let mut result = String::new();

    if !stdout.is_empty() {
        let truncated = if stdout.len() > MAX_OUTPUT_LEN {
            format!("{}... (truncated)", safe_truncate(&stdout, MAX_OUTPUT_LEN))
        } else {
            stdout.to_string()
        };
        result.push_str(&truncated);
    }

    if !stderr.is_empty() {
        if !result.is_empty() {
            result.push_str("\n\n");
        }
        result.push_str(&format!("STDERR:\n{}", stderr));
    }

    if exit_code != 0 {
        if !result.is_empty() {
            result.push_str("\n\n");
        }
        result.push_str(&format!("Exit code: {}", exit_code));
    }

    Ok(ToolOutput::new(result))
}

fn get_shell() -> (&'static str, &'static str) {
    #[cfg(target_os = "windows")]
    {
        ("cmd", "/C")
    }

    #[cfg(not(target_os = "windows"))]
    {
        ("bash", "-c")
    }
}

fn safe_truncate(s: &str, max_bytes: usize) -> &str {
    if s.len() <= max_bytes {
        return s;
    }
    let mut end = max_bytes;
    while end > 0 && !s.is_char_boundary(end) {
        end -= 1;
    }
    &s[..end]
}
