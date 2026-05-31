/**
 * Doubao (豆包) 适配器
 * 封装 www.doubao.com 的所有平台特定逻辑
 */

import { BaseAdapter } from '../base';

export class DoubaoAdapter extends BaseAdapter {
  name = 'doubao';

  messageSelectors: string[] = [
    '.md-box-root',
  ];

  // 状态追踪
  private _wasGenerating = false;
  private _statusCheckInterval: ReturnType<typeof setInterval> | null = null;
  private _lastSeenMessageCount: number | undefined = undefined;

  detect(): boolean {
    return window.location.hostname.includes('www.doubao.com');
  }

  getConversationId(): string {
    const url = window.location.href;
    const match = url.match(/\/chat\/(\d+)/);
    return match ? match[1] : url;
  }

  // ============================================================
  // 事件驱动检测
  // ============================================================

  startMonitoring(): void {
    if (this._statusCheckInterval) return;
    this._wasGenerating = this.isGenerating();
    // 初始化为当前实际消息数，避免已有消息被误判为"新消息"
    const msgs = document.querySelectorAll('.v_list_row');
    let count = 0;
    for (const row of msgs) {
      if (row.querySelector('.md-box-root')) count++;
    }
    this._lastSeenMessageCount = count;
    this.logger.info(`Doubao: Initial isGenerating=${this._wasGenerating}, initialMsgCount=${count}`);

    const observer = new MutationObserver(() => this.checkStatusChange());
    observer.observe(document.body, {
      childList: true,
      subtree: true,
      attributes: true,
      attributeFilter: ['class', 'disabled', 'aria-disabled', 'data-state'],
    });

    this._statusCheckInterval = setInterval(() => this.checkStatusChange(), 1000);
    this.logger.info('Doubao: Status monitoring started');
  }

  stopMonitoring(): void {
    if (this._statusCheckInterval) {
      clearInterval(this._statusCheckInterval);
      this._statusCheckInterval = null;
    }
  }

  private checkStatusChange(): void {
    const isCurrentlyGenerating = this.isGenerating();
    const wasGen = this._wasGenerating;
    const lastSeen = this._lastSeenMessageCount;

    // 统计消息数
    const msgs = document.querySelectorAll('.v_list_row');
    let msgCount = 0;
    for (const row of msgs) {
      if (row.querySelector('.md-box-root')) msgCount++;
    }

    const wrapper = document.querySelector('.send-btn-wrapper');

    this.logger.info(
      `[Doubao tick] wasGen=${wasGen} isGen=${isCurrentlyGenerating} paused=${this.isPaused()} wrapper=${!!wrapper} msgCount=${msgCount} lastSeen=${lastSeen}`,
    );

    // 路径1：生成完成检测
    if (wasGen && !isCurrentlyGenerating) {
      this.logger.info('[Doubao] >>> emitGenerationComplete (generating→idle)');
      this.emitGenerationComplete();
    }

    // 路径2：新消息检测
    if (!wasGen && !isCurrentlyGenerating && !this.isPaused()) {
      if (
        msgCount > 0 &&
        lastSeen !== undefined &&
        msgCount > lastSeen
      ) {
        this.logger.info(`[Doubao] >>> emitGenerationComplete (new message ${lastSeen}→${msgCount})`);
        this.emitGenerationComplete();
      }
      this._lastSeenMessageCount = msgCount;
    } else {
      // 更新计数但不触发
      this._lastSeenMessageCount = msgCount;
      if (wasGen || isCurrentlyGenerating) {
        this.logger.info(`[Doubao] skip new-msg check (wasGen=${wasGen} isGen=${isCurrentlyGenerating})`);
      }
    }

    this._wasGenerating = isCurrentlyGenerating;
  }

  // ============================================================
  // 消息读取
  // ============================================================

  getLastAIMessageElement(): Element | null {
    const rows = document.querySelectorAll('.v_list_row');
    // AI 消息的标志是 .md-box-root，用户消息和工具结果没有
    // 优先返回最后一个包含 tool_call 的 AI 消息
    for (let i = rows.length - 1; i >= 0; i--) {
      const mdBox = rows[i].querySelector('.md-box-root');
      if (mdBox) {
        const text = mdBox.textContent || '';
        if (text.includes('tool_call') && text.includes('===')) {
          return mdBox;
        }
      }
    }
    // 没有 tool_call 的 AI 消息，返回最后一个
    for (let i = rows.length - 1; i >= 0; i--) {
      const mdBox = rows[i].querySelector('.md-box-root');
      if (mdBox) return mdBox;
    }
    return null;
  }

  getLastAIMessage(): string {
    const el = this.getLastAIMessageElement();
    return el?.textContent || '';
  }

  // ============================================================
  // 输入相关
  // ============================================================

  findInput(): HTMLElement | null {
    return document.querySelector('textarea.semi-input-textarea');
  }

  findInputContainer(): HTMLElement | null {
    return document.getElementById('input-engine-container') || null;
  }

  findSendButton(): HTMLButtonElement | null {
    // 发送按钮的父元素有 send-btn-wrapper 类名
    const wrapper = document.querySelector('.send-btn-wrapper');
    if (!wrapper) return null;
    return wrapper.querySelector('button') as HTMLButtonElement | null;
  }

  findContinueButton(): HTMLButtonElement | null {
    // 豆包的"继续生成"按钮
    const allBtns = document.querySelectorAll<HTMLButtonElement>('button');
    for (const btn of allBtns) {
      const text = btn.textContent?.trim() || '';
      if (text.includes('继续生成') || text.includes('继续') || text.includes('Continue')) {
        if (!this.isButtonDisabled(btn)) return btn;
      }
    }
    return null;
  }

  findRegenerateButton(): HTMLElement | null {
    // 找到最后一条 assistant 消息的操作栏
    const rows = document.querySelectorAll('.v_list_row');
    for (let i = rows.length - 1; i >= 0; i--) {
      const actionBar = rows[i].querySelector('.message-action-bar-raqbg0');
      if (actionBar) {
        // 重新生成按钮通常是操作栏中的某个图标按钮
        // 豆包的操作栏按钮没有文字标签，通过 SVG 图标区分
        // 这里返回操作栏本身作为 fallback
        return actionBar as HTMLElement;
      }
    }
    return null;
  }

  isButtonDisabled(btn: HTMLButtonElement): boolean {
    if (btn.disabled) return true;
    if (btn.getAttribute('aria-disabled') === 'true') return true;
    if (btn.classList.contains('disabled')) return true;
    // 豆包的禁用状态可能通过 opacity 或 pointer-events 控制
    const style = window.getComputedStyle(btn);
    if (style.opacity === '0.5' || style.pointerEvents === 'none') return true;
    return false;
  }

  // ============================================================
  // AI 状态检测
  // ============================================================

  isGenerating(): boolean {
    // 豆包生成中时 send-btn-wrapper 会被移除
    // 如果有消息在增长中（lastSeenMessageCount > 0 且当前有更多消息），视为生成中
    const rows = document.querySelectorAll('.v_list_row');
    let currentCount = 0;
    for (const row of rows) {
      if (row.querySelector('.md-box-root')) currentCount++;
    }
    // 如果消息数比上次记录的多，且 wrapper 不存在，说明正在生成
    const wrapper = document.querySelector('.send-btn-wrapper');
    if (!wrapper && this._lastSeenMessageCount !== undefined && currentCount > this._lastSeenMessageCount) {
      return true;
    }

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
    if (this.isGenerating()) return false;
    if (this.isPaused()) return false;
    const sendBtn = this.findSendButton();
    if (!sendBtn) return false;
    return !this.isButtonDisabled(sendBtn);
  }

  // ============================================================
  // 文本注入（Semi Input 特化）
  // ============================================================

  injectTextSafely(text: string): boolean {
    const input = this.findInput();
    if (!input) {
      this.logger.error('Doubao: injectTextSafely - no input found');
      return false;
    }

    // 尝试通过 React 内部机制设置值
    try {
      input.focus();
      
      // 使用 DataTransfer + paste 事件注入（兼容 React controlled input）
      const dataTransfer = new DataTransfer();
      dataTransfer.setData('text/plain', text);
      const pasteEvent = new ClipboardEvent('paste', {
        bubbles: true,
        cancelable: true,
        clipboardData: dataTransfer,
      });
      input.dispatchEvent(pasteEvent);
      
      // 验证是否注入成功
      const currentValue = (input as HTMLTextAreaElement).value;
      if (currentValue.includes(text.substring(0, 20))) {
        this.logger.info('Doubao: injectTextSafely via paste succeeded');
        return true;
      }
    } catch {
      // paste 失败，继续尝试其他方法
    }

    // fallback: execCommand
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

    // 最后 fallback: 直接设置 value + 触发事件
    try {
      const nativeInputValueSetter = Object.getOwnPropertyDescriptor(
        window.HTMLTextAreaElement.prototype, 'value',
      )?.set;
      if (nativeInputValueSetter) {
        nativeInputValueSetter.call(input, text);
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

  // ============================================================
  // 点击发送
  // ============================================================

  async clickSend(): Promise<boolean> {
    const maxWaitMs = 10000;
    const intervalMs = 300;
    let waited = 0;

    while (waited < maxWaitMs) {
      const sendBtn = this.findSendButton();
      if (sendBtn && !this.isButtonDisabled(sendBtn)) {
        // 模拟真实鼠标操作
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
    this.logger.warn('Doubao: clickSend - timeout, trying Enter');
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
