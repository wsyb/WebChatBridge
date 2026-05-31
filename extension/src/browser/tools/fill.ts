import type { ToolResult } from '../../core/types.js';
import type { ToolDefinition } from '../../tools/types.js';

const browser_fill: ToolDefinition = {
  name: 'browser_fill',
  description: 'Fill an input element by its UID from a search_elements result',
  parameters: {
    type: 'object',
    properties: {
      tabId: { type: 'number', description: 'Tab ID' },
      uid: { type: 'string', description: 'Element UID from search_elements result' },
      value: { type: 'string', description: 'Value to fill into the element' },
    },
    required: ['tabId', 'uid', 'value'],
  },
  async execute(_args: Record<string, unknown>): Promise<ToolResult> {
    return { success: true, content: 'Fill will be executed by background' };
  },
};

export default browser_fill;
