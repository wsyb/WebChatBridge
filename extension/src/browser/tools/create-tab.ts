import type { ToolResult } from '../../core/types.js';
import type { ToolDefinition } from '../../tools/types.js';

const browser_create_tab: ToolDefinition = {
  name: 'browser_create_tab',
  description: 'Create a new browser tab with the specified URL',
  parameters: {
    type: 'object',
    properties: {
      url: { type: 'string', description: 'The URL to open in the new tab' },
      active: { type: 'boolean', description: 'Whether the new tab should be active (default: true)' },
    },
    required: ['url'],
  },
  async execute(args: Record<string, unknown>): Promise<ToolResult> {
    const { url, active = true } = args as { url: string; active?: boolean };

    let finalUrl = url?.trim();
    if (!finalUrl) {
      return { success: false, error: 'URL is required' };
    }
    if (!/^https?:\/\//i.test(finalUrl) && !/^chrome:|^chrome-extension:/i.test(finalUrl)) {
      finalUrl = `https://${finalUrl}`;
    }

    const tab = await chrome.tabs.create({ url: finalUrl, active });
    if (!tab.id) {
      return { success: false, error: 'Failed to create tab' };
    }

    return {
      success: true,
      content: JSON.stringify({ tabId: tab.id, url: tab.url, title: tab.title }),
    };
  },
};

export default browser_create_tab;
