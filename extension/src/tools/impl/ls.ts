import type { ToolResult } from '../../core/types.js';
import type { ToolDefinition } from '../types.js';

const ls: ToolDefinition = {
  name: 'ls',
  description: 'List directory contents',
  parameters: {
    type: 'object',
    properties: {
      path: { type: 'string', description: 'Directory path to list' },
      ignore: {
        type: 'array',
        items: { type: 'string' },
        description: 'Patterns to ignore',
      },
    },
    required: ['path'],
  },
  async execute(args: Record<string, unknown>): Promise<ToolResult> {
    const { path, ignore } = args as { path: string; ignore?: string[] };
    return {
      success: true,
      data: { path, ignore: ignore ?? [] },
    };
  },
};

export default ls;
