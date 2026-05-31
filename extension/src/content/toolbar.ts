/**
 * 工具栏 UI 模块
 * Shadow DOM 宿主、工具栏界面、拖拽支持、工作目录输入、任务管理面板、日志窗口
 */

// ============================================================
// 类型定义
// ============================================================

export interface ToolbarCallbacks {
  onInjectPrompt?: () => void;
  onInjectBrowserPrompt?: () => void;
  onTaskList?: () => Promise<TaskInfo[]>;
  onTaskLogs?: (taskId: string) => Promise<{ stdout: string; stderr: string }>;
  onTaskKill?: (taskId: string) => Promise<void>;
  onTaskRestart?: (taskId: string) => Promise<void>;
}

export interface TaskInfo {
  id: string;
  command: string;
  pid?: number;
  status: 'running' | 'exited' | 'killed';
  start_time: string;
  end_time?: string;
  uptime?: string;
}


// ============================================================
// 常量
// ============================================================

const TOOLBAR_HOST_ID = 'webchatbridge-toolbar-host';
const STORAGE_KEY_POSITION = 'toolbarPosition';
const STORAGE_KEY_WORK_DIR = 'workDir';
const STORAGE_KEY_WORK_DIR_HISTORY = 'workDirHistory';
const MAX_HISTORY = 10;
const INPUT_WIDTH_PX = 200;
const TASK_POLL_INTERVAL_MS = 3000;
const LOG_POLL_INTERVAL_MS = 3000;
const SCROLL_BOTTOM_THRESHOLD = 30;

// ============================================================
// 工具函数
// ============================================================


function truncateMiddle(str: string, maxLen: number): string {
  if (str.length <= maxLen) return str;
  const half = Math.floor((maxLen - 3) / 2);
  return str.slice(0, half) + '...' + str.slice(-half);
}

function formatUptime(startTime: string): string {
  try {
    const start = new Date(startTime).getTime();
    const now = Date.now();
    const diff = Math.floor((now - start) / 1000);
    const m = Math.floor(diff / 60);
    const s = diff % 60;
    if (m > 0) return `${m}m ${s}s`;
    return `${s}s`;
  } catch {
    return '--';
  }
}

// ============================================================
// Toolbar 类
// ============================================================

export class Toolbar {
  private host: HTMLDivElement | null = null;
  private shadow: ShadowRoot | null = null;
  private toolbarEl: HTMLDivElement | null = null;
  private isDragging = false;
  private startX = 0;
  private startY = 0;
  private toolbarX = 0;
  private toolbarY = 0;

  private workDir = '';
  private history: string[] = [];
  private dropdownOpen = false;

  // 任务面板
  private taskPanelOpen = false;
  private taskPollTimer: ReturnType<typeof setInterval> | null = null;
  private taskCallbacks: ToolbarCallbacks = {};
  private currentTasks: TaskInfo[] = [];

  // 日志窗口
  private logWindowEl: HTMLDivElement | null = null;
  private logMinimized = false;
  private logAutoRefresh = true;
  private logAtBottom = true;
  private logPollTimer: ReturnType<typeof setInterval> | null = null;
  private logDragging = false;
  private logStartX = 0;
  private logStartY = 0;
  private originalTitle = "Web Chat Bridge";
  private currentLogCommand: string = '';

  // ============================================================
  // 创建工具栏
  // ============================================================

  create(): { host: HTMLDivElement; shadow: ShadowRoot; toolbar: HTMLDivElement } {
    this.host = document.createElement('div');
    this.host.id = TOOLBAR_HOST_ID;
    this.host.style.cssText =
      'all: initial; position: fixed; top: 20px; left: 50%; transform: translateX(-50%); z-index: 2147483647;';

    this.shadow = this.host.attachShadow({ mode: 'open' });

    const style = document.createElement('style');
    style.textContent = this.getStyles();

    this.toolbarEl = document.createElement('div');
    this.toolbarEl.className = 'toolbar';
    this.toolbarEl.innerHTML = this.getHTML();

    this.shadow.appendChild(style);
    this.shadow.appendChild(this.toolbarEl);

    return { host: this.host, shadow: this.shadow, toolbar: this.toolbarEl };
  }

  mount(): void {
    if (this.host) document.body.appendChild(this.host);
    // 启动角标轮询（面板关闭时也更新角标）
    this.startBadgePoll();
  }

  // ============================================================
  // 事件绑定
  // ============================================================

  bindEvents(callbacks: ToolbarCallbacks): void {
    if (!this.shadow) return;
    this.taskCallbacks = callbacks;

    // 注入提示词按钮
    this.shadow.querySelector('#inject-prompt')?.addEventListener('click', () => {
      if (!this.workDir) { this.showWorkDirError('请先填写工作目录'); return; }
      callbacks.onInjectPrompt?.();
    });

    this.shadow.querySelector('#inject-browser-prompt')?.addEventListener('click', () => {
      callbacks.onInjectBrowserPrompt?.();
    });

    // ▾ 下拉按钮
    this.shadow.querySelector('#work-dir-dropdown-btn')?.addEventListener('click', (e) => {
      e.stopPropagation();
      this.toggleDropdown();
    });

    // 输入框
    const input = this.shadow.querySelector('#work-dir-input') as HTMLInputElement | null;
    if (input) {
      let saveTimer: ReturnType<typeof setTimeout> | null = null;
      input.addEventListener('input', () => {
        this.workDir = input.value;
        if (saveTimer) clearTimeout(saveTimer);
        saveTimer = setTimeout(() => this.saveWorkDir(), 500);
      });
      input.addEventListener('blur', () => {
        this.workDir = input.value.trim();
        this.saveWorkDir();
        this.updateInputDisplay();
      });
    }

    // 任务面板按钮
    this.shadow.querySelector('#task-panel-btn')?.addEventListener('click', (e) => {
      e.stopPropagation();
      this.toggleTaskPanel();
    });

    // 刷新任务列表
    this.shadow.querySelector('#task-panel-refresh')?.addEventListener('click', (e) => {
      e.stopPropagation();
      this.refreshTaskList();
    });

    // 点击外部关闭下拉
    document.addEventListener('click', () => {
      this.closeDropdown();
      this.closeTaskPanel();
    });

    // 下拉/任务面板阻止冒泡
    this.shadow.querySelector('#work-dir-dropdown')?.addEventListener('click', (e) => e.stopPropagation());
    this.shadow.querySelector('#task-panel')?.addEventListener('click', (e) => e.stopPropagation());
  }

  // ============================================================
  // 工作目录方法
  // ============================================================

  getWorkDir(): string { return this.workDir; }



  async loadWorkDir(): Promise<void> {
    try {
      const data = await chrome.storage.local.get([STORAGE_KEY_WORK_DIR, STORAGE_KEY_WORK_DIR_HISTORY]);
      this.workDir = data[STORAGE_KEY_WORK_DIR] || '';
      this.history = data[STORAGE_KEY_WORK_DIR_HISTORY] || [];
      this.updateInputDisplay();
    } catch { /* ignore */ }
  }

  private toggleDropdown(): void {
    this.dropdownOpen ? this.closeDropdown() : this.openDropdown();
  }

  private openDropdown(): void {
    this.dropdownOpen = true;
    this.renderHistory();
    const dd = this.shadow?.querySelector('#work-dir-dropdown') as HTMLElement;
    if (dd) dd.style.display = 'block';
  }

  private closeDropdown(): void {
    this.dropdownOpen = false;
    const dd = this.shadow?.querySelector('#work-dir-dropdown') as HTMLElement;
    if (dd) dd.style.display = 'none';
  }

  private renderHistory(): void {
    const list = this.shadow?.querySelector('#work-dir-history-list');
    if (!list) return;
    if (this.history.length === 0) {
      list.innerHTML = '<div class="dd-empty">暂无历史记录</div>';
      return;
    }
    list.innerHTML = this.history.map((h, i) =>
      `<div class="dd-item" data-idx="${i}">
        <span class="dd-item-text">${truncateMiddle(h, 35)}</span>
        <span class="dd-item-delete" data-idx="${i}">✕</span>
      </div>`
    ).join('');

    list.querySelectorAll('.dd-item').forEach(el => {
      el.addEventListener('click', (e) => {
        const target = e.target as HTMLElement;
        if (target.classList.contains('dd-item-delete')) {
          this.deleteHistoryItem(Number(target.dataset.idx));
        } else {
          const idx = Number((el as HTMLElement).dataset.idx);
          this.workDir = this.history[idx];
          this.updateInputDisplay();
          this.saveWorkDir();
          this.closeDropdown();
        }
      });
    });
  }

  private deleteHistoryItem(idx: number): void {
    this.history.splice(idx, 1);
    chrome.storage.local.set({ [STORAGE_KEY_WORK_DIR_HISTORY]: this.history });
    this.renderHistory();
  }

  private updateInputDisplay(): void {
    const input = this.shadow?.querySelector('#work-dir-input') as HTMLInputElement | null;
    if (input && input !== document.activeElement) {
      input.value = truncateMiddle(this.workDir, INPUT_WIDTH_PX / 7);
    }
  }

  private showWorkDirError(msg: string): void {
    const el = this.shadow?.querySelector('#work-dir-error') as HTMLElement;
    if (!el) return;
    el.textContent = msg;
    el.style.display = 'block';
    setTimeout(() => { el.style.display = 'none'; }, 2500);
  }

  saveWorkDir(): void {
    chrome.storage.local.set({ [STORAGE_KEY_WORK_DIR]: this.workDir });
    if (this.workDir && !this.history.includes(this.workDir)) {
      this.history.unshift(this.workDir);
      if (this.history.length > MAX_HISTORY) this.history.pop();
      chrome.storage.local.set({ [STORAGE_KEY_WORK_DIR_HISTORY]: this.history });
    }
  }

  // ============================================================
  // 任务面板
  // ============================================================

  private toggleTaskPanel(): void {
    this.taskPanelOpen ? this.closeTaskPanel() : this.openTaskPanel();
  }

  private openTaskPanel(): void {
    this.taskPanelOpen = true;
    // 停掉角标低频轮询，切换为面板高频轮询
    if (this.taskPollTimer) { clearInterval(this.taskPollTimer); this.taskPollTimer = null; }
    const panel = this.shadow?.querySelector('#task-panel') as HTMLElement;
    if (panel) panel.style.display = 'block';
    this.refreshTaskList();
    this.taskPollTimer = setInterval(() => this.refreshTaskList(), TASK_POLL_INTERVAL_MS);
  }

  private closeTaskPanel(): void {
    this.taskPanelOpen = false;
    const panel = this.shadow?.querySelector('#task-panel') as HTMLElement;
    if (panel) panel.style.display = 'none';
    // 面板关闭后切换为只更新角标的低频轮询
    if (this.taskPollTimer) { clearInterval(this.taskPollTimer); this.taskPollTimer = null; }
    this.startBadgePoll();
  }

  /** 低频轮询：只更新角标（面板关闭时） */
  private startBadgePoll(): void {
    if (this.taskPollTimer) return; // 已有轮询则跳过
    this.refreshTaskList(); // 立即拉一次
    this.taskPollTimer = setInterval(() => {
      if (!this.taskPanelOpen) this.refreshTaskList();
    }, TASK_POLL_INTERVAL_MS);
  }

  private async refreshTaskList(): Promise<void> {
    if (!this.taskCallbacks.onTaskList) return;
    try {
      const tasks = await this.taskCallbacks.onTaskList();
      this.currentTasks = tasks;
      this.renderTaskList(tasks);
      this.updateTaskBadge(tasks);
    } catch { /* ignore */ }
  }

  private renderTaskList(tasks: TaskInfo[]): void {
    const container = this.shadow?.querySelector('#task-list-items');
    if (!container) return;
    if (tasks.length === 0) {
      container.innerHTML = '<div class="task-empty">暂无后台任务</div>';
      return;
    }
    container.innerHTML = tasks.map(t => {
      const statusClass = t.status === 'running' ? 'task-running' : 'task-exited';
      const statusText = t.status === 'running' ? '● 运行中' : t.status === 'killed' ? '■ 已终止' : '○ 已退出';
      const uptime = t.status === 'running' ? (t.uptime || formatUptime(t.start_time)) : '--';
      return `<div class="task-item" data-id="${t.id}">
        <div class="task-item-header">
          <span class="task-cmd" title="${t.command}">${truncateMiddle(t.command, 30)}</span>
          <span class="task-status ${statusClass}">${statusText}</span>
        </div>
        <div class="task-item-footer">
          <span class="task-uptime">⏱ ${uptime}</span>
          <span class="task-actions">
            <button class="task-action-btn" data-action="logs" data-id="${t.id}" title="查看日志">📄</button>
            <button class="task-action-btn" data-action="restart" data-id="${t.id}" title="重启">🔄</button>
            <button class="task-action-btn" data-action="kill" data-id="${t.id}" title="终止">✕</button>
          </span>
        </div>
      </div>`;
    }).join('');

    // 绑定操作按钮
    container.querySelectorAll('.task-action-btn').forEach(btn => {
      btn.addEventListener('click', async (e) => {
        e.stopPropagation();
        const action = (btn as HTMLElement).dataset.action;
        const id = (btn as HTMLElement).dataset.id!;
        if (action === 'logs') this.openLogWindow(id);
        else if (action === 'restart') await this.taskCallbacks.onTaskRestart?.(id);
        else if (action === 'kill') await this.taskCallbacks.onTaskKill?.(id);
        setTimeout(() => this.refreshTaskList(), 500);
      });
    });
  }

  private updateTaskBadge(tasks: TaskInfo[]): void {
    const badge = this.shadow?.querySelector('#task-badge') as HTMLElement;
    if (!badge) return;
    const running = tasks.filter(t => t.status === 'running').length;
    badge.textContent = running > 0 ? String(running) : '';
    badge.style.display = running > 0 ? 'flex' : 'none';
  }

  // ============================================================
  // 日志窗口
  // ============================================================

  private openLogWindow(taskId: string): void {
    this.closeLogWindow();

    // 找到命令
    const task = this.currentTasks.find(t => t.id === taskId);
    this.currentLogCommand = task?.command || taskId;

    this.logAtBottom = true;
    this.logMinimized = false;
    this.logAutoRefresh = true;

    if (!this.shadow) return;

    const title = truncateMiddle(this.currentLogCommand, 40);

    this.logWindowEl = document.createElement('div');
    this.logWindowEl.className = 'log-window';
    this.logWindowEl.innerHTML = `
      <div class="log-header" id="log-header">
        <span class="log-title" title="${this.currentLogCommand}">${title}</span>
        <span class="log-actions">
          <button class="log-action-btn log-toggle-active" id="log-auto-refresh" title="自动刷新：开启">🔄</button>
          <button class="log-action-btn" id="log-minimize" title="最小化">—</button>
          <button class="log-action-btn" id="log-close" title="关闭">✕</button>
        </span>
      </div>
      <div class="log-body" id="log-body">
        <pre class="log-content" id="log-content">加载中...</pre>
      </div>
    `;
    this.shadow.appendChild(this.logWindowEl);

    // 拖拽
    const header = this.logWindowEl.querySelector('#log-header') as HTMLElement;
    header.addEventListener('mousedown', (e) => {
      if ((e.target as HTMLElement).tagName === 'BUTTON') return;
      this.logDragging = true;
      this.logStartX = e.clientX - (this.logWindowEl?.offsetLeft || 0);
      this.logStartY = e.clientY - (this.logWindowEl?.offsetTop || 0);
      e.preventDefault();
    });

    // 标题栏点击 = 最小化切换
    header.addEventListener('click', (e) => {
      if ((e.target as HTMLElement).tagName === 'BUTTON') return;
      this.toggleLogMinimize();
    });

    // 按钮事件
    this.logWindowEl.querySelector('#log-close')?.addEventListener('click', () => this.closeLogWindow());
    this.logWindowEl.querySelector('#log-minimize')?.addEventListener('click', () => this.toggleLogMinimize());
    this.logWindowEl.querySelector('#log-auto-refresh')?.addEventListener('click', () => this.toggleLogAutoRefresh());

    // 全局 mousemove/mouseup
    const onMouseMove = (e: MouseEvent) => {
      if (!this.logDragging || !this.logWindowEl) return;
      this.logWindowEl.style.left = (e.clientX - this.logStartX) + 'px';
      this.logWindowEl.style.top = (e.clientY - this.logStartY) + 'px';
      this.logWindowEl.style.right = 'auto';
    };
    const onMouseUp = () => { this.logDragging = false; };
    document.addEventListener('mousemove', onMouseMove);
    document.addEventListener('mouseup', onMouseUp);

    (this.logWindowEl as any)._cleanup = () => {
      document.removeEventListener('mousemove', onMouseMove);
      document.removeEventListener('mouseup', onMouseUp);
    };

    // 智能滚动追踪
    const logBody = this.logWindowEl.querySelector('#log-body') as HTMLElement;
    if (logBody) {
      logBody.addEventListener('scroll', () => {
        const { scrollTop, scrollHeight, clientHeight } = logBody;
        this.logAtBottom = scrollHeight - scrollTop - clientHeight < SCROLL_BOTTOM_THRESHOLD;
      });
    }

    // 首次加载 + 启动轮询
    this.loadLogs(taskId);
    this.logPollTimer = setInterval(() => {
      if (this.logAutoRefresh && !this.logMinimized) this.loadLogs(taskId);
    }, LOG_POLL_INTERVAL_MS);
  }

  private toggleLogMinimize(): void {
    this.logMinimized = !this.logMinimized;
    const body = this.logWindowEl?.querySelector('#log-body') as HTMLElement;
    const btn = this.logWindowEl?.querySelector('#log-minimize') as HTMLElement;
    if (body) {
      body.style.display = this.logMinimized ? 'none' : 'flex';
    }
    if (this.logWindowEl) {
      this.logWindowEl.style.height = this.logMinimized ? 'auto' : '320px';
    }
    if (btn) btn.textContent = this.logMinimized ? '□' : '—';
  }

  private toggleLogAutoRefresh(): void {
    this.logAutoRefresh = !this.logAutoRefresh;
    const btn = this.logWindowEl?.querySelector('#log-auto-refresh') as HTMLElement;
    if (btn) {
      btn.textContent = '🔄';
      btn.className = this.logAutoRefresh ? 'log-action-btn log-toggle-active' : 'log-action-btn';
      btn.title = this.logAutoRefresh ? '自动刷新：开启' : '自动刷新：关闭';
    }
  }

  private async loadLogs(taskId: string): Promise<void> {
    if (!this.taskCallbacks.onTaskLogs || !this.logWindowEl) return;
    const content = this.logWindowEl.querySelector('#log-content');
    try {
      const logs = await this.taskCallbacks.onTaskLogs(taskId);
      if (content) {
        let text = '';
        if (logs.stdout) text += logs.stdout;
        if (logs.stderr) text += (text ? '\n--- stderr ---\n' : '') + logs.stderr;
        content.textContent = text || '(无输出)';

        // 智能滚到底部
        if (this.logAtBottom) {
          const logBody = this.logWindowEl?.querySelector('#log-body') as HTMLElement;
          if (logBody) logBody.scrollTop = logBody.scrollHeight;
        }
      }
    } catch (err) {
      if (content) content.textContent = '加载失败: ' + (err instanceof Error ? err.message : String(err));
    }
  }

  private closeLogWindow(): void {
    if (this.logWindowEl) {
      if ((this.logWindowEl as any)._cleanup) (this.logWindowEl as any)._cleanup();
      if (this.logPollTimer) { clearInterval(this.logPollTimer); this.logPollTimer = null; }
      this.logWindowEl.remove();
      this.logWindowEl = null;
    }
  }

  // ============================================================
  // 拖拽
  // ============================================================

  initDraggable(): void {
    const toolbar = this.toolbarEl;
    if (!toolbar) return;

    toolbar.addEventListener('mousedown', (e) => {
      const target = e.target as HTMLElement;
      if (target.tagName === 'INPUT' || target.tagName === 'BUTTON' || target.closest('button') || target.closest('input') || target.closest('.task-panel') || target.closest('.work-dir-dropdown')) return;
      this.isDragging = true;
      // On first drag, convert CSS centering to absolute position on host
      if (this.host && this.host.style.left === '50%') {
        const rect = this.host.getBoundingClientRect();
        this.toolbarX = rect.left;
        this.toolbarY = rect.top;
      }
      this.startX = e.clientX - this.toolbarX;
      this.startY = e.clientY - this.toolbarY;
      e.preventDefault();
    });

    document.addEventListener('mousemove', (e) => {
      if (!this.isDragging || !this.host) return;
      this.toolbarX = e.clientX - this.startX;
      this.toolbarY = e.clientY - this.startY;
      // Clamp to viewport so toolbar can't be dragged off-screen
      const tw = toolbar.offsetWidth;
      const th = toolbar.offsetHeight;
      this.toolbarX = Math.max(0, Math.min(this.toolbarX, window.innerWidth - tw));
      this.toolbarY = Math.max(0, Math.min(this.toolbarY, window.innerHeight - th));
      this.host.style.transform = 'none';
      this.host.style.left = this.toolbarX + 'px';
      this.host.style.top = this.toolbarY + 'px';
      this.savePosition();
    });

    document.addEventListener('mouseup', () => {
      this.isDragging = false;
    });

    this.loadPositionAsync();
  }

  // ============================================================
  // 状态显示
  // ============================================================

  updateConnectionStatus(connected: boolean): void {
    const dot = this.shadow?.querySelector('#status-dot') as HTMLElement;
    if (!dot) return;
    dot.className = `status-dot ${connected ? 'connected' : 'disconnected'}`;
    dot.title = connected ? '已连接' : '未连接';
  }

  showStatus(status: 'idle' | 'detecting' | 'executing' | 'injecting' | 'waiting' | 'failed', toolName?: string): void {
    const titleEl = this.shadow?.querySelector('.title') as HTMLElement;
    if (!titleEl) return;

    switch (status) {
      case 'idle':
        titleEl.textContent = this.originalTitle;
        titleEl.style.color = '';
        break;
      case 'detecting':
        if (!this.originalTitle) this.originalTitle = titleEl.textContent || 'Web Chat Bridge';
        titleEl.textContent = toolName ? `检测到: ${toolName}` : '检测中...';
        titleEl.style.color = 'rgba(96, 165, 250, 0.95)';
        break;
      case 'executing':
        if (!this.originalTitle) this.originalTitle = titleEl.textContent || 'Web Chat Bridge';
        titleEl.textContent = toolName ? `执行中: ${toolName}` : '执行中...';
        titleEl.style.color = 'rgba(251, 191, 36, 0.95)';
        break;
      case 'injecting':
        if (!this.originalTitle) this.originalTitle = titleEl.textContent || 'Web Chat Bridge';
        titleEl.textContent = '发送中...';
        titleEl.style.color = 'rgba(251, 191, 36, 0.95)';
        break;
      case 'waiting':
        if (!this.originalTitle) this.originalTitle = titleEl.textContent || 'Web Chat Bridge';
        titleEl.textContent = '等待 AI 回复...';
        titleEl.style.color = 'rgba(156, 163, 175, 0.95)';
        break;
      case 'failed':
        if (!this.originalTitle) this.originalTitle = titleEl.textContent || 'Web Chat Bridge';
        titleEl.textContent = toolName ? `失败: ${toolName}` : '执行失败';
        titleEl.style.color = 'rgba(239, 68, 68, 0.95)';
        break;
    }
  }

  showSystemInfo(_sysInfo: unknown): void {
    // 预留：可展示系统信息
  }

  async checkVisibility(): Promise<void> {
    try {
      const data = await chrome.storage.local.get('toolbarVisible');
      if (data.toolbarVisible === false && this.toolbarEl) {
        this.toolbarEl.style.display = 'none';
      }
    } catch { /* ignore */ }
  }

  // ============================================================
  // 位置持久化
  // ============================================================

  private applyPosition(): void {
    if (!this.host) return;
    this.host.style.transform = 'none';
    this.host.style.left = this.toolbarX + 'px';
    this.host.style.top = this.toolbarY + 'px';
  }

  private savePosition(): void {
    chrome.storage.local.set({ [STORAGE_KEY_POSITION]: { x: this.toolbarX, y: this.toolbarY } });
  }



  private loadPositionAsync(): void {
    chrome.storage.local.get(STORAGE_KEY_POSITION).then(data => {
      const pos = data[STORAGE_KEY_POSITION];
      if (pos) {
        // Safety check: if saved position is off-screen, reset to default
        const tw = this.toolbarEl?.offsetWidth || 495;
        const th = this.toolbarEl?.offsetHeight || 42;
        const offScreen = pos.x + tw < 0 || pos.y + th < 0 ||
                          pos.x > window.innerWidth || pos.y > window.innerHeight;
        if (offScreen) {
          chrome.storage.local.remove(STORAGE_KEY_POSITION);
          return; // keep default CSS centering
        }
        this.toolbarX = pos.x;
        this.toolbarY = pos.y;
        this.applyPosition();
      }
    });
  }

  // ============================================================
  // 样式
  // ============================================================

  private getStyles(): string {
    return `
      * { margin: 0; padding: 0; box-sizing: border-box; }

      .toolbar {
        display: flex;
        align-items: center;
        gap: 8px;
        padding: 6px 14px;
        background: rgba(30, 30, 30, 0.85);
        border: 1px solid rgba(255, 255, 255, 0.12);
        border-radius: 10px;
        box-shadow: 0 0 20px rgba(0, 0, 0, 0.25);
        backdrop-filter: blur(12px);
        -webkit-backdrop-filter: blur(12px);
        font-family: -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, sans-serif;
        user-select: none;
        cursor: grab;
        transition: box-shadow 0.3s;
        position: fixed;
        z-index: 2147483647;
      }
      .toolbar:active { cursor: grabbing; }
      .toolbar:hover { box-shadow: 0 0 30px rgba(0, 0, 0, 0.4); }

      .title {
        font-size: 12px;
        font-weight: 600;
        color: rgba(255, 255, 255, 0.9);
        white-space: nowrap;
        min-width: 120px;
      }

      .status-dot {
        width: 8px;
        height: 8px;
        border-radius: 50%;
        background: rgba(239, 68, 68, 0.8);
        flex-shrink: 0;
        transition: all 0.3s;
      }
      .status-dot.connected {
        background: rgba(34, 197, 94, 0.8);
        box-shadow: 0 0 8px rgba(34, 197, 94, 0.4);
      }
      .status-dot.disconnected {
        background: rgba(239, 68, 68, 0.8);
        box-shadow: 0 0 8px rgba(239, 68, 68, 0.4);
      }

      .separator {
        width: 1px;
        height: 18px;
        background: rgba(255, 255, 255, 0.12);
        flex-shrink: 0;
      }

      /* 工作目录 */
      .work-dir-wrapper { position: relative; }
      .work-dir-row { display: flex; gap: 2px; }
      .work-dir-input {
        width: 160px;
        padding: 3px 8px;
        background: rgba(255, 255, 255, 0.08);
        border: 1px solid rgba(255, 255, 255, 0.15);
        border-radius: 6px;
        color: rgba(255, 255, 255, 0.85);
        font-size: 11px;
        outline: none;
        transition: all 0.2s;
      }
      .work-dir-input::placeholder { color: rgba(255, 255, 255, 0.3); }
      .work-dir-input:focus { border-color: rgba(255, 255, 255, 0.35); background: rgba(255, 255, 255, 0.12); }
      .work-dir-dropdown-btn {
        width: 22px;
        height: 22px;
        border: 1px solid rgba(255, 255, 255, 0.15);
        background: rgba(255, 255, 255, 0.08);
        border-radius: 6px;
        color: rgba(255, 255, 255, 0.4);
        font-size: 10px;
        cursor: pointer;
        transition: all 0.2s;
        display: flex;
        align-items: center;
        justify-content: center;
      }
      .work-dir-dropdown-btn:hover { color: rgba(255, 255, 255, 0.8); background: rgba(255, 255, 255, 0.15); }
      .work-dir-dropdown {
        display: none;
        position: absolute;
        top: 100%;
        left: 0;
        margin-top: 4px;
        width: 220px;
        max-height: 200px;
        overflow-y: auto;
        background: rgba(40, 40, 40, 0.95);
        border: 1px solid rgba(255, 255, 255, 0.12);
        border-radius: 8px;
        box-shadow: 0 8px 24px rgba(0, 0, 0, 0.4);
        z-index: 2147483647;
        backdrop-filter: blur(12px);
        -webkit-backdrop-filter: blur(12px);
      }
      .dd-item {
        display: flex;
        justify-content: space-between;
        align-items: center;
        padding: 6px 10px;
        color: rgba(255, 255, 255, 0.6);
        font-size: 11px;
        cursor: pointer;
        border-bottom: 1px solid rgba(255, 255, 255, 0.06);
        transition: all 0.15s;
      }
      .dd-item:last-child { border-bottom: none; }
      .dd-item:hover { background: rgba(255, 255, 255, 0.08); color: rgba(255, 255, 255, 0.9); }
      .dd-item-delete {
        color: rgba(255, 255, 255, 0.2);
        font-size: 10px;
        cursor: pointer;
        padding: 2px 4px;
        border-radius: 3px;
        transition: all 0.15s;
      }
      .dd-item-delete:hover { color: rgba(239, 68, 68, 0.8); background: rgba(239, 68, 68, 0.15); }
      .dd-empty { color: rgba(255, 255, 255, 0.3); padding: 8px 10px; font-size: 11px; text-align: center; }
      .work-dir-error {
        display: none;
        position: absolute;
        top: 100%;
        left: 0;
        margin-top: 6px;
        padding: 5px 10px;
        background: rgba(248, 113, 113, 0.9);
        color: #fff;
        border-radius: 6px;
        font-size: 10px;
        white-space: nowrap;
        z-index: 2147483647;
        backdrop-filter: blur(8px);
        -webkit-backdrop-filter: blur(8px);
      }

      /* 注入按钮 */
      .action-btn {
        padding: 5px 14px;
        border: 1px solid rgba(255, 255, 255, 0.2);
        background: rgba(255, 255, 255, 0.1);
        color: rgba(255, 255, 255, 0.9);
        border-radius: 6px;
        font-size: 11px;
        cursor: pointer;
        transition: all 0.2s;
        white-space: nowrap;
        backdrop-filter: blur(4px);
        -webkit-backdrop-filter: blur(4px);
      }
      .action-btn:hover { background: rgba(255, 255, 255, 0.2); border-color: rgba(255, 255, 255, 0.35); }
      .action-btn:active { background: rgba(255, 255, 255, 0.25); transform: scale(0.97); }



      /* 任务面板按钮 */
      .task-panel-btn {
        position: relative;
        height: 28px;
        padding: 0 10px;
        border: 1px solid rgba(255, 255, 255, 0.15);
        background: rgba(255, 255, 255, 0.08);
        border-radius: 6px;
        color: rgba(255, 255, 255, 0.7);
        font-size: 12px;
        cursor: pointer;
        display: flex;
        align-items: center;
        justify-content: center;
        transition: all 0.2s;
        white-space: nowrap;
      }
      .task-panel-btn:hover { background: rgba(255, 255, 255, 0.15); color: rgba(255, 255, 255, 0.9); }
      .task-badge {
        position: absolute;
        top: -4px;
        right: -4px;
        min-width: 14px;
        height: 14px;
        padding: 0 3px;
        background: rgba(239, 68, 68, 0.9);
        color: #fff;
        border-radius: 7px;
        font-size: 9px;
        font-weight: 600;
        display: none;
        align-items: center;
        justify-content: center;
        line-height: 1;
      }

      /* 任务面板 */
      .task-panel {
        display: none;
        position: absolute;
        top: 100%;
        right: 0;
        margin-top: 8px;
        width: 300px;
        max-height: 350px;
        overflow-y: auto;
        background: rgba(30, 30, 30, 0.95);
        border: 1px solid rgba(255, 255, 255, 0.12);
        border-radius: 10px;
        box-shadow: 0 8px 32px rgba(0, 0, 0, 0.5);
        z-index: 2147483647;
        backdrop-filter: blur(12px);
        -webkit-backdrop-filter: blur(12px);
      }
      .task-panel-header {
        display: flex;
        justify-content: space-between;
        align-items: center;
        padding: 8px 12px;
        color: rgba(255, 255, 255, 0.5);
        font-size: 11px;
        font-weight: 600;
        border-bottom: 1px solid rgba(255, 255, 255, 0.08);
      }
      .task-panel-refresh {
        background: none;
        border: none;
        color: rgba(255, 255, 255, 0.4);
        cursor: pointer;
        font-size: 12px;
        padding: 2px;
        transition: color 0.15s;
      }
      .task-panel-refresh:hover { color: rgba(255, 255, 255, 0.8); }
      .task-empty { color: rgba(255, 255, 255, 0.3); padding: 16px; text-align: center; font-size: 11px; }
      .task-item {
        padding: 8px 12px;
        border-bottom: 1px solid rgba(255, 255, 255, 0.06);
        transition: background 0.15s;
      }
      .task-item:last-child { border-bottom: none; }
      .task-item:hover { background: rgba(255, 255, 255, 0.04); }
      .task-item-header { display: flex; justify-content: space-between; align-items: center; margin-bottom: 4px; }
      .task-cmd { color: rgba(255, 255, 255, 0.8); font-size: 11px; font-family: "SF Mono", Monaco, Consolas, monospace; }
      .task-status { font-size: 10px; }
      .task-running { color: rgba(34, 197, 94, 0.8); }
      .task-exited { color: rgba(255, 255, 255, 0.3); }
      .task-item-footer { display: flex; justify-content: space-between; align-items: center; }
      .task-uptime { color: rgba(255, 255, 255, 0.35); font-size: 10px; }
      .task-actions { display: flex; gap: 2px; }
      .task-action-btn {
        width: 22px;
        height: 22px;
        border: none;
        background: rgba(255, 255, 255, 0.06);
        border-radius: 4px;
        color: rgba(255, 255, 255, 0.5);
        font-size: 11px;
        cursor: pointer;
        display: flex;
        align-items: center;
        justify-content: center;
        transition: all 0.15s;
      }
      .task-action-btn:hover { background: rgba(255, 255, 255, 0.15); color: rgba(255, 255, 255, 0.9); }

      /* 日志窗口 */
      .log-window {
        position: fixed;
        bottom: 20px;
        right: 20px;
        width: 480px;
        height: 320px;
        background: rgba(20, 20, 20, 0.95);
        border: 1px solid rgba(255, 255, 255, 0.12);
        border-radius: 10px;
        box-shadow: 0 8px 32px rgba(0, 0, 0, 0.6);
        z-index: 2147483646;
        display: flex;
        flex-direction: column;
        overflow: hidden;
        display: flex;
        flex-direction: column;
        backdrop-filter: blur(12px);
        -webkit-backdrop-filter: blur(12px);
        overflow: hidden;
      }
      .log-header {
        display: flex;
        justify-content: space-between;
        align-items: center;
        padding: 8px 12px;
        background: rgba(255, 255, 255, 0.04);
        border-bottom: 1px solid rgba(255, 255, 255, 0.08);
        cursor: move;
        flex-shrink: 0;
      }
      .log-title {
        font-size: 11px;
        color: rgba(255, 255, 255, 0.7);
        font-weight: 600;
        font-family: "SF Mono", Monaco, Consolas, monospace;
        overflow: hidden;
        text-overflow: ellipsis;
        white-space: nowrap;
        flex: 1;
        margin-right: 8px;
      }
      .log-actions { display: flex; gap: 4px; flex-shrink: 0; }
      .log-action-btn {
        width: 22px;
        height: 22px;
        border: none;
        background: rgba(255, 255, 255, 0.06);
        border-radius: 4px;
        color: rgba(255, 255, 255, 0.5);
        font-size: 11px;
        cursor: pointer;
        display: flex;
        align-items: center;
        justify-content: center;
        transition: all 0.15s;
      }
      .log-action-btn:hover { background: rgba(255, 255, 255, 0.15); color: rgba(255, 255, 255, 0.9); }
      .log-toggle-active { background: rgba(34, 197, 94, 0.25); color: rgba(34, 197, 94, 0.9); }
      .log-toggle-active:hover { background: rgba(34, 197, 94, 0.35); }
      .log-body {
        flex: 1;
        overflow: auto;
        padding: 8px 12px;
      }
      .log-content {
        font-size: 11px;
        font-family: "SF Mono", Monaco, Consolas, monospace;
        color: rgba(255, 255, 255, 0.75);
        white-space: pre-wrap;
        word-break: break-all;
        margin: 0;
        line-height: 1.5;
      }

      /* 浅色模式 */
      @media (prefers-color-scheme: light) {
        .toolbar { background: rgba(255, 255, 255, 0.85); border-color: rgba(0, 0, 0, 0.08); box-shadow: 0 4px 24px rgba(0, 0, 0, 0.08); }
        .title { color: rgba(0, 0, 0, 0.85); }
        .status-dot { background: rgba(0, 0, 0, 0.15); }
        .status-dot.connected { background: rgba(34, 197, 94, 0.8); box-shadow: 0 0 8px rgba(34, 197, 94, 0.4); }
        .status-dot.disconnected { background: rgba(239, 68, 68, 0.8); }
        .separator { background: rgba(0, 0, 0, 0.1); }
        .work-dir-input { background: rgba(0, 0, 0, 0.04); border-color: rgba(0, 0, 0, 0.12); color: rgba(0, 0, 0, 0.85); }
        .work-dir-input::placeholder { color: rgba(0, 0, 0, 0.3); }
        .work-dir-dropdown-btn { background: rgba(0, 0, 0, 0.04); border-color: rgba(0, 0, 0, 0.12); color: rgba(0, 0, 0, 0.4); }
        .work-dir-dropdown { background: rgba(255, 255, 255, 0.95); border-color: rgba(0, 0, 0, 0.1); }
        .dd-item { color: rgba(0, 0, 0, 0.6); border-bottom-color: rgba(0, 0, 0, 0.06); }
        .dd-item:hover { background: rgba(0, 0, 0, 0.04); color: rgba(0, 0, 0, 0.9); }
        .action-btn { background: rgba(0, 0, 0, 0.04); border-color: rgba(0, 0, 0, 0.12); color: rgba(0, 0, 0, 0.85); }
        .action-btn:hover { background: rgba(0, 0, 0, 0.08); }
        .task-panel-btn { background: rgba(0, 0, 0, 0.04); border-color: rgba(0, 0, 0, 0.12); color: rgba(0, 0, 0, 0.7); }
        .task-panel { background: rgba(255, 255, 255, 0.95); border-color: rgba(0, 0, 0, 0.1); }
        .task-panel-header { color: rgba(0, 0, 0, 0.6); border-bottom-color: rgba(0, 0, 0, 0.08); }
        .task-cmd { color: rgba(0, 0, 0, 0.8); }
        .task-uptime { color: rgba(0, 0, 0, 0.35); }
        .task-empty { color: rgba(0, 0, 0, 0.3); }
        .log-window { background: rgba(250, 250, 250, 0.97); border-color: rgba(0, 0, 0, 0.12); }
        .log-header { background: rgba(0, 0, 0, 0.03); border-bottom-color: rgba(0, 0, 0, 0.08); }
        .log-title { color: rgba(0, 0, 0, 0.7); }
        .log-content { color: rgba(0, 0, 0, 0.75); }
      }
    `;
  }

  private getHTML(): string {
    return `
      <span class="title">Web Chat Bridge</span>
      <span class="status-dot" id="status-dot" title="未连接"></span>
      <div class="separator"></div>
      <div class="work-dir-wrapper">
        <div class="work-dir-row">
          <input type="text" class="work-dir-input" id="work-dir-input"
                 placeholder="工作目录" title="输入或选择工作目录">
          <button class="work-dir-dropdown-btn" id="work-dir-dropdown-btn" title="历史记录">▾</button>
        </div>
        <div class="work-dir-dropdown" id="work-dir-dropdown">
          <div id="work-dir-history-list"></div>
        </div>
        <div class="work-dir-error" id="work-dir-error"></div>
      </div>
      <div class="task-panel-wrapper" style="position:relative;">
        <button class="task-panel-btn" id="task-panel-btn" title="后台任务">
          任务
          <span class="task-badge" id="task-badge"></span>
        </button>
        <div class="task-panel" id="task-panel">
          <div class="task-panel-header">
            <span>后台任务</span>
            <button class="task-panel-refresh" id="task-panel-refresh" title="刷新">🔄</button>
          </div>
          <div class="task-list-items" id="task-list-items">
            <div class="task-empty">暂无后台任务</div>
          </div>
        </div>
      </div>
      <button class="action-btn" id="inject-prompt">注入本机操控能力</button>
        <button class="action-btn action-btn-browser" id="inject-browser-prompt">注入浏览器操控能力</button>
    `;
  }
}
