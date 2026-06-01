/**
 * 豆包适配器 — 只保留输入操作
 */

import { BaseAdapter } from '../base';

export class DoubaoAdapter extends BaseAdapter {
  name = 'doubao';

  detect(): boolean {
    return window.location.hostname.includes('www.doubao.com');
  }

  getConversationId(): string {
    const url = window.location.href;
    const match = url.match(/\/chat\/(\d+)/);
    return match ? match[1] : url;
  }

  findInput(): HTMLElement | null {
    return document.querySelector('textarea.semi-input-textarea') ||
           document.querySelector('textarea');
  }

  /**
   * 豆包使用 Semi Design 的 textarea。
   * paste → execCommand → native setter 三级 fallback。
   */
  injectTextSafely(text: string): boolean {
    const input = this.findInput();
    if (!input) {
      this.logger.error('Doubao: injectTextSafely - no input found');
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

      const currentValue = (input as HTMLTextAreaElement).value;
      if (currentValue.includes(text.substring(0, 20))) {
        this.logger.info('Doubao: injectTextSafely via paste succeeded');
        return true;
      }
    } catch {
      // paste 失败
    }

    try {
      input.focus();
      const ok = document.execCommand('insertText', false, text);
      if (ok) {
        this.logger.info('Doubao: injectTextSafely via execCommand succeeded');
        return true;
      }
    } catch {
      // ignore
    }

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
      this.logger.info('Doubao: injectTextSafely via native setter succeeded');
      return true;
    } catch {
      // ignore
    }

    this.logger.warn('Doubao: injectTextSafely all methods failed');
    return false;
  }

  async clickSend(): Promise<boolean> {
    const maxWaitMs = 10000;
    const intervalMs = 300;
    let waited = 0;

    while (waited < maxWaitMs) {
      const sendBtn = this._findDoubaoSendButton();
      if (sendBtn && !this._isButtonDisabled(sendBtn)) {
        const rect = sendBtn.getBoundingClientRect();
        const cx = rect.left + rect.width / 2;
        const cy = rect.top + rect.height / 2;

        sendBtn.dispatchEvent(new MouseEvent('mousedown', {
          bubbles: true, cancelable: true, view: window,
          clientX: cx, clientY: cy, button: 0,
        }));
        sendBtn.dispatchEvent(new MouseEvent('mouseup', {
          bubbles: true, cancelable: true, view: window,
          clientX: cx, clientY: cy, button: 0,
        }));
        sendBtn.dispatchEvent(new MouseEvent('click', {
          bubbles: true, cancelable: true, view: window,
          clientX: cx, clientY: cy, button: 0,
        }));

        this.logger.info('Doubao: clickSend succeeded');
        return true;
      }

      await new Promise((r) => setTimeout(r, intervalMs));
      waited += intervalMs;
    }

    // fallback: 回车
    this.logger.warn('Doubao: clickSend timeout, trying Enter');
    const input = this.findInput();
    if (input) {
      input.dispatchEvent(new KeyboardEvent('keydown', {
        key: 'Enter', code: 'Enter', bubbles: true,
      }));
      return true;
    }

    return false;
  }

  private _findDoubaoSendButton(): HTMLButtonElement | null {
    const wrapper = document.querySelector('.send-btn-wrapper');
    if (wrapper) {
      const btn = wrapper.querySelector('button') || wrapper as unknown as HTMLButtonElement;
      return btn as HTMLButtonElement;
    }
    return null;
  }
}
