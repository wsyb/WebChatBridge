import type { ToolResult } from '../../core/types.js';
import type { ToolDefinition } from '../../tools/types.js';

const browser_get_page_content: ToolDefinition = {
  name: 'browser_get_page_content',
  description: 'Get the text content and metadata of the current page',
  parameters: {
    type: 'object',
    properties: {
      tabId: { type: 'number', description: 'Tab ID (defaults to current active tab)' },
      maxLength: { type: 'number', description: 'Max text length to return (default: 5000)' },
    },
    required: [],
  },
  async execute(_args: Record<string, unknown>): Promise<ToolResult> {
    return { success: true, content: 'Page content will be fetched by background' };
  },
};

export default browser_get_page_content;
