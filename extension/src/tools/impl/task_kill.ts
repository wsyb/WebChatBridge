import type { ToolResult } from '../../core/types.js';
import type { ToolDefinition } from '../types.js';

const task_kill: ToolDefinition = {
  name: 'task_kill',
  description: 'Kill a running background task',
  parameters: {
    type: 'object',
    properties: {
      task_id: { type: 'string', description: 'Task ID to kill' },
    },
    required: ['task_id'],
  },
  async execute(args: Record<string, unknown>): Promise<ToolResult> {
    const { task_id } = args as { task_id: string };
    return { success: true, data: { task_id } };
  },
};

export default task_kill;
