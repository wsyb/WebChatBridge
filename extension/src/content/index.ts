/**
 * Content Script 入口
 * 初始化各模块、创建工具栏、启动 Agent Loop
 */

import { Logger } from '../core/logger.js';
import { StateManager } from '../core/state.js';
import { globalConfig } from '../core/config.js';

import { AdapterManager } from '../adapters/manager.js';
import { DeepSeekAdapter } from '../adapters/impl/deepseek.js';
import { KimiAdapter } from '../adapters/impl/kimi.js';
import { DoubaoAdapter } from '../adapters/impl/doubao.js';
import { httpClient } from '../core/http-client.js';
import { Toolbar } from './toolbar.js';

import { AgentLoop } from '../agent/loop.js';
import { AgentStorage } from '../agent/storage.js';
import { createDefaultExecutor } from '../tools/index.js';
import { getSystemPrompt, getBrowserSystemPrompt } from '../prompts/index.js';

// ============================================================
// 防止重复注入
// ============================================================

declare global {
  interface Window {
    __webchatbridgeInjected?: boolean;
  }
}

if (window.__webchatbridgeInjected) {
  // 已注入，跳过
} else {
  window.__webchatbridgeInjected = true;
  initialize();
}

// ============================================================
// 初始化
// ============================================================

async function initialize(): Promise<void> {
  const logger = new Logger('Content');

  try {
    await doInitialize(logger);
  } catch (error) {
    const msg = error instanceof Error ? `${error.message}\n${error.stack}` : String(error);
    console.error(`[WebAI][FATAL] Content script initialization failed: ${msg}`);
    logger.error(`Initialization failed: ${msg}`);
  }
}

async function doInitialize(logger: Logger): Promise<void> {
  console.log('[WebAI] Content script starting...');

  // 等待 DOM 就绪
  if (document.readyState === 'loading') {
    await new Promise<void>((resolve) => {
      document.addEventListener('DOMContentLoaded', () => resolve());
    });
  }

  logger.info('Web Chat Bridge Content Script initializing');

  // 初始化配置
  await globalConfig.initialize();

  // 初始化状态管理器
  const state = new StateManager(
    globalConfig.get('cooldownMs'),
    globalConfig.get('maxProcessedHashes'),
  );

  // 初始化适配器管理器
  const adapterManager = new AdapterManager();
  adapterManager.register(new DeepSeekAdapter());
  adapterManager.register(new KimiAdapter());
  adapterManager.register(new DoubaoAdapter());

  // 检测当前适配器
  let adapter;
  try {
    adapter = adapterManager.detect();
    logger.info(`Detected adapter: ${adapter.name}`);
  } catch {
    logger.error('No adapter detected');
    return;
  }

  // 初始化工具栏
  const toolbar = new Toolbar();
  toolbar.create();
  toolbar.mount();
  toolbar.bindEvents({
    onInjectPrompt: () => {
      injectPrompt(state, adapterManager, logger, toolbar);
    },
    onInjectBrowserPrompt: () => {
      injectBrowserPrompt(state, adapterManager, logger, toolbar);
    },
    onTaskList: async () => {
      const result = await httpClient.taskList();
      if (result.success && result.data) {
        const data = result.data as any;
        return data.tasks || [];
      }
      return [];
    },
    onTaskLogs: async (taskId: string) => {
      const result = await httpClient.taskLogs(taskId);
      if (result.success && result.data) {
        const data = result.data as any;
        return { stdout: data.stdout || '', stderr: data.stderr || '' };
      }
      return { stdout: '', stderr: result.error || '获取日志失败' };
    },
    onTaskKill: async (taskId: string) => {
      await httpClient.taskKill(taskId);
    },
    onTaskRestart: async (taskId: string) => {
      await httpClient.taskRestart(taskId);
    },
  });
  toolbar.initDraggable();
  toolbar.checkVisibility();
  await toolbar.loadWorkDir();
  logger.info(`Toolbar workDir loaded: "${toolbar.getWorkDir()}"`);

  // 初始化对话 ID
  const convId = adapter.getConversationId?.() || window.location.href;
  state.setConversationId(convId);

  // ============================================================
  // 初始化 Storage
  // ============================================================
  const storage = new AgentStorage();

  // ============================================================
  // 初始化 Agent Loop（核心循环）
  // ============================================================
  const executor = createDefaultExecutor();
  const agentLoop = new AgentLoop(adapter, storage, executor, {
    onStateChanged: (agentState, toolName) => {
      toolbar.showStatus(agentState, toolName);
    },
    onToolCallDetected: (tc) => {
      logger.info(`Agent loop detected: ${tc.name}`);
    },
    onToolCallExecuted: (tc) => {
      logger.info(`Agent loop executed: ${tc.name}`);
    },
    onToolCallFailed: (tc, error) => {
      logger.error(`Agent loop failed: ${tc.name}`, { error });
    },
    onLoopCompleted: () => {
      logger.info('Agent loop completed');
    },
  });

  // 启动 agent loop
  agentLoop.start(convId);

  // ============================================================
  // 连接检查
  // ============================================================
  await checkConnection(state, toolbar, logger);

  // 定期检查连接状态（每 30 秒）
  setInterval(async () => {
    await checkConnection(state, toolbar, logger);
  }, 30_000);

  // ============================================================
  // 页面事件监听
  // ============================================================
  setupPageListeners(state, adapterManager, logger, agentLoop, storage);

  // ============================================================
  // 消息监听（来自 popup）
  // ============================================================
  setupMessageListener(state, toolbar);

  logger.info('Initialization complete');
}

// ============================================================
// 注入提示词
// ============================================================

async function injectPrompt(
  _state: StateManager,
  adapterManager: AdapterManager,
  logger: Logger,
  toolbar: Toolbar,
): Promise<void> {
  const adapter = adapterManager.getAdapter();
  if (!adapter) {
    logger.error('No adapter available');
    return;
  }

  const input = adapter.findInput();
  if (!input) {
    logger.error('No input found');
    return;
  }

  const workDir = toolbar.getWorkDir();
  const prompt = await getSystemPrompt(workDir, adapter.name);

  const injected = adapter.injectTextSafely(prompt);
  if (injected) {
    logger.info('System prompt injected');
  } else {
    logger.error('Failed to inject system prompt');
  }
}


// ============================================================
// 注入浏览器操控能力提示词
// ============================================================

async function injectBrowserPrompt(
  _state: StateManager,
  adapterManager: AdapterManager,
  logger: Logger,
  toolbar: Toolbar,
): Promise<void> {
  const adapter = adapterManager.getAdapter();
  if (!adapter) {
    logger.error('No adapter available');
    return;
  }

  const input = adapter.findInput();
  if (!input) {
    logger.error('No input found');
    return;
  }

  const workDir = toolbar.getWorkDir();
  const prompt = await getBrowserSystemPrompt(workDir, adapter.name);

  const injected = adapter.injectTextSafely(prompt);
  if (injected) {
    logger.info('Browser system prompt injected');
  } else {
    logger.error('Failed to inject browser system prompt');
  }
}


// ============================================================
// 连接检查
// ============================================================

async function checkConnection(
  state: StateManager,
  toolbar: Toolbar,
  _logger: Logger,
): Promise<void> {
  try {
    const ok = await httpClient.health();
    state.setConnected(ok);
    toolbar.updateConnectionStatus(ok);

    if (ok) {
      const sysInfo = await httpClient.getSystemInfo();
      toolbar.showSystemInfo(sysInfo);
    }
  } catch {
    // 连接检查失败
  }
}

// ============================================================
// 页面事件监听
// ============================================================

function setupPageListeners(
  state: StateManager,
  adapterManager: AdapterManager,
  logger: Logger,
  agentLoop: AgentLoop,
  storage: AgentStorage,
): void {
  // bfcache 恢复
  window.addEventListener('pageshow', (event) => {
    if (event.persisted) {
      // bfcache 恢复：重新启动 agent loop
      const adapter = adapterManager.getAdapter();
      const convId = adapter.getConversationId?.() || window.location.href;
      agentLoop.resume(convId);
      logger.info('Page restored from cache, agent loop resumed');
    }
  });

  // 标签页切换
  document.addEventListener('visibilitychange', () => {
    if (document.visibilityState === 'visible') {
      checkConversationSwitch(state, adapterManager, logger, agentLoop, storage);
    }
  });

  // SPA 导航监听
  let lastUrl = window.location.href;
  setInterval(() => {
    if (window.location.href !== lastUrl) {
      lastUrl = window.location.href;
      checkConversationSwitch(state, adapterManager, logger, agentLoop, storage);
    }
  }, 1000);
}

// ============================================================
// 对话切换检测
// ============================================================

async function checkConversationSwitch(
  state: StateManager,
  adapterManager: AdapterManager,
  logger: Logger,
  agentLoop: AgentLoop,
  _storage: AgentStorage,
): Promise<void> {
  const adapter = adapterManager.getAdapter();
  const currentId = adapter.getConversationId?.() || window.location.href;

  if (state.isNewConversation(currentId)) {
    logger.info(`Conversation switch detected: ${state.getConversationId()} -> ${currentId}`);

    // 暂停当前 agent loop
    agentLoop.pause();

    // 更新状态
    state.softReset();
    state.setConversationId(currentId);

    // 恢复新对话的 agent loop
    agentLoop.resume(currentId);
  }

  state.setConversationId(currentId);
}

// ============================================================
// 消息监听（来自 popup）
// ============================================================

function setupMessageListener(state: StateManager, _toolbar: Toolbar): void {
  try {
    chrome.runtime.onMessage.addListener((message, _sender, sendResponse) => {
      if (message.type === 'TOGGLE_TOOLBAR') {
        const toolbarHost = document.querySelector('[id="webchatbridge-toolbar-host"]');
        if (toolbarHost) {
          (toolbarHost as HTMLElement).style.display = message.enabled ? 'block' : 'none';
        }
        sendResponse({ success: true });
      } else if (message.type === 'CONNECTION_STATUS') {
        state.setConnected(message.connected);
        sendResponse({ success: true });
      }
      return true;
    });
  } catch {
    // 忽略通信错误
  }
}
