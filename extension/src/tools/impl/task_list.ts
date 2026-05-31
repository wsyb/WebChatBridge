import type { ToolResult } from '../../core/types.js';
import type { ToolDefinition } from '../types.js';

const task_list: ToolDefinition = {
  name: 'task_list',
  description: 'List all background tasks and their status',
  parameters: {
    type: 'object',
    properties: {},
    required: [],
  },
  async execute(): Promise<ToolResult> {
    return { success: true, data: {} };
  },
};

export default task_list;
