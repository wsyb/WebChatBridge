import type { ToolResult, ToolCall } from '../core/types.js';
import type { ToolRegistry } from './registry.js';
import { httpClient } from '../core/http-client.js';
import { Logger } from '../core/logger.js';

const logger = new Logger('ToolExecutor');

const BROWSER_TOOL_PREFIX = 'browser_';
const TOOL_TIMEOUT_MS = 30_000;

// ============================================================
// 端口管理器（单例，持久连接）
// ============================================================

class PortManager {
  private port: chrome.runtime.Port | null = null;
  private pendingCalls = new Map<number, { resolve: (v: any) => void; timer: ReturnType<typeof setTimeout> }>();
  private nextId = 1;

  private ensurePort(): chrome.runtime.Port {
    if (this.port) return this.port;

    this.port = chrome.runtime.connect({ name: 'wcb-port' });

    this.port.onMessage.addListener((message) => {
      const pending = this.pendingCalls.get(message.id);
      if (pending) {
        clearTimeout(pending.timer);
        this.pendingCalls.delete(message.id);
        pending.resolve(message.result);
      }
    });

    this.port.onDisconnect.addListener(() => {
      logger.warn('Port disconnected, will reconnect on next call');
      this.port = null;
      // 拒绝所有等待中的调用
      for (const [id, pending] of this.pendingCalls) {
        clearTimeout(pending.timer);
        pending.resolve({ success: false, error: 'Port disconnected' });
      }
      this.pendingCalls.clear();
    });

    return this.port;
  }

  call(type: string, request: unknown): Promise<any> {
    const port = this.ensurePort();
    const id = this.nextId++;

    return new Promise((resolve) => {
      const timer = setTimeout(() => {
        this.pendingCalls.delete(id);
        resolve({ success: false, error: `Port call timeout: ${type}` });
      }, TOOL_TIMEOUT_MS);

      this.pendingCalls.set(id, { resolve, timer });

      port.postMessage({ id, type, request });
    });
  }
}

const portManager = new PortManager();

// ============================================================
// ToolExecutor
// ============================================================

export class ToolExecutor {
  constructor(private registry: ToolRegistry) {}

  async execute(call: ToolCall): Promise<ToolResult> {
    const tool = this.registry.get(call.name);
    if (!tool) {
      return { success: false, error: `Unknown tool: ${call.name}` };
    }

    // Browser tools: send to background via port
    if (call.name.startsWith(BROWSER_TOOL_PREFIX)) {
      logger.info(`Executing browser tool via port: ${call.name}`);
      try {
        const result = await portManager.call('BROWSER_TOOL', { name: call.name, arguments: call.arguments });
        return {
          success: result?.success ?? false,
          content: result?.content,
          error: result?.error,
        };
      } catch (error) {
        const msg = error instanceof Error ? error.message : String(error);
        logger.error(`Browser tool failed: ${call.name}`, { error: msg });
        return { success: false, error: msg };
      }
    }

    // Other tools: send to Rust backend
    return httpClient.executeTool(call);
  }
}
