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
    // DeepSeek 发送按钮：textarea 右侧、同行、class 含 sizing-container 的 icon-button
    const textarea = this.findInput();
    if (!textarea) return super._findSendButton();

    const taRect = textarea.getBoundingClientRect();
    const candidates = document.querySelectorAll<HTMLElement>(
      '[class*="icon-button"][class*="sizing-container"]',
    );

    let bestBtn: HTMLElement | null = null;
    let bestDist = Infinity;

    for (const el of candidates) {
      const rect = el.getBoundingClientRect();
      // 按钮在 textarea 下方同一行：y 在 textarea 底部附近
      const yBelow = rect.y - taRect.bottom;
      const xRight = rect.x - taRect.right;
      // yBelow: -10 ~ 80px（在 textarea 底部附近），xRight: -200 ~ 200px（在右侧或覆盖）
      if (yBelow >= -10 && yBelow <= 80 && xRight >= -200 && rect.width >= 25) {
        const isDisabled = el.classList.toString().includes('disabled') ||
                          el.getAttribute('aria-disabled') === 'true';
        if (!isDisabled) {
          // 优先选最右边的（发送按钮在最右侧）
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
