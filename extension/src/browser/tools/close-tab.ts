import type { ToolResult } from '../../core/types.js';
import type { ToolDefinition } from '../../tools/types.js';
import { getActiveTab } from '../tab-utils.js';

const browser_close_tab: ToolDefinition = {
  name: 'browser_close_tab',
  description: 'Close a specific tab or the current active tab',
  parameters: {
    type: 'object',
    properties: {
      tabId: { type: 'number', description: 'Tab ID to close (defaults to current active tab)' },
    },
    required: [],
  },
  async execute(args: Record<string, unknown>): Promise<ToolResult> {
    const { tabId } = args as { tabId?: number };

    if (tabId != null) {
      await chrome.tabs.remove(tabId);
      return { success: true, content: JSON.stringify({ closed: true, tabId }) };
    }

    const tab = await getActiveTab();
    await chrome.tabs.remove(tab.id!);
    return { success: true, content: JSON.stringify({ closed: true, tabId: tab.id }) };
  },
};

export default browser_close_tab;
