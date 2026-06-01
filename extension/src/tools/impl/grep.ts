import type { ToolResult } from '../../core/types.js';
import type { ToolDefinition } from '../types.js';

const grep: ToolDefinition = {
  name: 'grep',
  description: 'Search for a pattern in files',
  parameters: {
    type: 'object',
    properties: {
      pattern: { type: 'string', description: 'Search pattern (regex)' },
      path: { type: 'string', description: 'Directory to search in' },
      include: { type: 'string', description: 'File glob filter (e.g. "*.ts")' },
    },
    required: ['pattern'],
  },
  async execute(args: Record<string, unknown>): Promise<ToolResult> {
    const { pattern, path, include } = args as {
      pattern: string;
      path?: string;
      include?: string;
    };
    return {
      success: true,
      data: { pattern, path, include },
    };
  },
};

export default grep;
