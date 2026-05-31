/**
 * Kimi 适配器
 * 封装 kimi.com / kimi.moonshot.cn 的所有平台特定逻辑
 */

import { BaseAdapter } from '../base';

export class KimiAdapter extends BaseAdapter {
  name = 'kimi';

  messageSelectors: string[] = [
    '.chat-content-item-assistant',
  ];

  private _wasGenerating = false;
  private _statusCheckInterval: ReturnType<typeof setInterval> | null = null;
  private _lastSeenMessageCount: number | undefined = undefined;

  detect(): boolean {
    return (
      window.location.hostname.includes('kimi.moonshot.cn') ||
      window.location.hostname.includes('www.kimi.com')
    );
  }

  getConversationId(): string {
    const url = window.location.href;
    const match = url.match(/\/chat\/([a-f0-9-]+)/);
    return match ? match[1] : url;
  }

  // ============================================================
  // 事件驱动检测
  // ============================================================

  startMonitoring(): void {
    if (this._statusCheckInterval) return;
    this._wasGenerating = this.isGenerating();
    // 初始化为当前实际消息数，避免已有消息被误判为"新消息"
    const kimiMsgs = document.querySelectorAll('[class*="message"]');
    this._lastSeenMessageCount = kimiMsgs.length;
    this.logger.info(`Kimi: Initial isGenerating=${this._wasGenerating}, initialMsgCount=${this._lastSeenMessageCount}`);

    const observer = new MutationObserver(() => this.checkStatusChange());
    observer.observe(document.body, {
      childList: true,
      subtree: true,
      attributes: true,
      attributeFilter: ['class', 'disabled', 'aria-disabled'],
    });

    this._statusCheckInterval = setInterval(() => this.checkStatusChange(), 1000);
    this.logger.info('Kimi: Status monitoring started');
  }

  stopMonitoring(): void {
    if (this._statusCheckInterval) {
      clearInterval(this._statusCheckInterval);
      this._statusCheckInterval = null;
    }
  }

  private checkStatusChange(): void {
    const isCurrentlyGenerating = this.isGenerating();

    if (this._wasGenerating && !isCurrentlyGenerating) {
      this.logger.info('Kimi: Generation completed');
      this.emitGenerationComplete();
    }

    if (!this._wasGenerating && !isCurrentlyGenerating && !this.isPaused()) {
      const msgs = document.querySelectorAll('.chat-content-item-assistant');
      const msgCount = msgs.length;
      if (
        msgCount > 0 &&
        this._lastSeenMessageCount !== undefined &&
        msgCount > this._lastSeenMessageCount
      ) {
        this.logger.info(
          `Kimi: New message detected (count ${this._lastSeenMessageCount} -> ${msgCount}), triggering completion`,
        );
        this.emitGenerationComplete();
      }
      this._lastSeenMessageCount = msgCount;
    } else {
      const msgs = document.querySelectorAll('.chat-content-item-assistant');
      this._lastSeenMessageCount = msgs.length;
    }

    this._wasGenerating = isCurrentlyGenerating;
  }

  // ============================================================
  // 消息读取
  // ============================================================

  getLastAIMessageElement(): Element | null {
    const messages = document.querySelectorAll('.chat-content-item-assistant');
    if (messages.length === 0) return null;
    return messages[messages.length - 1];
  }

  getLastAIMessage(): string {
    const el = this.getLastAIMessageElement();
    const md = el?.querySelector('.markdown');
    return md?.textContent || el?.textContent || '';
  }

  // ============================================================
  // 输入相关
  // ============================================================

  findInput(): HTMLElement | null {
    return document.querySelector('.chat-input-editor');
  }

  findInputContainer(): HTMLElement | null {
    return document.querySelector('.chat-input');
  }

  findSendButton(): HTMLButtonElement | null {
    const container = document.querySelector('.send-button-container');
    if (!container) return null;
    if (container.classList.contains('stop')) return null;
    return container as unknown as HTMLButtonElement;
  }

  findContinueButton(): HTMLButtonElement | null {
    return null;
  }

  findRegenerateButton(): HTMLElement | null {
    const messages = document.querySelectorAll('.chat-content-item-assistant');
    if (messages.length === 0) return null;
    const lastMsg = messages[messages.length - 1] as HTMLElement;
    const actions = lastMsg.querySelector('.segment-assistant-actions-content');
    if (!actions) return null;

    const iconBtns = actions.querySelectorAll('.icon-button');
    for (const btn of iconBtns) {
      const svg = btn.querySelector('svg');
      if (svg?.getAttribute('name') === 'Refresh') {
        return btn as HTMLElement;
      }
    }
    return null;
  }

  isButtonDisabled(btn: HTMLButtonElement): boolean {
    if (btn.classList.contains('disabled')) return true;
    if (btn.getAttribute('aria-disabled') === 'true') return true;
    if ((btn as HTMLButtonElement).disabled) return true;
    return false;
  }

  // ============================================================
  // AI 状态检测
  // ============================================================

  isGenerating(): boolean {
    const container = document.querySelector('.send-button-container');
    if (!container) return false;
    if (container.classList.contains('stop')) return true;
    const svg = container.querySelector('svg');
    if (svg?.getAttribute('name') === 'stop') return true;
    return false;
  }

  isIdle(): boolean {
    if (this.isGenerating()) return false;
    if (this.isPaused()) return false;
    const input = this.findInput();
    const hasContent = input && (input.textContent || '').trim().length > 0;
    return !hasContent;
  }

  isPaused(): boolean {
    return !!this.findContinueButton();
  }

  isReady(): boolean {
    if (this.isGenerating()) return false;
    if (this.isPaused()) return false;
    const container = document.querySelector('.send-button-container');
    if (!container) return false;
    if (container.classList.contains('stop')) return false;
    return true;
  }

  // ============================================================
  // 输入注入（Lexical 编辑器特化）
  // ============================================================

  /**
   * Kimi 使用 Lexical contenteditable 编辑器。
   * execCommand('insertText') 会丢失换行，改用 paste 注入。
   */
  injectTextSafely(text: string): boolean {
    const input = this.findInput();
    if (!input) {
      this.logger.error('Kimi: injectTextSafely - no input found');
      return false;
    }

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
      this.logger.info('Kimi: injectTextSafely via paste succeeded');
      return true;
    } catch {
      // paste 失败，fallback
    }

    try {
      input.focus();
      const ok = document.execCommand('insertText', false, text);
      if (ok) {
        this.logger.info('Kimi: injectTextSafely via execCommand succeeded');
        return true;
      }
    } catch {
      // ignore
    }

    this.logger.warn('Kimi: injectTextSafely all methods failed');
    return false;
  }

  /**
   * Kimi 发送按钮是 div.send-button-container。
   * 如果有文件附件，需要等文件上传完成（class 包含 success）再发送。
   */
  async clickSend(): Promise<boolean> {
    const maxWaitMs = 15000;
    const intervalMs = 300;
    let waited = 0;

    while (waited < maxWaitMs) {
      const container = document.querySelector('.send-button-container');
      if (container && !container.classList.contains('stop')) {
        const rect = container.getBoundingClientRect();
        const cx = rect.left + rect.width / 2;
        const cy = rect.top + rect.height / 2;

        // mousedown + mouseup + click 模拟真实鼠标操作
        // 单独 .click() 不会触发 Kimi 的发送
        container.dispatchEvent(new MouseEvent('mousedown', {
          bubbles: true, cancelable: true, view: window,
          clientX: cx, clientY: cy, button: 0,
        }));
        container.dispatchEvent(new MouseEvent('mouseup', {
          bubbles: true, cancelable: true, view: window,
          clientX: cx, clientY: cy, button: 0,
        }));
        container.dispatchEvent(new MouseEvent('click', {
          bubbles: true, cancelable: true, view: window,
          clientX: cx, clientY: cy, button: 0,
        }));

        this.logger.info('Kimi: clickSend - dispatched mousedown+mouseup+click');
        return true;
      }

      await new Promise((r) => setTimeout(r, intervalMs));
      waited += intervalMs;
    }

    // fallback: 回车
    this.logger.warn('Kimi: clickSend - timeout, trying Enter');
    const input = this.findInput();
    if (input) {
      input.dispatchEvent(new KeyboardEvent('keydown', {
        key: 'Enter', code: 'Enter', bubbles: true,
      }));
      return true;
    }

    return false;
  }
}
