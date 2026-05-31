import type { ToolResult } from '../../core/types.js';
import type { ToolDefinition } from '../types.js';

const task_start: ToolDefinition = {
  name: 'task_start',
  description: 'Start a command as a background task (for long-running processes like servers)',
  parameters: {
    type: 'object',
    properties: {
      command: { type: 'string', description: 'The command to run in background' },
      cwd: { type: 'string', description: 'Working directory (optional)' },
    },
    required: ['command'],
  },
  async execute(args: Record<string, unknown>): Promise<ToolResult> {
    const { command, cwd } = args as { command: string; cwd?: string };
    return {
      success: true,
      data: { command, cwd },
    };
  },
};

export default task_start;
