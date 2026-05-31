import type { ToolResult } from '../../core/types.js';
import type { ToolDefinition } from '../../tools/types.js';

const browser_list_tabs: ToolDefinition = {
  name: 'browser_list_tabs',
  description: 'List all open browser tabs across all windows',
  parameters: {
    type: 'object',
    properties: {},
    required: [],
  },
  async execute(_args: Record<string, unknown>): Promise<ToolResult> {
    const tabs = await chrome.tabs.query({});
    const tabList = tabs.map((tab) => ({
      id: tab.id,
      url: tab.url,
      title: tab.title,
      active: tab.active,
      windowId: tab.windowId,
      index: tab.index,
    }));
    return {
      success: true,
      content: JSON.stringify({ tabs: tabList, count: tabList.length }, null, 2),
    };
  },
};

export default browser_list_tabs;
