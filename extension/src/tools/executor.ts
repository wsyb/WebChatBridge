import type { ToolResult, ToolCall } from '../core/types.js';
import type { ToolRegistry } from './registry.js';
import { httpClient } from '../core/http-client.js';

export class ToolExecutor {
  constructor(private registry: ToolRegistry) {}

  async execute(call: ToolCall): Promise<ToolResult> {
    const tool = this.registry.get(call.name);
    if (!tool) {
      return { success: false, error: `Unknown tool: ${call.name}` };
    }

    return httpClient.executeTool(call);
  }
}
