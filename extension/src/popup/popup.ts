/**
 * Popup 逻辑模块
 * 连接状态、工具栏开关、设置入口
 */

interface StatusResponse {
  connected?: boolean;
}

const REFRESH_INTERVAL_MS = 5000;

export class PopupController {
  private connectionStatusEl: HTMLElement | null = null;
  private toggleToolbarEl: HTMLInputElement | null = null;
  private settingsBtn: HTMLElement | null = null;
  private refreshTimer: ReturnType<typeof setInterval> | null = null;

  initialize(): void {
    this.connectionStatusEl = document.getElementById('connection-status');
    this.toggleToolbarEl = document.getElementById('toggle-toolbar') as HTMLInputElement;
    this.settingsBtn = document.getElementById('open-settings');

    this.bindEvents();
    this.refresh();
    this.refreshTimer = setInterval(() => this.refresh(), REFRESH_INTERVAL_MS);
  }

  destroy(): void {
    if (this.refreshTimer) {
      clearInterval(this.refreshTimer);
      this.refreshTimer = null;
    }
  }

  private bindEvents(): void {
    this.toggleToolbarEl?.addEventListener('change', () => {
      this.toggleToolbar();
    });

    this.settingsBtn?.addEventListener('click', () => {
      chrome.runtime.openOptionsPage();
    });
  }

  private refresh(): void {
    this.checkConnection();
    this.getToolbarState();
  }

  private checkConnection(): void {
    chrome.runtime
      .sendMessage({ type: 'GET_STATUS' })
      .then((response: StatusResponse | undefined) => {
        this.updateConnectionUI(response?.connected ?? false);
      })
      .catch(() => {
        this.updateConnectionUI(false);
      });
  }

  private getToolbarState(): void {
    chrome.storage.local.get(['toolbarEnabled'], (result) => {
      const enabled = result.toolbarEnabled !== false;
      if (this.toggleToolbarEl) {
        this.toggleToolbarEl.checked = enabled;
      }
    });
  }

  private updateConnectionUI(connected: boolean): void {
    if (!this.connectionStatusEl) return;
    if (connected) {
      this.connectionStatusEl.textContent = '已连接';
      this.connectionStatusEl.className = 'status connected';
    } else {
      this.connectionStatusEl.textContent = '未连接';
      this.connectionStatusEl.className = 'status disconnected';
    }
  }

  private toggleToolbar(): void {
    const enabled = this.toggleToolbarEl?.checked ?? true;
    chrome.storage.local.set({ toolbarEnabled: enabled });

    chrome.tabs.query({ active: true, currentWindow: true }, (tabs) => {
      if (tabs[0]?.id) {
        chrome.tabs
          .sendMessage(tabs[0].id, { type: 'TOGGLE_TOOLBAR', enabled })
          .catch(() => {});
      }
    });
  }
}
