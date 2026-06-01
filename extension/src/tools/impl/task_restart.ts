import type { ToolResult } from '../../core/types.js';
import type { ToolDefinition } from '../types.js';

const task_restart: ToolDefinition = {
  name: 'task_restart',
  description: 'Restart a background task (kill then start with same command)',
  parameters: {
    type: 'object',
    properties: {
      task_id: { type: 'string', description: 'Task ID to restart' },
    },
    required: ['task_id'],
  },
  async execute(args: Record<string, unknown>): Promise<ToolResult> {
    const { task_id } = args as { task_id: string };
    return { success: true, data: { task_id } };
  },
};

export default task_restart;
