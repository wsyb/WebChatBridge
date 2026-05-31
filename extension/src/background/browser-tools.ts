/**
 * 浏览器工具处理器（运行在 background service worker 中）
 * 接收 content script 的消息，执行 Chrome API，返回结果
 */

import { getActiveTab } from '../browser/tab-utils.js';

interface ToolRequest {
  name: string;
  arguments: Record<string, unknown>;
}

export async function handleBrowserTool(request: ToolRequest): Promise<{ success: boolean; content?: string; error?: string }> {
  try {
    switch (request.name) {
      case 'browser_list_tabs': {
        const tabs = await chrome.tabs.query({});
        const tabList = tabs.map((tab) => ({
          id: tab.id,
          url: tab.url,
          title: tab.title,
          active: tab.active,
          windowId: tab.windowId,
          index: tab.index,
        }));
        return { success: true, content: JSON.stringify({ tabs: tabList, count: tabList.length }, null, 2) };
      }

      case 'browser_create_tab': {
        const { url, active = false } = request.arguments as { url: string; active?: boolean };
        let finalUrl = url?.trim();
        if (!finalUrl) return { success: false, error: 'URL is required' };
        if (!/^https?:\/\//i.test(finalUrl) && !/^chrome:|^chrome-extension:/i.test(finalUrl)) {
          finalUrl = `https://${finalUrl}`;
        }
        const tab = await chrome.tabs.create({ url: finalUrl, active });
        if (!tab.id) return { success: false, error: 'Failed to create tab' };
        return { success: true, content: JSON.stringify({ tabId: tab.id, url: tab.url, title: tab.title }) };
      }

      case 'browser_close_tab': {
        const { tabId: rawTabId } = request.arguments as { tabId?: unknown };
        const tabId = rawTabId != null ? Number(rawTabId) : undefined;
        if (tabId != null) {
          await chrome.tabs.remove(tabId);
          return { success: true, content: JSON.stringify({ closed: true, tabId }) };
        }
        const tab = await getActiveTab();
        await chrome.tabs.remove(tab.id!);
        return { success: true, content: JSON.stringify({ closed: true, tabId: tab.id }) };
      }

      case 'browser_switch_tab': {
        const { tabId: rawTabId, urlPattern } = request.arguments as { tabId?: unknown; urlPattern?: string };
        const tabId = rawTabId != null ? Number(rawTabId) : undefined;
        if (tabId != null) {
          const tab = await chrome.tabs.get(tabId);
          if (!tab.id) return { success: false, error: 'Tab not found' };
          await chrome.tabs.update(tabId, { active: true });
          return { success: true, content: JSON.stringify({ tab: { id: tab.id, url: tab.url, title: tab.title } }) };
        }
        if (urlPattern) {
          const tabs = await chrome.tabs.query({ currentWindow: true });
          const matchingTab = tabs.find((tab) => tab.url?.includes(urlPattern));
          if (!matchingTab?.id) return { success: false, error: `No tab found matching pattern: ${urlPattern}` };
          await chrome.tabs.update(matchingTab.id, { active: true });
          return { success: true, content: JSON.stringify({ tab: { id: matchingTab.id, url: matchingTab.url, title: matchingTab.title } }) };
        }
        return { success: false, error: 'Either tabId or urlPattern must be provided' };
      }

      case 'browser_navigate': {
        const { url, action = 'goto', tabId: rawTabId } = request.arguments as { url?: string; action?: string; tabId?: unknown };
        const tabId = rawTabId != null ? Number(rawTabId) : undefined;
        const getTab = async () => {
          if (tabId != null) {
            const tab = await chrome.tabs.get(tabId);
            if (!tab.id) throw new Error('Tab not found');
            return tab;
          }
          return getActiveTab();
        };
        switch (action) {
          case 'back': {
            const tab = await getTab();
            await chrome.tabs.goBack(tab.id!);
            return { success: true, content: JSON.stringify({ action: 'back', tabId: tab.id }) };
          }
          case 'forward': {
            const tab = await getTab();
            await chrome.tabs.goForward(tab.id!);
            return { success: true, content: JSON.stringify({ action: 'forward', tabId: tab.id }) };
          }
          case 'reload': {
            const tab = await getTab();
            await chrome.tabs.reload(tab.id!);
            return { success: true, content: JSON.stringify({ action: 'reload', tabId: tab.id }) };
          }
          case 'goto':
          default: {
            if (!url) return { success: false, error: 'URL is required for goto action' };
            let finalUrl = url.trim();
            if (!/^https?:\/\//i.test(finalUrl) && !/^chrome:|^chrome-extension:/i.test(finalUrl)) {
              finalUrl = `https://${finalUrl}`;
            }
            const tab = await getTab();
            await chrome.tabs.update(tab.id!, { url: finalUrl });
            return { success: true, content: JSON.stringify({ action: 'goto', url: finalUrl, tabId: tab.id }) };
          }
        }
      }

      default:
        return { success: false, error: `Unknown browser tool: ${request.name}` };
    }
  } catch (error) {
    const msg = error instanceof Error ? error.message : String(error);
    return { success: false, error: msg };
  }
}
