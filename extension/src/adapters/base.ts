/**
 * BaseAdapter — 输入操作的通用实现

 * 日志路径: /tmp/webchatbridge-debug.log (通过 native host 127.0.0.1:18789)
 *
 * 只负责：文本注入、发送按钮点击、输入框锁定。
 * 状态检测由 RequestInterceptor 在 API 层完成。
 */

import type { Adapter } from './types';
import { Logger } from '../core/logger';

export class BaseAdapter implements Adapter {
  name = 'base';
  protected logger = new Logger('Adapter');

  detect(): boolean {
    return false;
  }

  getConversationId(): string {
    return window.location.href;
  }

  // ============================================================
  // 输入操作
  // ============================================================

  findInput(): HTMLElement | null {
    return (
      document.querySelector('textarea') ||
      document.querySelector('[contenteditable="true"]') ||
      document.querySelector('input[type="text"]')
    );
  }

  injectTextSafely(text: string): boolean {
    const input = this.findInput();
    if (!input) {
      this.logger.error('injectTextSafely: no input found');
      return false;
    }

    // 必须先 focus，否则 execCommand 和后续事件都无法正确触发 React 状态更新
    input.focus();

    // 方法 1: execCommand insertText（能正确触发 React onChange，让发送按钮启用）
    try {
      // 先清空
      (input as HTMLTextAreaElement).value = '';
      input.dispatchEvent(new Event('input', { bubbles: true }));
      const ok = document.execCommand('insertText', false, text);
      if (ok && this._verifyInsertion(input, text)) {
        this.logger.info('injectTextSafely: execCommand succeeded');
        return true;
      }
    } catch {
      // ignore
    }

    // 方法 2: native setter + React 合成事件
    try {
      const nativeSetter = Object.getOwnPropertyDescriptor(
        window.HTMLTextAreaElement.prototype, 'value',
      )?.set;
      if (nativeSetter) {
        nativeSetter.call(input, text);
      } else {
        (input as HTMLTextAreaElement).value = text;
      }
      input.dispatchEvent(new Event('input', { bubbles: true }));
      input.dispatchEvent(new Event('change', { bubbles: true }));
      if (this._verifyInsertion(input, text)) {
        this.logger.info('injectTextSafely: native setter succeeded');
        return true;
      }
    } catch {
      // ignore
    }

    // 方法 3: paste 事件
    try {
      const dataTransfer = new DataTransfer();
      dataTransfer.setData('text/plain', text);
      const pasteEvent = new ClipboardEvent('paste', {
        bubbles: true,
        cancelable: true,
        clipboardData: dataTransfer,
      });
      input.dispatchEvent(pasteEvent);
      if (this._verifyInsertion(input, text)) {
        this.logger.info('injectTextSafely: paste succeeded');
        return true;
      }
    } catch {
      // ignore
    }

    this.logger.warn('injectTextSafely: all methods failed');
    return false;
  }

  /** 验证文本是否成功插入 */
  private _verifyInsertion(input: HTMLElement, text: string): boolean {
    const val = (input as HTMLTextAreaElement).value || (input as HTMLElement).textContent || '';
    return val.includes(text.substring(0, Math.min(20, text.length)));
  }

  async clickSend(): Promise<boolean> {
    const input = this.findInput();
    if (!input) {
      this.logger.error('clickSend: no input found');
      return false;
    }

    // 尝试点击发送按钮
    const maxWaitMs = 10000;
    const interval = 200;
    let waited = 0;

    while (waited < maxWaitMs) {
      const sendBtn = this._findSendButton();
      if (sendBtn && !this._isButtonDisabled(sendBtn)) {
        sendBtn.click();
        this.logger.info('clickSend: button clicked');
        return true;
      }
      await new Promise(resolve => setTimeout(resolve, interval));
      waited += interval;
    }

    // Fallback: execCommand 模拟 Enter（比合成 KeyboardEvent 更可靠）
    this.logger.warn('clickSend: button not found/enabled, trying execCommand Enter');
    input.focus();
    document.execCommand('insertText', false, '\n');
    this.logger.info('clickSend: execCommand Enter dispatched');
    return true;
  }

  lockInput(): void {
    const input = this.findInput();
    if (input) {
      (input as HTMLTextAreaElement).disabled = true;
      input.setAttribute('data-agent-locked', 'true');
      this.logger.info('lockInput: locked');
    }
  }

  unlockInput(): void {
    const input = this.findInput();
    if (input) {
      (input as HTMLTextAreaElement).disabled = false;
      input.removeAttribute('data-agent-locked');
      this.logger.info('unlockInput: unlocked');
    }
  }

  // ============================================================
  // 发送按钮查找（通用 fallback）
  // ============================================================

  protected _findSendButton(): HTMLButtonElement | null {
    // 按 aria-label 查找
    const byLabel =
      document.querySelector<HTMLButtonElement>('button[aria-label*="发送" i]') ||
      document.querySelector<HTMLButtonElement>('button[aria-label*="send" i]') ||
      document.querySelector<HTMLButtonElement>('button[aria-label*="submit" i]');
    if (byLabel && !this._isButtonDisabled(byLabel)) return byLabel;

    // 按 form submit 查找
    const byType = document.querySelector<HTMLButtonElement>(
      'form button[type="submit"]:not([disabled])',
    );
    if (byType && !this._isButtonDisabled(byType)) return byType;

    // 定位策略：找到 textarea 下方/右侧的 icon-button（发送按钮）
    const input = this.findInput();
    if (input) {
      const inputRect = input.getBoundingClientRect();
      const candidates = document.querySelectorAll<HTMLElement>('[class*="icon-button"][class*="sizing-container"]');
      let bestBtn: HTMLElement | null = null;
      let bestX = -Infinity;
      for (const el of candidates) {
        const rect = el.getBoundingClientRect();
        // 按钮在 textarea 底部附近（y 在 bottom-10 到 bottom+80 之间）
        const yBelow = rect.y - inputRect.bottom;
        const xRight = rect.x - inputRect.right;
        if (yBelow >= -10 && yBelow <= 80 && xRight >= -200 && rect.width >= 25) {
          if (xRight > bestX) {
            bestX = xRight;
            bestBtn = el;
          }
        }
      }
      if (bestBtn && !this._isButtonDisabled(bestBtn as any)) {
        return bestBtn as HTMLButtonElement;
      }
    }

    return null;
  }

  protected _isButtonDisabled(btn: HTMLButtonElement): boolean {
    return btn.disabled ||
      btn.getAttribute('aria-disabled') === 'true' ||
      btn.classList.contains('disabled');
  }
}
