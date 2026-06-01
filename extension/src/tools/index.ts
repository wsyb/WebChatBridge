export type { ToolDefinition } from './types.js';
export { ToolRegistry } from './registry.js';
export { ToolExecutor } from './executor.js';

import { ToolRegistry } from './registry.js';
import { ToolExecutor } from './executor.js';

import ls from './impl/ls.js';
import read from './impl/read.js';
import write from './impl/write.js';
import edit from './impl/edit.js';
import grep from './impl/grep.js';
import glob from './impl/glob.js';
import shell from './impl/shell.js';
import task_start from './impl/task_start.js';
import task_list from './impl/task_list.js';
import task_logs from './impl/task_logs.js';
import task_kill from './impl/task_kill.js';
import task_restart from './impl/task_restart.js';

export function createDefaultRegistry(): ToolRegistry {
  const registry = new ToolRegistry();
  for (const tool of [ls, read, write, edit, grep, glob, shell, task_start, task_list, task_logs, task_kill, task_restart]) {
    registry.register(tool);
  }
  return registry;
}

export function createDefaultExecutor(): ToolExecutor {
  return new ToolExecutor(createDefaultRegistry());
}
