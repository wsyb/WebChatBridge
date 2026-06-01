/**
 * DeepSeek 适配器 — 只保留输入操作
 */

import { BaseAdapter } from '../base';

export class DeepSeekAdapter extends BaseAdapter {
  name = 'deepseek';

  detect(): boolean {
    return window.location.hostname.includes('chat.deepseek.com');
  }

  getConversationId(): string {
    const url = window.location.href;
    const match = url.match(/\/chat\/s\/([a-f0-9-]+)/);
    return match ? match[1] : url;
  }

  findInput(): HTMLElement | null {
    return document.querySelector('textarea');
  }

  protected _findSendButton(): HTMLButtonElement | null {
    // DeepSeek 发送按钮：textarea 下方、class 含 ds-button--primary 的圆形按钮
    const textarea = this.findInput();
    if (!textarea) return super._findSendButton();

    const taRect = textarea.getBoundingClientRect();

    // 策略 1：找 ds-button--primary（新版 DeepSeek UI）
    const primaryBtns = document.querySelectorAll<HTMLElement>(
      '[class*="ds-button--primary"][class*="ds-button--filled"]',
    );
    for (const el of primaryBtns) {
      const rect = el.getBoundingClientRect();
      const yBelow = rect.y - taRect.bottom;
      if (yBelow >= -10 && yBelow <= 80 && rect.width >= 20 && rect.width <= 60) {
        const isDisabled = el.classList.toString().includes('disabled') ||
                          el.getAttribute('aria-disabled') === 'true';
        if (!isDisabled) return el as HTMLButtonElement;
      }
    }

    // 策略 2：找 icon-button（旧版 DeepSeek UI）
    const candidates = document.querySelectorAll<HTMLElement>(
      '[class*="icon-button"][class*="sizing-container"]',
    );
    let bestBtn: HTMLElement | null = null;
    let bestDist = Infinity;
    for (const el of candidates) {
      const rect = el.getBoundingClientRect();
      const yBelow = rect.y - taRect.bottom;
      const xRight = rect.x - taRect.right;
      if (yBelow >= -10 && yBelow <= 80 && xRight >= -200 && rect.width >= 25) {
        const isDisabled = el.classList.toString().includes('disabled') ||
                          el.getAttribute('aria-disabled') === 'true';
        if (!isDisabled) {
          if (xRight > bestDist || bestBtn === null) {
            bestDist = xRight;
            bestBtn = el;
          }
        }
      }
    }
    if (bestBtn) return bestBtn as HTMLButtonElement;

    return super._findSendButton();
  }
}
