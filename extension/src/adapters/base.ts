/**
 * BaseAdapter — 所有平台适配器的基类
 * 提供通用实现，子类只需覆盖平台特定逻辑
 */

import type { Adapter } from './types';
import type { AIStatus, AIStateSnapshot } from '../core/types';
import { Logger } from '../core/logger';

export class BaseAdapter implements Adapter {
  name = 'base';
  protected logger = new Logger('Adapter');
  protected _loadingElement: HTMLElement | null = null;

  messageSelectors: string[] = [
    '[class*="assistant"]',
    '[class*="ai-message"]',
    '[class*="bot-message"]',
  ];

  // 事件监听器存储
  private _generationCompleteCallbacks: Set<() => void> = new Set();
  private _aiStoppedCallbacks: Set<() => void> = new Set();

  detect(): boolean {
    return false;
  }

  getConversationId(): string {
    return window.location.href;
  }

  // ============================================================
  // AI 状态检测（默认实现，子类可覆盖）
  // ============================================================

  getAIStatus(): AIStatus {
    if (this.isGenerating()) return 'generating';
    if (this.isPaused()) return 'paused';
    return 'idle';
  }

  getAIStateSnapshot(): AIStateSnapshot {
    const hasStopBtn = this.hasStopButton();
    const hasContinueBtn = !!this.findContinueButton();
    const hasRegenBtn = !!this.findRegenerateButton();
    const textarea = this.findInput();
    const textareaHasContent = textarea
      ? ((textarea as HTMLTextAreaElement).value || '').length > 0
      : false;

    let status: AIStatus = 'idle';
    if (hasStopBtn) status = 'generating';
    else if (hasContinueBtn) status = 'paused';

    return {
      status,
      hasContinueButton: hasContinueBtn,
      hasStopButton: hasStopBtn,
      hasRegenerateButton: hasRegenBtn,
      textareaHasContent,
      timestamp: Date.now(),
    };
  }

  isGenerating(): boolean {
    return this.hasStopButton();
  }

  isIdle(): boolean {
    const state = this.getAIStateSnapshot();
    return !state.hasStopButton && !state.hasContinueButton && !state.textareaHasContent;
  }

  isPaused(): boolean {
    return !!this.findContinueButton();
  }

  isReady(): boolean {
    // 默认实现：发送按钮存在且可用
    const sendBtn = this.findSendButton();
    if (!sendBtn) return false;
    return !this.isButtonDisabled(sendBtn) && !this.isGenerating();
  }

  protected hasStopButton(): boolean {
    const buttons = document.querySelectorAll<HTMLButtonElement>('button');
    for (const btn of buttons) {
      const text = btn.textContent?.trim() || '';
      const label = btn.getAttribute('aria-label') || '';
      if (text.includes('停止') || text.includes('Stop') ||
          label.includes('停止') || label.includes('Stop')) {
        return true;
      }
    }
    return false;
  }

  // ============================================================
  // 消息读取
  // ============================================================

  getLastAIMessageElement(): Element | null {
    for (const selector of this.messageSelectors) {
      const elements = document.querySelectorAll(selector);
      if (elements.length > 0) {
        return elements[elements.length - 1];
      }
    }
    return null;
  }

  getLastAIMessage(): string {
    const el = this.getLastAIMessageElement();
    return el?.textContent || '';
  }

  // ============================================================
  // 输入相关（通用实现）
  // ============================================================

  findInput(): HTMLElement | null {
    return (
      document.querySelector('textarea') ||
      document.querySelector('[contenteditable="true"]') ||
      document.querySelector('input[type="text"]')
    );
  }

  findInputContainer(): HTMLElement | null {
    const input = this.findInput();
    if (!input) return null;
    return (
      input.closest('[class*="input"]') ||
      input.closest('[class*="editor"]') ||
      input.closest('form') ||
      input.parentElement?.parentElement ||
      null
    );
  }

  findSendButton(): HTMLButtonElement | null {
    // 优先找"继续生成"按钮（AI 暂停状态）
    const continueBtn = this.findContinueButton();
    if (continueBtn) return continueBtn;

    // 按 aria-label 精确匹配
    const byLabel =
      document.querySelector<HTMLButtonElement>('button[aria-label*="发送" i]') ||
      document.querySelector<HTMLButtonElement>('button[aria-label*="send" i]') ||
      document.querySelector<HTMLButtonElement>('button[aria-label*="submit" i]');
    if (byLabel && !this.isButtonDisabled(byLabel)) return byLabel;

    // 按 type="submit" 匹配
    const byType = document.querySelector<HTMLButtonElement>(
      'form button[type="submit"]:not([disabled])',
    );
    if (byType && !this.isButtonDisabled(byType)) return byType;

    // 几何距离 fallback
    const input = this.findInput();
    if (!input) return null;

    const inputRect = input.getBoundingClientRect();
    const buttons = document.querySelectorAll<HTMLButtonElement>('button, [role="button"]');

    for (const btn of buttons) {
      if (this.isButtonDisabled(btn)) continue;
      const rect = btn.getBoundingClientRect();
      const distanceY = rect.top - inputRect.bottom;
      const distanceX = rect.left - inputRect.right;

      if (distanceY >= -10 && distanceY < 50 && distanceX > -50) {
        return btn;
      }
    }

    return null;
  }

  findContinueButton(): HTMLButtonElement | null {
    const buttons = document.querySelectorAll<HTMLButtonElement>('button');
    for (const btn of buttons) {
      const text = btn.textContent?.trim() || '';
      if (text.includes('继续生成') || text.includes('Continue') || text.includes('继续')) {
        if (!this.isButtonDisabled(btn)) return btn;
      }
    }
    return null;
  }

  findRegenerateButton(): HTMLElement | null {
    return null;
  }

  isButtonDisabled(btn: HTMLButtonElement): boolean {
    if (btn.disabled) return true;
    if (btn.getAttribute('aria-disabled') === 'true') return true;
    return false;
  }

  // ============================================================
  // 文本注入
  // ============================================================

  injectTextSafely(text: string): boolean {
    const input = this.findInput();
    if (!input) {
      this.logger.error('injectTextSafely: no input found');
      return false;
    }

    // 方法 1: execCommand（最兼容）
    try {
      input.focus();
      const ok = document.execCommand('insertText', false, text);
      if (ok) {
        this.logger.info('injectTextSafely: execCommand succeeded');
        return true;
      }
    } catch {
      // execCommand 失败
    }

    // 方法 2: 直接设置 value + 触发事件（React 兼容）
    try {
      const textarea = input as HTMLTextAreaElement;
      const nativeInputValueSetter = Object.getOwnPropertyDescriptor(
        window.HTMLTextAreaElement.prototype, 'value'
      )?.set;
      if (nativeInputValueSetter) {
        nativeInputValueSetter.call(textarea, text);
      } else {
        textarea.value = text;
      }
      textarea.dispatchEvent(new Event('input', { bubbles: true }));
      textarea.dispatchEvent(new Event('change', { bubbles: true }));
      this.logger.info('injectTextSafely: value setter succeeded');
      return true;
    } catch {
      // value setter 失败
    }

    // 方法 3: DataTransfer + paste
    try {
      input.focus();
      const dataTransfer = new DataTransfer();
      dataTransfer.setData('text/plain', text);
      const pasteEvent = new ClipboardEvent('paste', {
        bubbles: true,
        cancelable: true,
        clipboardData: dataTransfer,
      });
      input.dispatchEvent(pasteEvent);
      this.logger.info('injectTextSafely: paste event dispatched');
      return true;
    } catch {
      // paste 失败
    }

    this.logger.warn('injectTextSafely: all methods failed');
    return false;
  }

  async clickSend(): Promise<boolean> {
    const maxWaitMs = 10000;
    const interval = 200;
    let waited = 0;

    while (waited < maxWaitMs) {
      const sendBtn = this.findSendButton();
      if (sendBtn && !this.isButtonDisabled(sendBtn)) {
        sendBtn.click();
        this.logger.info('clickSend: Send button clicked');
        return true;
      }
      await new Promise(resolve => setTimeout(resolve, interval));
      waited += interval;
    }

    // Fallback: Enter 键
    this.logger.warn('clickSend: Send button timeout, trying Enter key');
    const input = this.findInput();
    if (input) {
      input.dispatchEvent(new KeyboardEvent('keydown', {
        key: 'Enter', code: 'Enter', bubbles: true,
      }));
      return true;
    }

    return false;
  }

  // ============================================================
  // 输入框锁定
  // ============================================================

  lockInput(): void {
    const input = this.findInput();
    if (input) {
      (input as HTMLTextAreaElement).disabled = true;
      input.setAttribute('data-agent-locked', 'true');
      this.logger.info('lockInput: Input locked');
    }
  }

  unlockInput(): void {
    const input = this.findInput();
    if (input) {
      (input as HTMLTextAreaElement).disabled = false;
      input.removeAttribute('data-agent-locked');
      this.logger.info('unlockInput: Input unlocked');
    }
  }

  // ============================================================
  // 停止按钮
  // ============================================================



  // ============================================================
  // 事件系统
  // ============================================================

  onGenerationComplete(callback: () => void): void {
    this._generationCompleteCallbacks.add(callback);
  }

  offGenerationComplete(callback: () => void): void {
    this._generationCompleteCallbacks.delete(callback);
  }

  protected emitGenerationComplete(): void {
    this.logger.info(`[Base] emitGenerationComplete: ${this._generationCompleteCallbacks.size} callback(s) registered`);
    for (const cb of this._generationCompleteCallbacks) {
      try {
        cb();
      } catch (e) {
        this.logger.error('GenerationComplete callback error', { error: String(e) });
      }
    }
  }

  onAIStopped(callback: () => void): void {
    this._aiStoppedCallbacks.add(callback);
  }

  offAIStopped(callback: () => void): void {
    this._aiStoppedCallbacks.delete(callback);
  }

  protected emitAIStopped(): void {
    for (const cb of this._aiStoppedCallbacks) {
      try {
        cb();
      } catch (e) {
        this.logger.error('AIStopped callback error', { error: String(e) });
      }
    }
  }

  // ============================================================
  // UI 操作
  // ============================================================

  hideInput(): HTMLElement | null {
    const container = this.findInputContainer();
    if (container) {
      container.style.opacity = '0';
      container.style.pointerEvents = 'none';
      return container;
    }
    const input = this.findInput();
    if (input) {
      input.style.opacity = '0';
      input.style.pointerEvents = 'none';
      return input;
    }
    return null;
  }

  showInput(element: HTMLElement): void {
    element.style.opacity = '';
    element.style.pointerEvents = '';
  }

  showLoading(): void {
    this.hideLoading();

    const container = this.findInputContainer();
    if (!container || !container.parentNode) return;

    this._loadingElement = document.createElement('div');
    this._loadingElement.style.cssText = `
      display: flex;
      align-items: center;
      justify-content: center;
      padding: 12px;
      color: #888;
      font-size: 14px;
      gap: 8px;
    `;
    this._loadingElement.innerHTML = `
      <div style="
        width: 16px;
        height: 16px;
        border: 2px solid #333;
        border-top-color: #e94560;
        border-radius: 50%;
        animation: spin 1s linear infinite;
      "></div>
      <span>执行命令中...</span>
    `;

    if (!document.getElementById('__wcb_loading_style')) {
      const style = document.createElement('style');
      style.id = '__wcb_loading_style';
      style.textContent = `
        @keyframes spin {
          to { transform: rotate(360deg); }
        }
      `;
      document.head.appendChild(style);
    }

    container.parentNode.insertBefore(this._loadingElement, container.nextSibling);
  }

  hideLoading(): void {
    if (this._loadingElement) {
      this._loadingElement.remove();
      this._loadingElement = null;
    }
  }


  /**
   * 将图片粘贴到输入框（通过 DataTransfer + paste 事件）
   * @param dataUrl base64 data URL (data:image/png;base64,...)
   */
  async injectImagePaste(dataUrl: string): Promise<boolean> {
    const input = this.findInput();
    if (!input) {
      this.logger.error('injectImagePaste: No input found');
      return false;
    }

    try {
      // base64 → Blob
      const response = await fetch(dataUrl);
      const blob = await response.blob();

      // Blob → File
      const file = new File([blob], 'screenshot.png', { type: blob.type });

      // File → DataTransfer
      const dataTransfer = new DataTransfer();
      dataTransfer.items.add(file);

      // 构造 paste 事件
      input.focus();
      const pasteEvent = new ClipboardEvent('paste', {
        bubbles: true,
        cancelable: true,
        clipboardData: dataTransfer,
      });
      input.dispatchEvent(pasteEvent);

      this.logger.info('injectImagePaste: Image paste event dispatched');
      return true;
    } catch (error) {
      const msg = error instanceof Error ? error.message : String(error);
      this.logger.error(`injectImagePaste failed: ${msg}`);
      return false;
    }
  }

}
