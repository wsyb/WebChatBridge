import type { ToolResult } from '../../core/types.js';
import type { ToolDefinition } from '../../tools/types.js';

const browser_switch_tab: ToolDefinition = {
  name: 'browser_switch_tab',
  description: 'Switch to a specific tab by ID or URL pattern',
  parameters: {
    type: 'object',
    properties: {
      tabId: { type: 'number', description: 'Tab ID to switch to' },
      urlPattern: { type: 'string', description: 'URL pattern to match (e.g., "github.com")' },
    },
    required: [],
  },
  async execute(args: Record<string, unknown>): Promise<ToolResult> {
    const { tabId, urlPattern } = args as { tabId?: number; urlPattern?: string };

    if (tabId != null) {
      const tab = await chrome.tabs.get(tabId);
      if (!tab.id) {
        return { success: false, error: 'Tab not found' };
      }
      await chrome.tabs.update(tabId, { active: true });
      return {
        success: true,
        content: JSON.stringify({ tab: { id: tab.id, url: tab.url, title: tab.title } }),
      };
    }

    if (urlPattern) {
      const tabs = await chrome.tabs.query({ currentWindow: true });
      const matchingTab = tabs.find((tab) => tab.url?.includes(urlPattern));
      if (!matchingTab?.id) {
        return { success: false, error: `No tab found matching pattern: ${urlPattern}` };
      }
      await chrome.tabs.update(matchingTab.id, { active: true });
      return {
        success: true,
        content: JSON.stringify({ tab: { id: matchingTab.id, url: matchingTab.url, title: matchingTab.title } }),
      };
    }

    return { success: false, error: 'Either tabId or urlPattern must be provided' };
  },
};

export default browser_switch_tab;
