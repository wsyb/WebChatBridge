import type { ToolResult } from '../../core/types.js';
import type { ToolDefinition } from '../types.js';

const write: ToolDefinition = {
  name: 'write',
  description: 'Write content to a file',
  parameters: {
    type: 'object',
    properties: {
      file_path: { type: 'string', description: 'Path to the file' },
      content: { type: 'string', description: 'Content to write' },
    },
    required: ['file_path', 'content'],
  },
  async execute(args: Record<string, unknown>): Promise<ToolResult> {
    const { file_path, content } = args as { file_path: string; content: string };
    return {
      success: true,
      data: { file_path, content },
    };
  },
};

export default write;
