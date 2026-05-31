/**
 * Agent Loop — 智能体循环状态机
 * 平台无关的核心循环逻辑
 *
 * 状态机：
 * IDLE → DETECTING → EXECUTING → INJECTING → WAITING → IDLE
 *
 * 设计原则：
 * - 事件驱动，不轮询
 * - 只解析最后一条消息中的 tool_call
 * - 执行期间锁定输入框
 * - 同一时间只跑一个循环
 */

import { Logger } from '../core/logger';
import type { Adapter } from '../adapters/types';
import type { ToolCall, ToolResult } from '../core/types';
import type { ToolExecutor } from '../tools/executor.js';
import { AgentStorage } from './storage';
import { parseToolCallsFromText } from '../detector/parser';

// ============================================================
// 类型定义
// ============================================================

export type AgentState = 'idle' | 'detecting' | 'executing' | 'injecting' | 'waiting';

export interface AgentCallbacks {
  onStateChanged?: (state: AgentState, toolName?: string) => void;
  onToolCallDetected?: (toolCall: ToolCall) => void;
  onToolCallExecuted?: (toolCall: ToolCall, result: ToolResult) => void;
  onToolCallFailed?: (toolCall: ToolCall, error: string) => void;
  onLoopCompleted?: () => void;
  onError?: (error: string) => void;
}

// ============================================================
// 超时常量
// ============================================================

const EXECUTE_TIMEOUT_MS = 120_000;
const WAIT_TIMEOUT_MS = 60_000;

// ============================================================
// AgentLoop
// ============================================================

export class AgentLoop {
  private logger = new Logger('AgentLoop');
  private adapter: Adapter;
  private storage: AgentStorage;
  private callbacks: AgentCallbacks;

  private _state: AgentState = 'idle';
  private executor: ToolExecutor;
  private _currentToolCall: ToolCall | null = null;
  private _isRunning = false;
  private _stopRequested = false;
  private _conversationId: string = '';

  constructor(
    adapter: Adapter,
    storage: AgentStorage,
    executor: ToolExecutor,
    callbacks: AgentCallbacks = {},
  ) {
    this.adapter = adapter;
    this.storage = storage;
    this.executor = executor;
    this.callbacks = callbacks;
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

  /** 启动 agent loop */
  start(conversationId: string): void {
    this._conversationId = conversationId;
    this._isRunning = true;
    this._stopRequested = false;

    // 注册事件监听
    this.adapter.onGenerationComplete(() => this.onGenerationComplete());
    this.adapter.onAIStopped(() => this.onAIStopped());

    // 启动 adapter 状态监测
    if ((this.adapter as any).startMonitoring) {
      (this.adapter as any).startMonitoring();
    }

    this.logger.info(`AgentLoop started for conversation: ${conversationId}`);

    // 检查是否已有未执行的 tool_call（页面刷新恢复场景）
    setTimeout(async () => {
      if (this._isRunning && this._state === 'idle') {
        this.logger.info('Checking for existing tool_calls on startup');
        await this.delay(1500);
        await this.detectAndProcess();
      }
    }, 2000);
  }

  /** 停止 agent loop */
  stop(): void {
    this._stopRequested = true;
    this._isRunning = false;

    // 取消事件监听
    this.adapter.offGenerationComplete(() => this.onGenerationComplete());
    this.adapter.offAIStopped(() => this.onAIStopped());

    // 停止 adapter 状态监测
    if ((this.adapter as any).stopMonitoring) {
      (this.adapter as any).stopMonitoring();
    }

    // 解锁输入框，隐藏停止按钮
    this.adapter.unlockInput();

    this.setState('idle');
    this.logger.info('AgentLoop stopped');
  }

  /** 暂停（对话切换时） */
  pause(): void {
    this._isRunning = false;
    this.adapter.unlockInput();
    this.logger.info('AgentLoop paused');
  }

  /** 恢复（切回对话时） */
  resume(conversationId: string): void {
    this._conversationId = conversationId;
    this._isRunning = true;
    this._stopRequested = false;
    this.logger.info(`AgentLoop resumed for conversation: ${conversationId}`);

    // 对话切换后检查是否有待处理的 tool_call（可能在暂停期间生成）
    setTimeout(async () => {
      if (this._isRunning && this._state === 'idle') {
        this.logger.info('Checking for pending tool_calls after resume');
        // 等待 DOM 完成渲染
        await this.delay(1500);
        await this.detectAndProcess();
      }
    }, 2000);
  }

  // ============================================================
  // 事件处理
  // ============================================================

  /** AI 生成完成时触发 */
  private async onGenerationComplete(): Promise<void> {
    this.logger.info(`onGenerationComplete: isRunning=${this._isRunning}, stopRequested=${this._stopRequested}, state=${this._state}, isGenerating=${this.adapter.isGenerating()}`);
    if (!this._isRunning || this._stopRequested) return;
    if (this._state === 'executing' || this._state === 'injecting') return;

    this.logger.info('onGenerationComplete: Starting detection');
    // 等待 DOM 文本稳定（流式输出可能还在更新 textContent）
    await this.waitForTextStability();
    await this.detectAndProcess();
  }

  /** AI 停止时触发 */
  private onAIStopped(): void {
    if (!this._isRunning) return;

    this.logger.info('onAIStopped: AI was interrupted');
    this.stop();
    this.callbacks.onError?.('AI was interrupted');
  }

  // ============================================================
  // 核心循环
  // ============================================================

  // 防止并发检测
  private _detecting = false;

  /** 检测并处理 tool_call */
  private async detectAndProcess(): Promise<void> {
    if (this._detecting) {
      this.logger.info('detectAndProcess: ALREADY RUNNING, skipping');
      return;
    }
    // AI 还在生成中，不能处理 tool_call，否则修改输入框会导致 DeepSeek 停止
    if (this.adapter.isGenerating()) {
      this.logger.info('detectAndProcess: AI still generating, skipping');
      this.setState('idle');
      return;
    }
    this._detecting = true;
    this.setState('detecting');

    try {
      const element = this.adapter.getLastAIMessageElement();
      if (!element) {
        this.logger.info('detectAndProcess: NO AI MESSAGE ELEMENT FOUND');
        this.setState('idle');
        return;
      }

      // 去重由状态机保证：state=executing/waiting 时不会重复触发 detectAndProcess

      // 使用完整消息文本（包含 tool_call 前缀）
      const text = element.textContent || '';
      
      this.logger.info(`Detection: text length=${text.length}, preview=${text.substring(0, 200)}`);
      
      // 解析 tool_call
      const toolCalls = parseToolCallsFromText(text);
      this.logger.info(`Detection: found ${toolCalls.length} tool_call(s)`);

      if (toolCalls.length === 0) {
        // 检查是否是不完整的 tool_call（文本包含 tool_call 但解析器没找到完整的）
        if (text.includes('tool_call') && text.includes('===')) {
          this.logger.info('Incomplete tool_call detected, waiting for content to finish streaming');
          await this.delay(5000);
          // 重新检测
          const retryElement = this.adapter.getLastAIMessageElement();
          const retryText = retryElement?.textContent || '';
          if (retryElement === element) {
            // 同一个元素，重新解析
            const retryCalls = parseToolCallsFromText(retryText);
            if (retryCalls.length > 0) {
              this.logger.info(`Retry found ${retryCalls.length} tool_call(s)`);
              const retryLatest = retryCalls[retryCalls.length - 1];
              if (retryLatest.name) {
                const retryHash = this.computeHash(retryLatest);
                this.logger.info(`Detected tool_call on retry: ${retryLatest.name}`);
                this._currentToolCall = retryLatest;
                // removed _processedMessageElement
                this.callbacks.onToolCallDetected?.(retryLatest);
                await this.executeToolCall(retryLatest, retryHash);
                return;
              }
            }
          }
        }
        this.logger.debug('No tool_call found in last message');
        this.setState('idle');
        this.callbacks.onLoopCompleted?.();
        return;
      }

      // 取最后一个 tool_call
      const latest = toolCalls[toolCalls.length - 1];
      if (!latest.name) {
        this.logger.debug('tool_call has no name');
        this.setState('idle');
        return;
      }

      const hash = this.computeHash(latest);
      this.logger.info(`Detected tool_call: ${latest.name} (hash: ${hash})`);
      this._currentToolCall = latest;
      this.callbacks.onToolCallDetected?.(latest);

      // 执行
      await this.executeToolCall(latest, hash);

    } catch (error) {
      const msg = error instanceof Error ? error.message : String(error);
      this.logger.error('Detection failed', { error: msg });
      this.setState('idle');
      this.callbacks.onError?.(msg);
    } finally {
      this._detecting = false;
    }
  }

  /** 执行 tool_call */
  private async executeToolCall(toolCall: ToolCall, hash: string): Promise<void> {
    this.setState('executing');

    // 锁定输入框，显示停止按钮
    this.adapter.lockInput();

    try {
      // 执行工具
      const result = await Promise.race([
        this.executor.execute(toolCall),
        this.createTimeout(EXECUTE_TIMEOUT_MS, 'Tool execution timeout'),
      ]);

      this.logger.info(`Tool executed: ${toolCall.name}`, { success: result.success });
      this.callbacks.onToolCallExecuted?.(toolCall, result);

      // 注入结果
      await this.injectResult(toolCall, result, hash);

    } catch (error) {
      const msg = error instanceof Error ? error.message : String(error);
      this.logger.error(`Tool execution failed: ${toolCall.name}`, { error: msg });
      this.callbacks.onToolCallFailed?.(toolCall, msg);

      // 解锁输入框，隐藏停止按钮
      this.adapter.unlockInput();
      this.setState('idle');
      this.callbacks.onError?.(msg);

    } finally {
      this._currentToolCall = null;
    }
  }

  /** 注入结果到输入框并发送 */
  private async injectResult(toolCall: ToolCall, result: ToolResult, hash: string): Promise<void> {
    this.setState('injecting');

    try {
      // 注入前先解锁输入框（execCommand 需要可编辑的 textarea）
      this.adapter.unlockInput();

      // 格式化注入文本
      const injectText = this.formatResult(toolCall, result);

      // 注入到输入框
      const injected = this.adapter.injectTextSafely(injectText);
      if (!injected) {
        // 标记为已完成，防止无限重试
        await this.storage.markCompleted(this._conversationId, hash);
        throw new Error('Text injection failed');
      }

      // 等待注入生效
      await this.delay(500);

      // 点击发送
      const sent = await this.adapter.clickSend();
      if (!sent) {
        throw new Error('Send button not found');
      }

      // 标记为已完成
      await this.storage.markCompleted(this._conversationId, hash);

      this.logger.info(`Result injected and sent: ${toolCall.name}`);

      // 进入等待状态
      this.setState('waiting');

      // 答案已发出，释放检测锁，等待 AI 下一个问题
      this._detecting = false;

      // 等待 AI 开始生成
      await this.waitForGeneration();

    } catch (error) {
      const msg = error instanceof Error ? error.message : String(error);
      this.logger.error(`Injection failed: ${toolCall.name}`, { error: msg });

      // 即使注入失败也标记为已完成，防止无限重试同一 tool_call
      await this.storage.markCompleted(this._conversationId, hash);

      // 解锁输入框，隐藏停止按钮
      this.adapter.unlockInput();
      this.setState('idle');
      this.callbacks.onError?.(msg);
    }
  }

  /** 等待 AI 开始生成 */
  private async waitForGeneration(): Promise<void> {
    const deadline = Date.now() + WAIT_TIMEOUT_MS;

    while (Date.now() < deadline) {
      if (this._stopRequested) {
        this.stop();
        return;
      }

      if (this.adapter.isGenerating()) {
        this.logger.info('AI started generating');
        // 不操作输入框！DeepSeek 生成期间任何输入框修改都会导致停止
        this.setState('idle');
        return;
      }

      await this.delay(500);
    }

    // 超时
    this.logger.warn('Wait for generation timeout');
    this.adapter.unlockInput();
    this.setState('idle');
  }

  // ============================================================
  // 辅助方法
  // ============================================================

  /** 等待最后一条 AI 消息的文本内容稳定 */
  private async waitForTextStability(): Promise<void> {
    const maxWaitMs = 15_000;
    const checkIntervalMs = 500;
    let waited = 0;
    let lastText = '';
    let stableCount = 0;
    const requiredStableChecks = 2; // 连续2次文本不变才算稳定

    while (waited < maxWaitMs) {
      const element = this.adapter.getLastAIMessageElement();
      const currentText = element?.textContent || '';
      
      if (currentText === lastText && currentText.length > 0) {
        stableCount++;
        if (stableCount >= requiredStableChecks) {
          this.logger.debug(`Text stable after ${waited}ms: length=${currentText.length}`);
          return;
        }
      } else {
        stableCount = 0;
      }
      lastText = currentText;
      
      await this.delay(checkIntervalMs);
      waited += checkIntervalMs;
    }
    this.logger.warn(`Text stability timeout after ${maxWaitMs}ms`);
  }



  /** 设置状态 */
  private setState(state: AgentState): void {
    if (this._state === state) return;
    this._state = state;
    this.logger.info(`State changed: ${state}`);
    this.callbacks.onStateChanged?.(state, this._currentToolCall?.name);
  }

  /** 计算 tool_call 的 hash（用于去重） */
  private computeHash(toolCall: ToolCall): string {
    const str = JSON.stringify({ name: toolCall.name, arguments: toolCall.arguments });
    let hash = 0;
    for (let i = 0; i < str.length; i++) {
      const char = str.charCodeAt(i);
      hash = ((hash << 5) - hash) + char;
      hash = hash & hash;
    }
    return hash.toString(16);
  }

  // 去重由状态机保证，不再需要 _processedMessageElement

  /** 格式化工具结果为注入文本 */
  private formatResult(toolCall: ToolCall, result: ToolResult): string {
    let output = '';
    if (result.stdout) output += result.stdout;
    if (result.stderr) output += (output ? '\n' : '') + result.stderr;
    if (result.content) output += (output ? '\n' : '') + result.content;
    if (result.error) output += (output ? '\n' : '') + `ERROR: ${result.error}`;
    if (!output) output = result.success ? 'Command executed successfully (no output)' : 'Command failed';

    // 截断过长输出
    const MAX_OUTPUT_LEN = 8000;
    if (output.length > MAX_OUTPUT_LEN) {
      output = output.substring(0, MAX_OUTPUT_LEN) + '\n... (truncated)';
    }

    return `[工具执行结果: ${toolCall.name}]
${output}
[/工具执行结果]`;
  }

  /** 创建超时 Promise */
  private createTimeout(ms: number, message: string): Promise<never> {
    return new Promise((_, reject) => {
      setTimeout(() => reject(new Error(message)), ms);
    });
  }

  /** 延迟 */
  private delay(ms: number): Promise<void> {
    return new Promise(resolve => setTimeout(resolve, ms));
  }
}
