import type { ToolResult } from '../../core/types.js';
import type { ToolDefinition } from '../types.js';

const task_logs: ToolDefinition = {
  name: 'task_logs',
  description: 'Get stdout/stderr logs of a background task',
  parameters: {
    type: 'object',
    properties: {
      task_id: { type: 'string', description: 'Task ID to get logs for' },
      tail: { type: 'number', description: 'Number of last lines to show (optional)' },
    },
    required: ['task_id'],
  },
  async execute(args: Record<string, unknown>): Promise<ToolResult> {
    const { task_id, tail } = args as { task_id: string; tail?: number };
    return { success: true, data: { task_id, tail } };
  },
};

export default task_logs;
