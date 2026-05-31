import type { ToolResult } from '../../core/types.js';
import type { ToolDefinition } from '../../tools/types.js';

const browser_click: ToolDefinition = {
  name: 'browser_click',
  description: 'Click an element by its UID from a search_elements result',
  parameters: {
    type: 'object',
    properties: {
      tabId: { type: 'number', description: 'Tab ID' },
      uid: { type: 'string', description: 'Element UID from search_elements result' },
    },
    required: ['tabId', 'uid'],
  },
  async execute(_args: Record<string, unknown>): Promise<ToolResult> {
    return { success: true, content: 'Click will be executed by background' };
  },
};

export default browser_click;
