/**
 * Content Script 入口（重构版）

 * 日志路径: /tmp/webchatbridge-debug.log (通过 native host 127.0.0.1:18789)
 *
 * 核心变化：
 * - 引入 RequestInterceptor 做 API 层状态检测
 * - Adapter 只负责 DOM 输入操作
 * - 删除所有 MutationObserver、定时器轮询
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
import { getSystemPrompt } from '../prompts/index.js';
import { RequestInterceptor } from '../interceptor/index.js';

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

  if (document.readyState === 'loading') {
    await new Promise<void>((resolve) => {
      document.addEventListener('DOMContentLoaded', () => resolve());
    });
  }

  logger.info('Web Chat Bridge Content Script initializing');

  await globalConfig.initialize();

  const state = new StateManager(
    globalConfig.get('cooldownMs'),
    globalConfig.get('maxProcessedHashes'),
  );

  // 初始化适配器（只负责输入操作）
  const adapterManager = new AdapterManager();
  adapterManager.register(new DeepSeekAdapter());
  adapterManager.register(new KimiAdapter());
  adapterManager.register(new DoubaoAdapter());

  let adapter;
  try {
    adapter = adapterManager.detect();
    logger.info(`Detected adapter: ${adapter.name}`);
  } catch {
    logger.error('No adapter detected');
    return;
  }

  // 初始化请求拦截器（负责状态检测和消息读取）
  const interceptor = new RequestInterceptor();

  // 初始化工具栏
  const toolbar = new Toolbar();
  toolbar.create();
  toolbar.mount();
  toolbar.bindEvents({
    onInjectPrompt: () => {
      injectPrompt(state, adapterManager, logger, toolbar);
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

  const convId = adapter.getConversationId?.() || window.location.href;
  state.setConversationId(convId);

  const storage = new AgentStorage();

  // 初始化 Agent Loop（传入 interceptor）
  const agentLoop = new AgentLoop(adapter, storage, {
    onStateChanged: (agentState, toolName) => {
      toolbar.showStatus(agentState, toolName);
    },
    onTextDelta: (charCount) => {
      toolbar.updateGeneratingProgress(charCount);
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
  }, interceptor);

  agentLoop.start(convId);

  // 连接检查
  await checkConnection(state, toolbar, logger);
  setInterval(async () => {
    await checkConnection(state, toolbar, logger);
  }, 30_000);

  // 页面事件监听
  setupPageListeners(state, adapterManager, logger, agentLoop, storage);

  // 消息监听（来自 popup）
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
  window.addEventListener('pageshow', (event) => {
    if (event.persisted) {
      const adapter = adapterManager.getAdapter();
      const convId = adapter.getConversationId?.() || window.location.href;
      agentLoop.resume(convId);
      logger.info('Page restored from cache, agent loop resumed');
    }
  });

  document.addEventListener('visibilitychange', () => {
    if (document.visibilityState === 'visible') {
      checkConversationSwitch(state, adapterManager, logger, agentLoop, storage);
    }
  });

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
    agentLoop.pause();
    state.softReset();
    state.setConversationId(currentId);
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
