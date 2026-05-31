import type { ToolResult } from '../../core/types.js';
import type { ToolDefinition } from '../../tools/types.js';

const browser_search_elements: ToolDefinition = {
  name: 'browser_search_elements',
  description: 'Search for elements in the current page using glob patterns. Returns matching elements with UIDs for click/fill.',
  parameters: {
    type: 'object',
    properties: {
      tabId: { type: 'number', description: 'Tab ID to search in' },
      query: { type: 'string', description: 'Search query with glob patterns (e.g., "button*", "{input,textarea}*")' },
      contextLevels: { type: 'number', description: 'Context lines around matches (default: 1)' },
    },
    required: ['tabId', 'query'],
  },
  async execute(_args: Record<string, unknown>): Promise<ToolResult> {
    return { success: true, content: 'Search will be executed by background' };
  },
};

export default browser_search_elements;
