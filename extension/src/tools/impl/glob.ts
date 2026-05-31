import type { ToolResult } from '../../core/types.js';
import type { ToolDefinition } from '../types.js';

const glob: ToolDefinition = {
  name: 'glob',
  description: 'Find files matching a glob pattern',
  parameters: {
    type: 'object',
    properties: {
      pattern: { type: 'string', description: 'Glob pattern (e.g. "**/*.ts")' },
      path: { type: 'string', description: 'Root directory to search from' },
    },
    required: ['pattern'],
  },
  async execute(args: Record<string, unknown>): Promise<ToolResult> {
    const { pattern, path } = args as { pattern: string; path?: string };
    return {
      success: true,
      data: { pattern, path },
    };
  },
};

export default glob;
