/**
 * Background Service Worker 入口
 */

import { Logger } from '../core/logger.js';
import { handleBrowserTool } from './browser-tools.js';
import { globalConfig } from '../core/config.js';

const logger = new Logger('Background');

const HEALTH_TIMEOUT_MS = 3000;

// ============================================================
// 角标管理
// ============================================================

function setBadge(enabled: boolean): void {
  if (enabled) {
    chrome.action.setBadgeText({ text: 'ON' });
    chrome.action.setBadgeBackgroundColor({ color: '#4ade80' });
  } else {
    chrome.action.setBadgeText({ text: '' });
  }
}

// ============================================================
// 扩展生命周期
// ============================================================

chrome.runtime.onInstalled.addListener(() => {
  logger.info('Web Chat Bridge installed');
  chrome.storage.local.get(['toolbarEnabled'], (result) => {
    if (result.toolbarEnabled === undefined) {
      chrome.storage.local.set({ toolbarEnabled: true });
      setBadge(true);
    }
  });
});

// ============================================================
// 连接检查
// ============================================================

async function checkHealth(): Promise<boolean> {
  try {
    const host = globalConfig.get('nativeHost');
    const port = globalConfig.get('nativeHostPort');
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), HEALTH_TIMEOUT_MS);
    const response = await fetch(`http://${host}:${port}/health`, { signal: controller.signal });
    clearTimeout(timer);
    return response.ok;
  } catch {
    return false;
  }
}

// ============================================================
// 端口通信（浏览器工具 + 通用消息）
// ============================================================

chrome.runtime.onConnect.addListener((port) => {
  if (port.name !== 'wcb-port') return;

  logger.info('Content script connected via port');

  port.onMessage.addListener(async (message) => {
    if (message.type === 'BROWSER_TOOL') {
      try {
        const result = await handleBrowserTool(message.request);
        port.postMessage({ id: message.id, type: 'BROWSER_TOOL_RESULT', result });
      } catch (error) {
        const msg = error instanceof Error ? error.message : String(error);
        port.postMessage({ id: message.id, type: 'BROWSER_TOOL_RESULT', result: { success: false, error: msg } });
      }
    } else if (message.type === 'GET_STATUS') {
      const connected = await checkHealth();
      port.postMessage({ id: message.id, type: 'STATUS_RESULT', connected });
    }
  });

  port.onDisconnect.addListener(() => {
    logger.info('Content script disconnected');
  });
});

// ============================================================
// 兼容：也保留 onMessage 监听（popup 等可能还在用）
// ============================================================

chrome.runtime.onMessage.addListener((message, _sender, sendResponse) => {
  if (message.type === 'GET_STATUS') {
    checkHealth().then((connected) => {
      sendResponse({ connected });
    });
    return true;
  }

  if (message.type === 'OPEN_OPTIONS') {
    chrome.runtime.openOptionsPage();
    sendResponse({ success: true });
    return false;
  }

  return false;
});

// ============================================================
// 扩展图标点击
// ============================================================

chrome.action.onClicked.addListener((tab) => {
  chrome.storage.local.get(['toolbarEnabled'], (result) => {
    const enabled = result.toolbarEnabled === false;
    chrome.storage.local.set({ toolbarEnabled: enabled });
    setBadge(enabled);
    if (tab.id) {
      chrome.tabs.sendMessage(tab.id, { type: 'TOGGLE_TOOLBAR', enabled }).catch(() => {});
    }
  });
});
