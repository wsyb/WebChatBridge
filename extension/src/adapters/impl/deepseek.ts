/**
 * DeepSeek 适配器
 * 封装 chat.deepseek.com 的所有平台特定逻辑
 */

import { BaseAdapter } from '../base';

export class DeepSeekAdapter extends BaseAdapter {
  name = 'deepseek';

  messageSelectors: string[] = [
    '.ds-assistant-message-main-content',
  ];

  // 状态追踪
  private _wasGenerating = false;
  private _lastSeenMessageCount: number | undefined = undefined;
  private _statusCheckInterval: ReturnType<typeof setInterval> | null = null;

  detect(): boolean {
    return window.location.hostname.includes('chat.deepseek.com');
  }

  getConversationId(): string {
    const url = window.location.href;
    const match = url.match(/\/chat\/s\/([a-f0-9-]+)/);
    return match ? match[1] : url;
  }

  // ============================================================
  // 事件驱动检测（替代 polling）
  // ============================================================

  /** 启动状态监测（在 adapter 初始化时调用） */
  startMonitoring(): void {
    if (this._statusCheckInterval) return;

    // 初始化当前状态（避免首次误触发）
    this._wasGenerating = this.isGenerating();
    const initMsgs = document.querySelectorAll('.ds-assistant-message-main-content');
    this._lastSeenMessageCount = initMsgs.length;
    this.logger.info(`DeepSeek: Initial isGenerating=${this._wasGenerating}, initialMsgCount=${this._lastSeenMessageCount}`);

    // 使用 MutationObserver 监听 DOM 变化
    const observer = new MutationObserver(() => {
      this.checkStatusChange();
    });

    // 监听整个 body 的变化
    observer.observe(document.body, {
      childList: true,
      subtree: true,
      attributes: true,
      attributeFilter: ['disabled', 'aria-disabled', 'class'],
    });

    // 也用定时器作为 fallback（某些变化可能不触发 MutationObserver）
    this._statusCheckInterval = setInterval(() => {
      this.checkStatusChange();
    }, 1000);

    this.logger.info('DeepSeek: Status monitoring started');
  }

  /** 停止状态监测 */
  stopMonitoring(): void {
    if (this._statusCheckInterval) {
      clearInterval(this._statusCheckInterval);
      this._statusCheckInterval = null;
    }
  }

  /** 检查状态变化并触发事件 */
  private checkStatusChange(): void {
    const isCurrentlyGenerating = this.isGenerating();

    // 从 generating → 非 generating = 生成完成
    if (this._wasGenerating && !isCurrentlyGenerating) {
      this.logger.info('DeepSeek: Generation completed');
      this.emitGenerationComplete();

      // 检测 AI 停止（有"已停止"标签）
      if (this.hasStoppedLabel()) {
        this.logger.info('DeepSeek: AI stopped');
        this.emitAIStopped();
      }
    }

    // 补偿机制：AI 确认不在生成中时，检查是否有新消息
    // 防止 isGenerating() 漏检导致新 tool_call 无法被发现
    if (!isCurrentlyGenerating && !this._wasGenerating && !this.isPaused()) {
      const msgs = document.querySelectorAll('.ds-assistant-message-main-content');
      const msgCount = msgs.length;
      if (msgCount > 0 && this._lastSeenMessageCount !== undefined && msgCount > this._lastSeenMessageCount) {
        this.logger.info(`DeepSeek: New message detected (count ${this._lastSeenMessageCount} -> ${msgCount})`);
        this.emitGenerationComplete();
      }
      this._lastSeenMessageCount = msgCount;
    } else {
      const msgs = document.querySelectorAll('.ds-assistant-message-main-content');
      this._lastSeenMessageCount = msgs.length;
    }

    this._wasGenerating = isCurrentlyGenerating;
  }

  /** 检测是否有"已停止"标签 */
  private hasStoppedLabel(): boolean {
    const stoppedLabels = ['已停止', 'Stopped', 'Stop'];
    const dsMessages = document.querySelectorAll<HTMLElement>('.ds-message');
    if (dsMessages.length === 0) return false;

    const lastDsMsg = dsMessages[dsMessages.length - 1];
    const allEls = lastDsMsg.querySelectorAll('*');
    for (const el of allEls) {
      if (el.children.length === 0) {
        const t = el.textContent?.trim() || '';
        if (stoppedLabels.includes(t)) {
          return true;
        }
      }
    }
    return false;
  }

  // ============================================================
  // 消息读取
  // ============================================================

  getLastAIMessageElement(): Element | null {
    const messages = document.querySelectorAll('.ds-assistant-message-main-content');
    if (messages.length === 0) return null;
    return messages[messages.length - 1];
  }

  getLastAIMessage(): string {
    const el = this.getLastAIMessageElement();
    return el?.textContent || '';
  }

  // ============================================================
  // 输入相关
  // ============================================================

  findInput(): HTMLElement | null {
    return document.querySelector('textarea');
  }

  findInputContainer(): HTMLElement | null {
    const textarea = this.findInput();
    if (!textarea) return null;
    return (
      textarea.closest('._020ab5b') ||
      textarea.closest('[class*="input-container"]') ||
      textarea.parentElement?.parentElement ||
      null
    );
  }

  // ============================================================
  // 按钮检测
  // ============================================================

  findSendButton(): HTMLButtonElement | null {
    // 优先检查"继续生成"按钮
    const continueBtn = this.findContinueButton();
    if (continueBtn) return continueBtn;

    // 方法 1：按 aria-label 精确匹配
    const byLabel =
      document.querySelector<HTMLButtonElement>('button[aria-label*="发送" i]') ||
      document.querySelector<HTMLButtonElement>('button[aria-label*="send" i]') ||
      document.querySelector<HTMLButtonElement>('button[aria-label*="submit" i]');
    if (byLabel && !this.isButtonDisabled(byLabel)) return byLabel;

    // 方法 2：按 type="submit" 匹配
    const byType = document.querySelector<HTMLButtonElement>(
      'form button[type="submit"]:not([disabled])',
    );
    if (byType && !this.isButtonDisabled(byType)) return byType;

    // 方法 3：几何距离 fallback
    const textarea = this.findInput();
    if (!textarea) return null;

    const textareaRect = textarea.getBoundingClientRect();
    const roleButtons = document.querySelectorAll<HTMLElement>('[role="button"]');
    const nearbyButtons: { element: HTMLButtonElement; distanceX: number; distanceY: number }[] = [];

    for (const btn of roleButtons) {
      if (btn.getAttribute('aria-disabled') === 'true') continue;
      if ((btn as HTMLButtonElement).disabled) continue;

      const parent = btn.parentElement;
      if (parent && parent.querySelector('input[type="file"]')) continue;

      const rect = btn.getBoundingClientRect();
      const distanceY = rect.top - textareaRect.bottom;
      const distanceX = rect.left - textareaRect.right;

      if (distanceY >= -10 && distanceY < 50 && distanceX > -50) {
        nearbyButtons.push({
          element: btn as HTMLButtonElement,
          distanceX,
          distanceY,
        });
      }
    }

    if (nearbyButtons.length > 0) {
      nearbyButtons.sort((a, b) => b.distanceX - a.distanceX);
      return nearbyButtons[0].element;
    }

    return null;
  }

  findContinueButton(): HTMLButtonElement | null {
    // 优先在最后一条 assistant 消息的上下文中查找
    const messages = document.querySelectorAll('.ds-assistant-message-main-content');
    if (messages.length > 0) {
      const lastMsg = messages[messages.length - 1] as HTMLElement;
      const searchRoot = lastMsg.closest('[class*="message"]')?.parentElement || lastMsg.parentElement || lastMsg;
      const buttons = searchRoot.querySelectorAll<HTMLButtonElement>('button');
      for (const btn of buttons) {
        const text = btn.textContent?.trim() || '';
        if (text.includes('继续生成') || text.includes('Continue') || text.includes('继续')) {
          if (!this.isButtonDisabled(btn)) return btn;
        }
      }
    }
    // fallback: 全局搜索
    const allButtons = document.querySelectorAll<HTMLButtonElement>('button');
    for (const btn of allButtons) {
      const text = btn.textContent?.trim() || '';
      if (text.includes('继续生成') || text.includes('Continue') || text.includes('继续')) {
        if (!this.isButtonDisabled(btn)) return btn;
      }
    }
    return null;
  }

  findRegenerateButton(): HTMLElement | null {
    // 找到最后一条 assistant 消息
    const messages = document.querySelectorAll('.ds-assistant-message-main-content');
    if (messages.length === 0) return null;
    const lastMsg = messages[messages.length - 1] as HTMLElement;
    const searchRoot = lastMsg.parentElement || lastMsg;

    // 在最后一条消息及其父级中查找"已停止"标签
    const stoppedLabels = ['已停止', 'Stopped', 'Stop'];
    const allEls = searchRoot.querySelectorAll('*');
    for (const el of allEls) {
      if (el.children.length === 0) {
        const t = el.textContent?.trim() || '';
        if (stoppedLabels.includes(t)) {
          // 从"已停止"标签向上查找按钮组
          let container: HTMLElement | null = el.parentElement;
          for (let depth = 0; depth < 6 && container; depth++) {
            const iconBtns = container.querySelectorAll('.ds-icon-button, [class*="icon-button"]');
            const btnArray = Array.from(iconBtns).filter(b => {
              const rect = b.getBoundingClientRect();
              return rect.width > 0 && rect.width < 50 && rect.height > 0;
            });
            if (btnArray.length >= 3) {
              return btnArray[2] as HTMLElement;
            }
            container = container.parentElement;
          }
        }
      }
    }
    return null;
  }

  // ============================================================
  // AI 状态检测（DeepSeek 特化）
  // ============================================================

  isGenerating(): boolean {
    // 检查"停止"按钮
    if (this.hasStopButton()) return true;

    // 检查发送按钮是否 disabled（生成中时 disabled）
    const sendBtn =
      document.querySelector<HTMLButtonElement>('button[aria-label*="发送" i]') ||
      document.querySelector<HTMLButtonElement>('button[aria-label*="send" i]');
    if (sendBtn && this.isButtonDisabled(sendBtn)) return true;

    // 检查是否有流式输出标记
    const streamingEl = document.querySelector('[data-is-streaming]');
    if (streamingEl) return true;

    return false;
  }

  isIdle(): boolean {
    if (this.isGenerating()) return false;
    if (this.isPaused()) return false;

    const textarea = this.findInput();
    const hasContent = textarea && (textarea as HTMLTextAreaElement).value.trim().length > 0;
    return !hasContent;
  }

  isPaused(): boolean {
    return !!this.findContinueButton();
  }

  isReady(): boolean {
    // 1. 如果 AI 还在生成，肯定没准备好
    if (this.isGenerating()) return false;
    // 2. 如果 AI 暂停了（有继续按钮），没准备好
    if (this.isPaused()) return false;
    
    // 3. 找发送按钮（带 disabled class 的那个）
    const allIconBtns = document.querySelectorAll('.ds-icon-button, [class*="icon-button"]');
    for (const btn of allIconBtns) {
      const rect = btn.getBoundingClientRect();
      // 发送按钮在输入框右下角
      if (rect.width > 20 && rect.width < 50 && rect.height > 20) {
        const isDisabled = btn.classList.contains('ds-icon-button--disabled') ||
                          btn.getAttribute('aria-disabled') === 'true';
        if (!isDisabled) return true;
      }
    }
    
    // 4. Fallback：检查 aria-label
    const sendBtn = document.querySelector<HTMLButtonElement>('button[aria-label*="发送" i]') ||
                    document.querySelector<HTMLButtonElement>('button[aria-label*="send" i]');
    if (sendBtn) return !this.isButtonDisabled(sendBtn);
    
    return false;
  }
}
