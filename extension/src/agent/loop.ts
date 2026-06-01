/**
 * Agent Loop — Tool Call 循环引擎

 * 日志路径: /tmp/webchatbridge-debug.log (通过 native host 127.0.0.1:18789)
 *
 * 核心逻辑（对讲机模式）：
 *   generation_complete → 检测 tool_call → 执行 → 发送结果 → 等 send_detected → 等下一个 generation_complete → 循环
 *   直到 AI 不再输出 tool_call
 *
 * 无去重，无持久化。
 */

import { Logger } from '../core/logger';
import type { Adapter } from '../adapters/types';
import type { ToolCall, ToolResult } from '../core/types';
import { httpClient } from '../core/http-client';
import { parseToolCallsFromText } from '../detector/parser';
import { RequestInterceptor } from '../interceptor';

// ============================================================
// 类型定义
// ============================================================

export type AgentState = 'idle' | 'generating' | 'executing' | 'injecting' | 'clicking' | 'waiting';

export interface AgentCallbacks {
  onStateChanged?: (state: AgentState, toolName?: string) => void;
  onTextDelta?: (textLength: number) => void;
  onToolCallDetected?: (toolCall: ToolCall) => void;
  onToolCallExecuted?: (toolCall: ToolCall, result: ToolResult) => void;
  onToolCallFailed?: (toolCall: ToolCall, error: string) => void;
  onLoopCompleted?: () => void;
  onError?: (error: string) => void;
}

// ============================================================
// 常量
// ============================================================

const EXECUTE_TIMEOUT_MS = 120_000;
const SEND_MAX_RETRIES = 3;

// ============================================================
// AgentLoop — 循环引擎
// ============================================================

export class AgentLoop {
  private logger = new Logger('AgentLoop');
  private adapter: Adapter;
  private interceptor: RequestInterceptor;
  private callbacks: AgentCallbacks;

  private _state: AgentState = 'idle';
  private _isRunning = false;
  // removed

  // 循环控制：等待 generation_complete
  private _resolveWaiting: (() => void) | null = null;

  constructor(
    adapter: Adapter,
    _storage: any,
    callbacks: AgentCallbacks = {},
    interceptor?: RequestInterceptor,
  ) {
    this.adapter = adapter;
    this.callbacks = callbacks;
    this.interceptor = interceptor || new RequestInterceptor();
  }

  get state(): AgentState {
    return this._state;
  }

  get isRunning(): boolean {
    return this._isRunning;
  }

  // ============================================================
  // 生命周期
  // ============================================================

  start(conversationId: string): void {
    // conversationId: ${conversationId}
    this._isRunning = true;

    // 安装拦截器事件
    this.interceptor.install({
      onGenerationStart: () => this._onGenerationStart(),
      onTextDelta: (_delta, accumulated) => this._onTextDelta(accumulated),
      onGenerationComplete: (text, _convId) => this._onGenerationComplete(text),
      onToolCallDetected: (_text) => { /* 可扩展 */ },
    });

    this.logger.info(`AgentLoop started for conversation: ${conversationId}`);

    // 启动循环
    this._runLoop();
  }

  stop(): void {
    this._isRunning = false;
    this.interceptor.uninstall();
    this.adapter.unlockInput();
    this.setState('idle');
    // 唤醒可能在等待的循环
    if (this._resolveWaiting) {
      this._resolveWaiting();
      this._resolveWaiting = null;
    }
    this.logger.info('AgentLoop stopped');
  }

  pause(): void {
    this._isRunning = false;
    this.adapter.unlockInput();
    if (this._resolveWaiting) {
      this._resolveWaiting();
      this._resolveWaiting = null;
    }
    this.logger.info('AgentLoop paused');
  }

  resume(conversationId: string): void {
    if (this._isRunning) {
      this.logger.debug('AgentLoop already running, skip resume');
      return;
    }
    this._isRunning = true;
    this.logger.info(`AgentLoop resumed for: ${conversationId}`);
    this._runLoop();
  }

  // ============================================================
  // 核心循环
  // ============================================================

  private async _runLoop(): Promise<void> {
    while (this._isRunning) {
      // 等待 generation_complete 事件（不设置状态，等到事件到达后再设）
      const text = await this._waitForGeneration();
      if (!this._isRunning) break;

      if (!text) {
        this.logger.debug('Empty generation, continuing...');
        continue;
      }

      // 解析 tool_call
      const toolCalls = parseToolCallsFromText(text);
      if (toolCalls.length === 0) {
        this.logger.info('No tool_call in generation, loop idle');
        this.setState('idle');
        continue;
      }

      // 取最后一个 tool_call（AI 可能输出多个）
      const toolCall = toolCalls[toolCalls.length - 1];
      this.logger.info(`Tool call detected: ${toolCall.name}`);
      this.callbacks.onToolCallDetected?.(toolCall);

      // 执行 → 发送 → 验证
      const success = await this._executeAndSend(toolCall);
      if (!this._isRunning) break;

      if (!success) {
        this.logger.error(`Tool call ${toolCall.name} failed after retries`);
        this.setState('idle');
        continue;
      }

      // 发送成功，继续循环等待下一个 generation_complete
      this.logger.info(`Tool call ${toolCall.name} completed, continuing loop`);
    }
  }

  // ============================================================
  // 等待 generation_complete
  // ============================================================

  private _waitForGeneration(): Promise<string | null> {
    return new Promise((resolve) => {
      if (!this._isRunning) {
        resolve(null);
        return;
      }

      this._resolveWaiting = () => {
        this._resolveWaiting = null;
        resolve(this._lastGenerationText);
      };

      // 超时保护：120 秒
      setTimeout(() => {
        if (this._resolveWaiting) {
          this._resolveWaiting = null;
          this.logger.warn('waitForGeneration timeout');
          resolve(null);
        }
      }, 120_000);
    });
  }

  private _lastGenerationText: string | null = null;

  private _onGenerationStart(): void {
    this.setState('generating');
  }

  private _onTextDelta(accumulated: string): void {
    this.callbacks.onTextDelta?.(accumulated.length);
  }

  private _onGenerationComplete(text: string): void {
    this.logger.info(`Generation complete: text length=${text.length}`);
    this._lastGenerationText = text;

    if (this._resolveWaiting) {
      const resolve = this._resolveWaiting;
      this._resolveWaiting = null;
      resolve();
    }
  }

  // ============================================================
  // 执行 + 发送
  // ============================================================

  private async _executeAndSend(toolCall: ToolCall): Promise<boolean> {
    // 1. 执行工具
    this.setState('executing');
    this.adapter.lockInput();

    let result: ToolResult;
    try {
      result = await Promise.race([
        httpClient.executeTool(toolCall),
        this._timeout(EXECUTE_TIMEOUT_MS, 'Tool execution timeout'),
      ]);
    } catch (error) {
      const msg = error instanceof Error ? error.message : String(error);
      this.logger.error(`Tool execution failed: ${toolCall.name}`, { error: msg });
      this.adapter.unlockInput();
      this.callbacks.onToolCallFailed?.(toolCall, msg);
      return false;
    }

    this.callbacks.onToolCallExecuted?.(toolCall, result);
    this.logger.info(`Tool executed: ${toolCall.name}, success=${result.success}`);

    // 2. 发送结果（带验证闭环）
    this.adapter.unlockInput();
    const sent = await this._injectAndSend(toolCall, result);
    return sent;
  }

  // ============================================================
  // 注入 + 发送
  // ============================================================

  private async _injectAndSend(toolCall: ToolCall, result: ToolResult): Promise<boolean> {
    const injectText = this._formatResult(toolCall, result);
    return this._injectTextAndSend(toolCall, injectText);
  }

  private async _injectTextAndSend(toolCall: ToolCall, injectText: string): Promise<boolean> {
    for (let attempt = 1; attempt <= SEND_MAX_RETRIES; attempt++) {
      this.logger.info(`Send attempt ${attempt}/${SEND_MAX_RETRIES}: ${toolCall.name}`);

      this.setState('injecting');
      this.adapter.unlockInput();
      await this._delay(100);

      const injected = this.adapter.injectTextSafely(injectText);
      if (!injected) {
        this.logger.warn(`Inject failed on attempt ${attempt}`);
        continue;
      }

      await this._delay(500);

      this.setState('clicking');
      const clicked = await this.adapter.clickSend();
      if (!clicked) {
        this.logger.warn(`Click send failed on attempt ${attempt}`);
        continue;
      }

      this.setState('waiting');
      this.logger.info(`Result sent: ${toolCall.name}`);
      return true;
    }

    return false;
  }



  // ============================================================
  // 辅助
  // ============================================================

  private setState(state: AgentState): void {
    if (this._state === state) return;
    this._state = state;
    this.logger.info(`State: ${state}`);
    this.callbacks.onStateChanged?.(state);
  }

  private _formatResult(toolCall: ToolCall, result: ToolResult): string {
    let output = '';
    if (result.stdout) output += result.stdout;
    if (result.stderr) output += (output ? '\n' : '') + result.stderr;
    if (result.content) output += (output ? '\n' : '') + result.content;
    if (result.error) output += (output ? '\n' : '') + `ERROR: ${result.error}`;
    if (!output) output = result.success ? 'Command executed successfully (no output)' : 'Command failed';

    // 不再截断——read 工具已内置 200 行分页

    return `[工具执行结果: ${toolCall.name}]\n${output}\n[/工具执行结果]`;
  }

  private _timeout(ms: number, msg: string): Promise<never> {
    return new Promise((_, reject) => setTimeout(() => reject(new Error(msg)), ms));
  }

  private _delay(ms: number): Promise<void> {
    return new Promise(resolve => setTimeout(resolve, ms));
  }
}
