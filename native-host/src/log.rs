use std::io::Write;

// ============================================================
// File-based logger — zero external dependencies, no panics
// ============================================================

pub struct FileLogger {
    file: std::sync::Mutex<std::fs::File>,
}

impl FileLogger {
    pub fn new_from_file(file: std::fs::File) -> Self {
        Self {
            file: std::sync::Mutex::new(file),
        }
    }

    pub fn log(&self, msg: &str) {
        if let Ok(mut file) = self.file.lock() {
            let ts = std::time::SystemTime::now()
                .duration_since(std::time::UNIX_EPOCH)
                .unwrap_or_default()
                .as_millis();
            let _ = writeln!(file, "[{}] {}", ts, msg);
            let _ = file.flush();
        }
    }
}

pub static LOGGER: std::sync::OnceLock<FileLogger> = std::sync::OnceLock::new();

#[macro_export]
macro_rules! flog {
    ($($arg:tt)*) => {{
        if let Some(logger) = $crate::log::LOGGER.get() {
            logger.log(&format!($($arg)*));
        }
        eprintln!("[WebAI] {}", format!($($arg)*));
    }};
}

pub fn init_logger(path: &str) -> Option<FileLogger> {
    match std::fs::OpenOptions::new()
        .create(true)
        .append(true)
        .open(path)
    {
        Ok(file) => {
            let logger = FileLogger::new_from_file(file);
            logger.log("=== Logger initialized ===");
            Some(logger)
        }
        Err(e) => {
            eprintln!("[WebAI] Failed to init logger at {}: {}", path, e);
            None
        }
    }
}

/// Write an extension log entry with `[ext]` prefix.
pub fn log_ext(module: &str, msg: &str, data: Option<&str>) {
    if let Some(logger) = LOGGER.get() {
        let data_str = data.map(|d| format!(" {}", d)).unwrap_or_default();
        logger.log(&format!("[ext] [{}] {}{}", module, msg, data_str));
    }
}
