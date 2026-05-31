import type { ToolResult } from '../../core/types.js';
import type { ToolDefinition } from '../types.js';

const read: ToolDefinition = {
  name: 'read',
  description: 'Read file contents',
  parameters: {
    type: 'object',
    properties: {
      file_path: { type: 'string', description: 'Path to the file' },
      start_line: { type: 'number', description: 'Start line (1-based)' },
      end_line: { type: 'number', description: 'End line (1-based, inclusive)' },
      offset: { type: 'number', description: 'Line offset for pagination' },
      limit: { type: 'number', description: 'Max lines to read' },
    },
    required: ['file_path'],
  },
  async execute(args: Record<string, unknown>): Promise<ToolResult> {
    const { file_path, start_line, end_line, offset, limit } = args as {
      file_path: string;
      start_line?: number;
      end_line?: number;
      offset?: number;
      limit?: number;
    };
    return {
      success: true,
      data: { file_path, start_line, end_line, offset, limit },
    };
  },
};

export default read;
