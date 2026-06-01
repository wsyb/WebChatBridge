use axum::{
    extract::State,
    http::StatusCode,
    response::Json,
    routing::{get, post},
    Router,
};
use serde::{Deserialize, Serialize};
use serde_json::Value;
use std::sync::Arc;
use std::time::Instant;
use tower_http::cors::{Any, CorsLayer};

use crate::tool::task_manager::SharedTaskManager;
use crate::tool::{ToolContext, ToolRegistry};

// ============================================================
// Shared state
// ============================================================

#[derive(Clone)]
pub struct AppState {
    pub registry: Arc<ToolRegistry>,
    pub start_time: Instant,
    pub task_manager: Option<SharedTaskManager>,
}

// ============================================================
// Request / Response types
// ============================================================

#[derive(Debug, Deserialize)]
pub struct ToolRequest {
    pub tool: String,
    pub arguments: Value,
}

#[derive(Debug, Serialize)]
pub struct ToolResponse {
    pub success: bool,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub content: Option<String>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub error: Option<String>,
}

#[derive(Debug, Serialize)]
pub struct HealthResponse {
    pub status: String,
    pub version: String,
    pub uptime_seconds: u64,
}

#[derive(Debug, Serialize)]
pub struct SystemInfo {
    pub os: String,
    pub shell: String,
    pub path_separator: String,
    pub home_dir: Option<String>,
    pub work_dir: Option<String>,
}

#[derive(Debug, Deserialize)]
pub struct LogRequest {
    pub module: String,
    pub msg: String,
    pub data: Option<Value>,
}

// ============================================================
// Route handlers
// ============================================================

async fn handle_health(State(state): State<AppState>) -> Json<HealthResponse> {
    Json(HealthResponse {
        status: "ok".to_string(),
        version: env!("CARGO_PKG_VERSION").to_string(),
        uptime_seconds: state.start_time.elapsed().as_secs(),
    })
}

async fn handle_list_tools(State(state): State<AppState>) -> Json<Value> {
    let tools = state.registry.list_tools();
    Json(serde_json::json!({ "tools": tools }))
}

async fn handle_system_info() -> Json<SystemInfo> {
    Json(SystemInfo {
        os: std::env::consts::OS.to_string(),
        shell: if cfg!(target_os = "windows") {
            "cmd".to_string()
        } else {
            "bash".to_string()
        },
        path_separator: std::path::MAIN_SEPARATOR.to_string(),
        home_dir: dirs::home_dir().map(|p| p.to_string_lossy().to_string()),
        work_dir: std::env::current_dir()
            .ok()
            .map(|p| p.to_string_lossy().to_string()),
    })
}

async fn handle_log(Json(req): Json<LogRequest>) -> Json<Value> {
    let data_str = req.data.as_ref().map(|v| v.to_string());
    crate::log::log_ext(&req.module, &req.msg, data_str.as_deref());
    Json(serde_json::json!({ "ok": true }))
}

async fn handle_tool_call(
    State(state): State<AppState>,
    Json(req): Json<ToolRequest>,
) -> (StatusCode, Json<ToolResponse>) {
    let args = req.arguments;
    let name = req.tool.clone();
    let name_for_match = name.clone();
    let registry = state.registry.clone();

    // Execute with catch_unwind + timeout for fault isolation
    let result = tokio::task::spawn_blocking(move || {
        // Re-acquire tool reference inside the blocking task
        let tool = match registry.get(&name) {
            Some(t) => t,
            None => {
                return Err(format!("Unknown tool: {}", name));
            }
        };
        let res = std::panic::catch_unwind(std::panic::AssertUnwindSafe(|| {
            let rt = tokio::runtime::Handle::current();
            rt.block_on(async {
                tokio::time::timeout(
                    std::time::Duration::from_secs(120),
                    tool.execute(
                        args,
                        ToolContext {
                            working_dir: None,
                            task_manager: state.task_manager.clone(),
                        },
                    ),
                )
                .await
            })
        }));
        Ok(res)
    })
    .await;

    // Layers: spawn_blocking -> our Ok/Err -> catch_unwind -> timeout -> execute
    match result {
        Ok(Ok(Ok(Ok(Ok(output))))) => (
            StatusCode::OK,
            Json(ToolResponse {
                success: true,
                content: Some(output.content),
                error: None,
            }),
        ),
        Ok(Ok(Ok(Ok(Err(e))))) => (
            StatusCode::OK,
            Json(ToolResponse {
                success: false,
                content: None,
                error: Some(e.to_string()),
            }),
        ),
        Ok(Ok(Ok(Err(_)))) => (
            StatusCode::GATEWAY_TIMEOUT,
            Json(ToolResponse {
                success: false,
                content: None,
                error: Some(format!(
                    "Tool '{}' timed out after 120 seconds",
                    name_for_match
                )),
            }),
        ),
        Ok(Ok(Err(e))) => (
            StatusCode::INTERNAL_SERVER_ERROR,
            Json(ToolResponse {
                success: false,
                content: None,
                error: Some(format!("Tool '{}' panicked: {:?}", name_for_match, e)),
            }),
        ),
        Ok(Err(e)) => (
            StatusCode::BAD_REQUEST,
            Json(ToolResponse {
                success: false,
                content: None,
                error: Some(e),
            }),
        ),
        Err(e) => (
            StatusCode::INTERNAL_SERVER_ERROR,
            Json(ToolResponse {
                success: false,
                content: None,
                error: Some(format!("Task join error: {}", e)),
            }),
        ),
    }
}

// ============================================================
// Router
// ============================================================

pub fn create_router(state: AppState) -> Router {
    let cors = CorsLayer::new()
        .allow_origin(Any)
        .allow_methods(Any)
        .allow_headers(Any);

    Router::new()
        .route("/health", get(handle_health))
        .route("/api/tools", get(handle_list_tools))
        .route("/api/system", get(handle_system_info))
        .route("/api/tool", post(handle_tool_call))
        .route("/api/log", post(handle_log))
        .with_state(state)
        .layer(cors)
}
