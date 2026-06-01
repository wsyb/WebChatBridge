/**
 * Kimi 适配器 — 只保留输入操作
 */

import { BaseAdapter } from '../base';

export class KimiAdapter extends BaseAdapter {
  name = 'kimi';

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

  findInput(): HTMLElement | null {
    return document.querySelector('.chat-input-editor') ||
           document.querySelector('[contenteditable="true"]');
  }

  /**
   * Kimi 使用 Lexical contenteditable 编辑器。
   * paste 事件注入最可靠。
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
      // paste 失败
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
   * 需要模拟完整鼠标事件序列。
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

        this.logger.info('Kimi: clickSend succeeded');
        return true;
      }

      await new Promise((r) => setTimeout(r, intervalMs));
      waited += intervalMs;
    }

    // fallback: 回车
    this.logger.warn('Kimi: clickSend timeout, trying Enter');
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
