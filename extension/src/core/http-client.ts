/**
 * HTTP 客户端 — 与 Rust 本地 HTTP 服务器通信
 *
 * 日志路径: /tmp/webchatbridge-debug.log
 *
 * 设计原则：工具执行结果原封不动返回给 AI，不做客户端重试。
 * AI 有权根据错误信息自行决定下一步（重试、换参数、放弃等）。
 */

import { Logger } from './logger.js';
import { globalConfig } from './config.js';
import type { SystemInfo, ToolCall, ToolResult } from './types.js';

const HEALTH_TIMEOUT_MS = 3_000;
const TOOL_TIMEOUT_MS = 120_000;

export class HttpClient {
  private baseUrl: string | null = null;
  private logger = new Logger('HttpClient');

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
   * 执行工具调用 — 无重试，结果原封不动返回给 AI
   */
  async executeTool(call: ToolCall): Promise<ToolResult> {
    if (!this.baseUrl) {
      const ok = await this.init();
      if (!ok) {
        return { success: false, error: 'HTTP server not running' };
      }
    }

    return this.doExecuteTool(call);
  }

  private async doExecuteTool(call: ToolCall): Promise<ToolResult> {
    try {
      const controller = new AbortController();
      const timer = setTimeout(() => controller.abort(), TOOL_TIMEOUT_MS);

      const coercedArgs = coerceArgs(call.arguments);
      const response = await fetch(`${this.baseUrl}/api/tool`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ tool: call.name, arguments: coercedArgs }),
        signal: controller.signal,
      });
      clearTimeout(timer);

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

/**
 * Coerce string values to proper types in tool arguments.
 * Converts "true"/"false" to booleans, numeric strings to numbers.
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
