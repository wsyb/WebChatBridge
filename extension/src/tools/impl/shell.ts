import type { ToolResult } from '../../core/types.js';
import type { ToolDefinition } from '../types.js';

const shell: ToolDefinition = {
  name: 'shell',
  description: 'Execute a shell command',
  parameters: {
    type: 'object',
    properties: {
      command: { type: 'string', description: 'Command to execute' },
      is_background: { type: 'boolean', description: 'Run in background' },
      timeout: { type: 'number', description: 'Timeout in milliseconds' },
    },
    required: ['command'],
  },
  async execute(args: Record<string, unknown>): Promise<ToolResult> {
    const { command, is_background, timeout } = args as {
      command: string;
      is_background?: boolean;
      timeout?: number;
    };
    return {
      success: true,
      data: { command, is_background: is_background ?? false, timeout },
    };
  },
};

export default shell;
