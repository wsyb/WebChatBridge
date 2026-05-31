/**
 * HTTP 客户端 — 与 Rust 本地 HTTP 服务器通信
 */

import { Logger } from './logger.js';
import { globalConfig } from './config.js';
import type { SystemInfo, ToolCall, ToolResult } from './types.js';

const HEALTH_TIMEOUT_MS = 3_000;
const TOOL_TIMEOUT_MS = 120_000;

// 重试配置
const MAX_RETRIES = 5;
const BASE_RETRY_DELAY_MS = 1_000;

// 熔断器配置
const CIRCUIT_BREAKER_THRESHOLD = 3;
const CIRCUIT_BREAKER_RESET_MS = 30_000;

// ---------------------------------------------------------------------------
// 熔断器
// ---------------------------------------------------------------------------

type CircuitState = 'closed' | 'open' | 'half-open';

class CircuitBreaker {
  private state: CircuitState = 'closed';
  private failures = 0;
  private openUntil = 0;

  get isOpen(): boolean {
    if (this.state === 'open' && Date.now() >= this.openUntil) {
      this.state = 'half-open';
      return false;
    }
    return this.state === 'open';
  }

  recordSuccess(): void {
    this.failures = 0;
    this.state = 'closed';
  }

  recordFailure(): void {
    this.failures++;
    if (this.failures >= CIRCUIT_BREAKER_THRESHOLD) {
      this.state = 'open';
      this.openUntil = Date.now() + CIRCUIT_BREAKER_RESET_MS;
    }
  }

  getState(): CircuitState {
    // 触发时间检查
    if (this.state === 'open' && Date.now() >= this.openUntil) {
      this.state = 'half-open';
    }
    return this.state;
  }
}

export class HttpClient {
  private baseUrl: string | null = null;
  private logger = new Logger('HttpClient');
  private circuitBreaker = new CircuitBreaker();

  /**
   * 初始化：连接服务器
   */
  async init(): Promise<boolean> {
    const host = globalConfig.get('nativeHost');
    const port = globalConfig.get('nativeHostPort');
    const ok = await this.tryHostPort(host, port);
    if (!ok) {
      this.logger.warn(`HTTP server not found at ${host}:${port}`);
    }
    return ok;
  }

  private async tryHostPort(host: string, port: number): Promise<boolean> {
    try {
      const controller = new AbortController();
      const timer = setTimeout(() => controller.abort(), HEALTH_TIMEOUT_MS);

      const response = await fetch(`http://${host}:${port}/health`, {
        signal: controller.signal,
      });
      clearTimeout(timer);

      if (response.ok) {
        this.baseUrl = `http://${host}:${port}`;
        this.logger.info(`Connected to HTTP server at ${host}:${port}`);
        return true;
      }
    } catch {
      // 服务器不可用
    }
    return false;
  }

  /**
   * 健康检查
   */
  async health(): Promise<boolean> {
    if (!this.baseUrl) {
      const ok = await this.init();
      if (!ok) return false;
    }
    try {
      const controller = new AbortController();
      const timer = setTimeout(() => controller.abort(), HEALTH_TIMEOUT_MS);
      const response = await fetch(`${this.baseUrl}/health`, {
        signal: controller.signal,
      });
      clearTimeout(timer);
      return response.ok;
    } catch {
      return false;
    }
  }

  /**
   * 执行工具调用（指数退避重试 + 熔断器）
   */
  async executeTool(call: ToolCall): Promise<ToolResult> {
    if (!this.baseUrl) {
      const ok = await this.init();
      if (!ok) {
        return { success: false, error: 'HTTP server not running' };
      }
    }

    // 熔断器检查
    if (this.circuitBreaker.isOpen) {
      this.logger.warn(`Circuit breaker open, rejecting tool: ${call.name}`);
      return { success: false, error: 'Service temporarily unavailable (circuit breaker open)' };
    }

    let lastError: string | undefined;

    for (let attempt = 0; attempt <= MAX_RETRIES; attempt++) {
      if (attempt > 0) {
        const delayMs = BASE_RETRY_DELAY_MS * Math.pow(2, attempt - 1);
        this.logger.info(`Retry ${attempt}/${MAX_RETRIES} for ${call.name} after ${delayMs}ms`);
        await delay(delayMs);

        // 重试前重新检查连接
        if (!this.baseUrl) {
          const ok = await this.init();
          if (!ok) {
            return { success: false, error: lastError || 'HTTP server not running' };
          }
        }
      }

      const result = await this.doExecuteTool(call);

      if (result.success) {
        this.circuitBreaker.recordSuccess();
        return result;
      }

      lastError = result.error;

      // 4xx 错误不重试（客户端错误）
      if (result.error?.startsWith('HTTP 4')) {
        return result;
      }
    }

    // 所有重试失败
    this.circuitBreaker.recordFailure();
    return { success: false, error: lastError || 'All retries exhausted' };
  }

  private async doExecuteTool(call: ToolCall): Promise<ToolResult> {
    try {
      const controller = new AbortController();
      const timer = setTimeout(() => controller.abort(), TOOL_TIMEOUT_MS);

      // Coerce string values to proper types before sending
      const coercedArgs = coerceArgs(call.arguments);
      const response = await fetch(`${this.baseUrl}/api/tool`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ tool: call.name, arguments: coercedArgs }),
        signal: controller.signal,
      });
      clearTimeout(timer);

      // 先检查 HTTP 状态码
      if (!response.ok) {
        return { success: false, error: `HTTP ${response.status}` };
      }

      const data = await response.json();
      return {
        success: data.success,
        content: data.content,
        error: data.error,
      };
    } catch (error) {
      const msg = error instanceof Error ? error.message : String(error);
      this.logger.error(`Tool execution failed: ${msg}`);

      // 只在连接被拒时重置 baseUrl（TypeError: Failed to fetch）
      // 超时（AbortError）和其他错误不重置
      if (error instanceof TypeError) {
        this.baseUrl = null;
      }

      return { success: false, error: msg };
    }
  }

  /**
   * 获取系统信息
   */
  async getSystemInfo(): Promise<SystemInfo> {
    const defaultInfo: SystemInfo = {
      os: 'linux',
      shell: 'bash',
      pathSeparator: '/',
      homeDir: '',
      workDir: '',
    };

    if (!this.baseUrl) {
      const ok = await this.init();
      if (!ok) return defaultInfo;
    }

    try {
      const controller = new AbortController();
      const timer = setTimeout(() => controller.abort(), HEALTH_TIMEOUT_MS);
      const response = await fetch(`${this.baseUrl}/api/system`, {
        signal: controller.signal,
      });
      clearTimeout(timer);

      if (!response.ok) return defaultInfo;

      const data = await response.json();
      return {
        os: data.os || 'linux',
        shell: data.shell || 'bash',
        pathSeparator: data.path_separator || '/',
        homeDir: data.home_dir || '',
        workDir: data.work_dir || '',
      };
    } catch {
      return defaultInfo;
    }
  }

  // ============================================================
  // Task management API
  // ============================================================

  async taskList(): Promise<{ success: boolean; data?: unknown; error?: string }> {
    return this.callTaskTool('task_list', {});
  }

  async taskLogs(taskId: string, tail?: number): Promise<{ success: boolean; data?: unknown; error?: string }> {
    return this.callTaskTool('task_logs', { task_id: taskId, ...(tail ? { tail } : {}) });
  }

  async taskKill(taskId: string): Promise<{ success: boolean; data?: unknown; error?: string }> {
    return this.callTaskTool('task_kill', { task_id: taskId });
  }

  async taskRestart(taskId: string): Promise<{ success: boolean; data?: unknown; error?: string }> {
    return this.callTaskTool('task_restart', { task_id: taskId });
  }

  private async callTaskTool(tool: string, args: Record<string, unknown>): Promise<{ success: boolean; data?: unknown; error?: string }> {
    if (!this.baseUrl) {
      const ok = await this.init();
      if (!ok) return { success: false, error: 'HTTP server not running' };
    }
    try {
      const controller = new AbortController();
      const timer = setTimeout(() => controller.abort(), 10_000);
      const response = await fetch(`${this.baseUrl}/api/tool`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ tool, arguments: args }),
        signal: controller.signal,
      });
      clearTimeout(timer);
      if (!response.ok) return { success: false, error: `HTTP ${response.status}` };
      const data = await response.json();
      return { success: data.success, data: data.content ? tryParseJSON(data.content) : undefined, error: data.error };
    } catch (error) {
      return { success: false, error: error instanceof Error ? error.message : String(error) };
    }
  }
}


function tryParseJSON(str: string): unknown {
  try { return JSON.parse(str); } catch { return str; }
}

function delay(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

/**
 * Coerce string values to proper types in tool arguments.
 * Converts "true"/"false" to booleans, numeric strings to numbers.
 * This handles cases where the text parser stores all values as strings.
 */
function coerceArgs(args: Record<string, unknown>): Record<string, unknown> {
  const result: Record<string, unknown> = {};
  for (const [key, value] of Object.entries(args)) {
    if (typeof value === 'string') {
      const lower = value.toLowerCase();
      if (lower === 'true') { result[key] = true; continue; }
      if (lower === 'false') { result[key] = false; continue; }
      const trimmed = value.trim();
      if (trimmed !== '' && !isNaN(Number(trimmed))) { result[key] = Number(trimmed); continue; }
    }
    result[key] = value;
  }
  return result;
}

// 全局单例
export const httpClient = new HttpClient();
