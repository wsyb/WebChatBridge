use super::{Tool, ToolContext, ToolOutput};
use anyhow::Result;
use async_trait::async_trait;
use serde::Deserialize;
use serde_json::{json, Value};
use std::path::Path;

const DEFAULT_LIMIT: usize = 200;
const MAX_LINE_LEN: usize = 2000;

pub struct ReadTool;

#[derive(Deserialize)]
struct ReadInput {
    file_path: String,
    #[serde(default)]
    start_line: Option<usize>,
    #[serde(default)]
    end_line: Option<usize>,
    #[serde(default)]
    offset: Option<usize>,
    #[serde(default)]
    limit: Option<usize>,
}

#[derive(Debug, Clone, Copy, PartialEq, Eq)]
enum ReadRangeStyle {
    OffsetLimit,
    StartEnd,
}

#[derive(Debug, Clone, Copy, PartialEq, Eq)]
struct NormalizedReadRange {
    offset: usize,
    limit: usize,
    style: ReadRangeStyle,
}

impl NormalizedReadRange {
    fn next_offset(self) -> usize {
        self.offset + self.limit
    }

    fn next_start_line(self) -> usize {
        self.next_offset() + 1
    }
}

fn normalize_read_range(params: &ReadInput) -> Result<NormalizedReadRange> {
    let has_start_end = params.start_line.is_some() || params.end_line.is_some();
    let has_mixed_offset = match (params.start_line, params.end_line, params.offset) {
        (Some(start_line), _, Some(offset)) => {
            if start_line == 0 {
                true
            } else {
                offset.checked_add(1) != Some(start_line)
            }
        }
        (None, Some(_), Some(offset)) => offset != 0,
        _ => params.offset.is_some(),
    };

    if has_start_end && has_mixed_offset {
        return Err(anyhow::anyhow!(
            "Use either start_line/end_line (1-based) or offset (0-based), not both."
        ));
    }

    if has_start_end {
        let start_line = params.start_line.unwrap_or(1);
        if start_line == 0 {
            return Err(anyhow::anyhow!("start_line must be 1 or greater."));
        }

        let limit = if let Some(end_line) = params.end_line {
            if end_line == 0 {
                return Err(anyhow::anyhow!("end_line must be 1 or greater."));
            }
            if end_line < start_line {
                return Err(anyhow::anyhow!(
                    "end_line ({}) must be greater than or equal to start_line ({}).",
                    end_line,
                    start_line
                ));
            }
            end_line - start_line + 1
        } else {
            params.limit.unwrap_or(DEFAULT_LIMIT)
        };

        return Ok(NormalizedReadRange {
            offset: start_line - 1,
            limit,
            style: ReadRangeStyle::StartEnd,
        });
    }

    Ok(NormalizedReadRange {
        offset: params.offset.unwrap_or(0),
        limit: params.limit.unwrap_or(DEFAULT_LIMIT),
        style: ReadRangeStyle::OffsetLimit,
    })
}

#[async_trait]
impl Tool for ReadTool {
    fn name(&self) -> &str {
        "read"
    }

    fn description(&self) -> &str {
        "Read a file. Supports text files."
    }

    fn parameters_schema(&self) -> Value {
        json!({
            "type": "object",
            "required": ["file_path"],
            "properties": {
                "file_path": {
                    "type": "string",
                    "description": "Path to a file."
                },
                "start_line": {
                    "type": "integer",
                    "description": "1-based start line."
                },
                "end_line": {
                    "type": "integer",
                    "description": "1-based end line."
                },
                "offset": {
                    "type": "integer",
                    "description": "0-based offset."
                },
                "limit": {
                    "type": "integer",
                    "description": "Max lines to read. Default 5000."
                }
            }
        })
    }

    async fn execute(&self, input: Value, ctx: ToolContext) -> Result<ToolOutput> {
        let params: ReadInput = serde_json::from_value(input)?;
        let range = normalize_read_range(&params)?;

        let path = ctx.resolve_path(Path::new(&params.file_path));

        if !path.exists() {
            return Err(anyhow::anyhow!("File not found: {}", params.file_path));
        }

        if is_binary_file(&path) {
            return Ok(ToolOutput::new(format!(
                "Binary file detected: {}",
                params.file_path
            )));
        }

        let content = tokio::fs::read_to_string(&path).await?;

        let mut output = String::with_capacity(range.limit.min(2000) * 80);
        let mut total_lines = 0usize;
        let end_exclusive = range.offset + range.limit;

        for (i, line) in content.lines().enumerate() {
            total_lines = i + 1;
            if i < range.offset {
                continue;
            }
            if i >= end_exclusive {
                continue;
            }
            let line_num = i + 1;
            if line.len() > MAX_LINE_LEN {
                let _ = std::fmt::Write::write_fmt(
                    &mut output,
                    format_args!(
                        "{:>5}\t{}...\n",
                        line_num,
                        safe_truncate(line, MAX_LINE_LEN)
                    ),
                );
            } else {
                let _ = std::fmt::Write::write_fmt(
                    &mut output,
                    format_args!("{:>5}\t{}\n", line_num, line),
                );
            }
        }

        let end = end_exclusive.min(total_lines);

        if end < total_lines {
            let continuation_hint = match range.style {
                ReadRangeStyle::OffsetLimit => format!("offset={}", range.next_offset()),
                ReadRangeStyle::StartEnd => format!("start_line={}", range.next_start_line()),
            };
            output.push_str(&format!(
                "\n... {} more lines (use {} to continue)\n",
                total_lines - end,
                continuation_hint
            ));
        }

        if output.is_empty() {
            Ok(ToolOutput::new("(empty file)".to_string()))
        } else {
            Ok(ToolOutput::new(output))
        }
    }
}

fn is_binary_file(path: &Path) -> bool {
    if let Some(ext) = path.extension() {
        let ext = ext.to_string_lossy().to_lowercase();
        let binary_exts = [
            "png", "jpg", "jpeg", "gif", "bmp", "ico", "webp", "zip", "tar", "gz", "bz2", "xz",
            "7z", "rar", "exe", "dll", "so", "dylib", "o", "a", "class", "pyc", "wasm", "mp3",
            "mp4", "avi", "mov", "mkv", "flac", "ogg", "wav",
        ];
        if binary_exts.contains(&ext.as_str()) {
            return true;
        }
    }

    use std::io::Read;
    if let Ok(mut file) = std::fs::File::open(path) {
        let mut buf = [0u8; 8192];
        if let Ok(n) = file.read(&mut buf) {
            if n > 0 {
                let null_count = buf[..n].iter().filter(|&&b| b == 0).count();
                return null_count > n / 10;
            }
        }
    }

    false
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
