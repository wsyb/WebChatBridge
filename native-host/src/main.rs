mod log;
mod server;
mod tool;

use server::{AppState, create_router};
use std::sync::Arc;
use std::time::Instant;
use tool::ToolRegistry;
use tool::task_manager::new_shared_task_manager;

// ============================================================
// CLI 参数
// ============================================================

struct CliArgs {
    host: String,
    port: u16,
}

fn parse_args() -> CliArgs {
    let args: Vec<String> = std::env::args().skip(1).collect();
    let mut host = "127.0.0.1".to_string();
    let mut port: u16 = 18789;

    let mut i = 0;
    while i < args.len() {
        match args[i].as_str() {
            "--host" | "-h" => {
                i += 1;
                if i < args.len() {
                    host = args[i].clone();
                }
            }
            "--port" | "-p" => {
                i += 1;
                if i < args.len() {
                    port = args[i].parse().unwrap_or_else(|_| {
                        eprintln!("Invalid port: {}", args[i]);
                        std::process::exit(1);
                    });
                }
            }
            "--help" => {
                println!("WebChatBridge Native Host");
                println!();
                println!("Usage: wcb [OPTIONS]");
                println!();
                println!("Options:");
                println!("  --host, -h <HOST>  Bind address (default: 127.0.0.1)");
                println!("  --port, -p <PORT>  Listen port (default: 18789)");
                println!("  --help             Show this help");
                println!();
                println!("Examples:");
                println!("  wcb                          # Listen on 127.0.0.1:18789");
                println!("  wcb --port 19999             # Listen on 127.0.0.1:19999");
                println!("  wcb --host 0.0.0.0 --port 18789  # Listen on all interfaces");
                std::process::exit(0);
            }
            _ => {
                eprintln!("Unknown argument: {}. Use --help for usage.", args[i]);
                std::process::exit(1);
            }
        }
        i += 1;
    }

    CliArgs { host, port }
}

// ============================================================
// Port file
// ============================================================

fn write_port_file(port: u16) {
    let dir = dirs::home_dir()
        .unwrap_or_else(|| std::path::PathBuf::from("/tmp"))
        .join(".webchatbridge");
    let _ = std::fs::create_dir_all(&dir);
    let path = dir.join("port");
    match std::fs::write(&path, port.to_string()) {
        Ok(()) => flog!("Port file written: {} -> {}", path.display(), port),
        Err(e) => flog!("Failed to write port file: {}", e),
    }
}

fn remove_port_file() {
    let path = dirs::home_dir()
        .unwrap_or_else(|| std::path::PathBuf::from("/tmp"))
        .join(".webchatbridge")
        .join("port");
    let _ = std::fs::remove_file(&path);
}

// ============================================================
// Main
// ============================================================

fn main() {
    // Parse CLI args
    let args = parse_args();

    // Panic hook: log but don't crash
    std::panic::set_hook(Box::new(|info| {
        flog!("PANIC: {}", info);
    }));

    // Initialize logger
    if let Some(logger) = log::init_logger("/tmp/webchatbridge-debug.log") {
        let _ = log::LOGGER.set(logger);
    }
    flog!("=== HTTP Server Starting ===");
    flog!("Bind address: {}:{}", args.host, args.port);

    // Create tokio runtime
    let rt = match tokio::runtime::Builder::new_multi_thread()
        .worker_threads(2)
        .enable_all()
        .build()
    {
        Ok(rt) => rt,
        Err(e) => {
            flog!("Failed to create tokio runtime: {}", e);
            std::process::exit(1);
        }
    };

    let host = args.host;
    let port = args.port;

    rt.block_on(async {
        // 创建 TaskManager
        let data_dir = dirs::home_dir()
            .unwrap_or_else(|| std::path::PathBuf::from("/tmp"))
            .join(".webchatbridge")
            .join("tasks");
        let task_manager = new_shared_task_manager(data_dir);
        flog!("TaskManager initialized");

        let registry = ToolRegistry::with_task_manager(task_manager.clone());
        flog!("Tool registry: {} tools", registry.list_tools().len());

        let state = AppState {
            registry: Arc::new(registry),
            start_time: Instant::now(),
            task_manager: Some(task_manager.clone()),
        };

        let app = create_router(state);

        // Parse bind address
        let addr: std::net::IpAddr = host.parse().unwrap_or_else(|_| {
            eprintln!("Invalid host: {}", host);
            std::process::exit(1);
        });
        let sock_addr = std::net::SocketAddr::new(addr, port);

        let listener = match tokio::net::TcpListener::bind(sock_addr).await {
            Ok(l) => l,
            Err(e) => {
                flog!("FATAL: Cannot bind {}:{} — {}", host, port, e);
                eprintln!("FATAL: Cannot bind {}:{} — {}", host, port, e);
                std::process::exit(1);
            }
        };

        flog!("Listening on http://{}:{}", host, port);
        println!("WebChatBridge listening on http://{}:{}", host, port);
        write_port_file(port);

        // Graceful shutdown on SIGTERM/SIGINT
        let tm_for_shutdown = task_manager.clone();
        let shutdown_signal = async move {
            let _ = tokio::signal::ctrl_c().await;
            flog!("Shutdown signal received, killing all background tasks...");
            let mut tm = tm_for_shutdown.lock().await;
            let tasks: Vec<String> = tm.list_tasks(false).iter()
                .filter(|t| t.status == tool::task_manager::TaskStatus::Running)
                .map(|t| t.id.clone())
                .collect();
            for id in tasks {
                if let Err(e) = tm.kill_task(&id).await {
                    flog!("Failed to kill task {}: {}", id, e);
                }
            }
            flog!("All background tasks killed");
        };

        // Run server
        axum::serve(listener, app)
            .with_graceful_shutdown(shutdown_signal)
            .await
            .unwrap_or_else(|e| {
                flog!("Server error: {}", e);
            });

        remove_port_file();
        flog!("=== HTTP Server Stopped ===");
    });
}
