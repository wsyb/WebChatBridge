/**
 * Background Service Worker 入口
 */

import { Logger } from '../core/logger.js';
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
// 连接检查（直接查 localhost，不经过 content script）
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
// 消息监听
// ============================================================

chrome.runtime.onMessage.addListener((message, _sender, sendResponse) => {
  if (message.type === 'GET_STATUS') {
    checkHealth().then((connected) => {
      sendResponse({ connected });
    });
    return true; // 异步 sendResponse
  }

  if (message.type === 'OPEN_OPTIONS') {
    chrome.runtime.openOptionsPage();
    sendResponse({ success: true });
    return false;
  }

  return false;
});

// ============================================================
// 扩展图标点击（有 popup 时不会触发，保留作为 fallback）
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
