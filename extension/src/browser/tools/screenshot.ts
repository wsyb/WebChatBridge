import type { ToolResult } from '../../core/types.js';
import type { ToolDefinition } from '../../tools/types.js';

const browser_screenshot: ToolDefinition = {
  name: 'browser_screenshot',
  description: 'Capture a screenshot of the current visible tab. Returns base64 image data.',
  parameters: {
    type: 'object',
    properties: {
      quality: { type: 'number', description: 'Image quality 0-1 (default: 0.6)' },
      maxWidth: { type: 'number', description: 'Max width in pixels (default: 1024)' },
    },
    required: [],
  },
  async execute(_args: Record<string, unknown>): Promise<ToolResult> {
    // Execution happens in background via port messaging
    // This is just a placeholder for the tool registry
    return { success: true, content: 'Screenshot will be captured by background' };
  },
};

export default browser_screenshot;
