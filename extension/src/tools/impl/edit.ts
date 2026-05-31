import type { ToolResult } from '../../core/types.js';
import type { ToolDefinition } from '../types.js';

const edit: ToolDefinition = {
  name: 'edit',
  description: 'Replace text in a file',
  parameters: {
    type: 'object',
    properties: {
      file_path: { type: 'string', description: 'Path to the file' },
      old_string: { type: 'string', description: 'Text to find' },
      new_string: { type: 'string', description: 'Text to replace with' },
      replace_all: { type: 'boolean', description: 'Replace all occurrences' },
    },
    required: ['file_path', 'old_string', 'new_string'],
  },
  async execute(args: Record<string, unknown>): Promise<ToolResult> {
    const { file_path, old_string, new_string, replace_all } = args as {
      file_path: string;
      old_string: string;
      new_string: string;
      replace_all?: boolean;
    };
    return {
      success: true,
      data: { file_path, old_string, new_string, replace_all: replace_all ?? false },
    };
  },
};

export default edit;
