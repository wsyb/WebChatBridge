import type { ToolResult } from '../../core/types.js';
import type { ToolDefinition } from '../../tools/types.js';

const browser_evaluate_js: ToolDefinition = {
  name: 'browser_evaluate_js',
  description: 'Execute JavaScript code in the context of the current page',
  parameters: {
    type: 'object',
    properties: {
      code: { type: 'string', description: 'JavaScript code to execute' },
      tabId: { type: 'number', description: 'Tab ID (defaults to current active tab)' },
    },
    required: ['code'],
  },
  async execute(_args: Record<string, unknown>): Promise<ToolResult> {
    return { success: true, content: 'JS will be executed by background' };
  },
};

export default browser_evaluate_js;
