/**
 * RequestInterceptor — 基于 MAIN world 拦截器的事件接收器

 * 日志路径: /tmp/webchatbridge-debug.log (通过 native host 127.0.0.1:18789)
 *
 * 运行在 ISOLATED world，接收 MAIN world 通过 postMessage 发来的事件。
 * MAIN world 负责 hook fetch/XHR，这里只处理事件逻辑。
 */

import { Logger } from '../core/logger';
import type {
  InterceptorCallbacks,
  InterceptorSnapshot,
} from './types';

export class RequestInterceptor {
  private logger = new Logger('Interceptor');

  // 状态
  private _state: 'idle' | 'generating' | 'finished' = 'idle';
  private _accumulatedText = '';
  private _conversationId: string | null = null;
  private _lastUserMessage: string | null = null;
  private _finishedAt: number | null = null;


  private _callbacks: InterceptorCallbacks = {};
  private _messageHandler: ((event: MessageEvent) => void) | null = null;
  private _installed = false;

  // ============================================================
  // 生命周期
  // ============================================================

  install(callbacks: InterceptorCallbacks = {}): void {
    if (this._installed) return;
    this._callbacks = callbacks;

    this._messageHandler = (event: MessageEvent) => {
      if (event.source !== window) return;
      const data = event.data;
      if (!data || !data.__wcbInterceptor) return;
      this._handleMessage(data);
    };

    window.addEventListener('message', this._messageHandler);
    this._installed = true;
    this.logger.info('Interceptor installed (listening for MAIN world messages)');
  }

  uninstall(): void {
    if (!this._installed) return;
    if (this._messageHandler) {
      window.removeEventListener('message', this._messageHandler);
      this._messageHandler = null;
    }
    this._installed = false;
    this.logger.info('Interceptor uninstalled');
  }

  reset(): void {
    this._state = 'idle';
    this._accumulatedText = '';
    this._conversationId = null;
    this._lastUserMessage = null;
    this._finishedAt = null;
    this.logger.info('Interceptor state reset');
  }

  // ============================================================
  // 状态查询
  // ============================================================

  get state(): InterceptorSnapshot {
    return {
      aiStatus: this._state === 'generating' ? 'generating' : 'idle',
      platform: null,
      conversationId: this._conversationId,
      lastUserMessage: this._lastUserMessage,
      accumulatedText: this._accumulatedText,
      textStable: this._state === 'finished',
      finishedAt: this._finishedAt,
      updatedAt: Date.now(),
    };
  }

  isGenerating(): boolean {
    return this._state === 'generating';
  }

  getAccumulatedText(): string {
    return this._accumulatedText;
  }

  getConversationId(): string | null {
    return this._conversationId;
  }

  // ============================================================
  // 消息处理
  // ============================================================

  private _handleMessage(data: Record<string, unknown>): void {
    switch (data.type) {
      case 'send_detected':
        this._onSendDetected(
          data.message as string,
          data.conversationId as string | null,
        );
        break;
      case 'text_delta':
        this._onTextDelta(data.delta as string, data.accumulated as string);
        break;
      case 'generation_complete':
        this._onGenerationComplete(data.text as string);
        break;
      case 'tool_call_detected':
        this._onToolCallDetected(data.text as string);
        break;
      case 'main_world_log':
        this._onMainWorldLog(data);
        break;
      case 'sendViaApi_result':
        this._onSendViaApiResult(
          data.success as boolean,
          data.error as string | undefined,
        );
        break;
    }
  }

  private _onSendDetected(message: string, conversationId: string | null): void {
    this._state = 'generating';
    this._accumulatedText = '';
    this._lastUserMessage = message;
    this._conversationId = conversationId;
    this._finishedAt = null;
    this.logger.info(`Send detected: conv=${conversationId}, msg=${message.substring(0, 50)}...`);
    this._callbacks.onGenerationStart?.(conversationId);
  }

  private _onTextDelta(delta: string, accumulated: string): void {
    this._accumulatedText = accumulated;
    this._callbacks.onTextDelta?.(delta, accumulated);
  }

  private _onGenerationComplete(text: string): void {
    this._state = 'finished';
    this._finishedAt = Date.now();
    this._accumulatedText = text;
    this.logger.info(`Generation complete: text length=${text.length}`);
    this._callbacks.onGenerationComplete?.(text, this._conversationId);

    setTimeout(() => {
      this._state = 'idle';
    }, 1000);
  }

  private _onToolCallDetected(text: string): void {
    this.logger.info('Tool call detected');
    this._callbacks.onToolCallDetected?.(text);
  }

  private _onSendViaApiResult(success: boolean, error?: string): void {
    if (success) {
      this.logger.info('Tool result sent via API successfully');
    } else {
      this.logger.error('Tool result API send failed', { error });
    }
    this._callbacks.onSendViaApiResult?.(success, error);
  }

  /** 通过 MAIN world 直接调 DeepSeek API 发送消息 */
  /**
   * 接收 MAIN world 的日志并写入文件
   * 日志文件位置: /tmp/webchatbridge-debug.log
   */
  private _onMainWorldLog(data: Record<string, unknown>): void {
    const level = data.level as string;
    const msg = data.msg as string;
    const logData = data.data as string | undefined;
    
    // 转发到 native host 写入日志文件
    const body = JSON.stringify({
      module: 'MainWorld',
      msg: `[${level.toUpperCase()}] ${msg}`,
      data: logData,
    });
    
    try {
      fetch('http://127.0.0.1:18789/api/log', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body,
      }).catch(() => {});
    } catch { /* ignore */ }
    
    // 同时输出到控制台方便调试
    console.log(`[WCB MainWorld][${level}] ${msg}`, logData || '');
  }

  sendViaApi(message: string, conversationId: string): void {
    window.postMessage({
      __wcbType: 'sendViaApi',
      message,
      conversationId,
      platform: 'deepseek',
    }, '*');
    this.logger.info(`sendViaApi: message sent (${message.length} chars)`);
  }
}
