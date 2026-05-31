import type { ToolResult } from '../../core/types.js';
import type { ToolDefinition } from '../../tools/types.js';
import { getActiveTab } from '../tab-utils.js';

const browser_navigate: ToolDefinition = {
  name: 'browser_navigate',
  description: 'Navigate the current tab to a specified URL, or go back/forward/reload',
  parameters: {
    type: 'object',
    properties: {
      url: { type: 'string', description: 'URL to navigate to' },
      action: {
        type: 'string',
        enum: ['goto', 'back', 'forward', 'reload'],
        description: 'Navigation action: goto (default), back, forward, reload',
      },
      tabId: { type: 'number', description: 'Tab ID to navigate (defaults to current active tab)' },
    },
    required: [],
  },
  async execute(args: Record<string, unknown>): Promise<ToolResult> {
    const { url, action = 'goto', tabId } = args as {
      url?: string;
      action?: string;
      tabId?: number;
    };

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
        if (!url) {
          return { success: false, error: 'URL is required for goto action' };
        }
        let finalUrl = url.trim();
        if (!/^https?:\/\//i.test(finalUrl) && !/^chrome:|^chrome-extension:/i.test(finalUrl)) {
          finalUrl = `https://${finalUrl}`;
        }
        const tab = await getTab();
        await chrome.tabs.update(tab.id!, { url: finalUrl });
        return {
          success: true,
          content: JSON.stringify({ action: 'goto', url: finalUrl, tabId: tab.id }),
        };
      }
    }
  },
};

export default browser_navigate;
