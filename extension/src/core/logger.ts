/**
 * 结构化日志系统
 * 支持级别控制、模块标记、correlationId 追踪
 */

import { LogLevel, type LogEntry } from './types.js';

// ============================================================
// 常量
// ============================================================

const STORAGE_KEY = 'wcb_log_level';
const MAX_LOGS = 500;
const LOG_ENDPOINT_PORT = 18789;

// ============================================================
// 日志管理器
// ============================================================

class LogManager {
  private currentLevel: LogLevel = LogLevel.INFO;
  private logs: LogEntry[] = [];
  private initialized = false;

  async initialize(): Promise<void> {
    if (this.initialized) return;

    try {
      if (typeof chrome !== 'undefined' && chrome?.runtime?.id) {
        const result = await chrome.storage.local.get([STORAGE_KEY]);
        if (result[STORAGE_KEY] !== undefined) {
          this.currentLevel = result[STORAGE_KEY] as LogLevel;
        }
      }
    } catch {
      // 忽略存储错误
    }

    this.initialized = true;
  }

  getLevel(): LogLevel {
    return this.currentLevel;
  }

  async setLevel(level: LogLevel): Promise<void> {
    this.currentLevel = level;
    try {
      if (typeof chrome !== 'undefined' && chrome?.runtime?.id) {
        await chrome.storage.local.set({ [STORAGE_KEY]: level });
      }
    } catch {
      // 忽略存储错误
    }
  }

  addEntry(entry: LogEntry): void {
    this.logs.push(entry);
    if (this.logs.length > MAX_LOGS) {
      this.logs = this.logs.slice(-MAX_LOGS);
    }
  }

  getLogs(level?: LogLevel): LogEntry[] {
    if (level !== undefined) {
      return this.logs.filter((l) => l.level >= level);
    }
    return [...this.logs];
  }

  clearLogs(): void {
    this.logs = [];
  }

  writeToBackground(entry: LogEntry): void {
    try {
      const levelName = LogLevel[entry.level];
      const dataStr = entry.data ? JSON.stringify(entry.data) : undefined;
      const body = JSON.stringify({
        module: entry.module,
        msg: `[${levelName}] ${entry.message}`,
        data: dataStr,
      });

      fetch(`http://localhost:${LOG_ENDPOINT_PORT}/api/log`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body,
      }).catch(() => {});
    } catch {
      // 忽略通信错误
    }
  }
}

// 全局日志管理器
const logManager = new LogManager();

// ============================================================
// Logger 类
// ============================================================

export class Logger {
  private module: string;
  private parentCorrelationId?: string;

  constructor(module: string, correlationId?: string) {
    this.module = module;
    this.parentCorrelationId = correlationId;
  }

  /**
   * 创建子 logger，自动附加 correlationId
   */
  child(subModule: string, correlationId?: string): Logger {
    return new Logger(
      `${this.module}:${subModule}`,
      correlationId ?? this.parentCorrelationId,
    );
  }

  /**
   * 创建带 correlationId 的 logger 实例
   */
  withCorrelation(correlationId: string): Logger {
    return new Logger(this.module, correlationId);
  }

  debug(message: string, data?: unknown): void {
    this.log(LogLevel.DEBUG, message, data);
  }

  info(message: string, data?: unknown): void {
    this.log(LogLevel.INFO, message, data);
  }

  warn(message: string, data?: unknown): void {
    this.log(LogLevel.WARN, message, data);
  }

  error(message: string, data?: unknown): void {
    this.log(LogLevel.ERROR, message, data);
  }

  private log(level: LogLevel, message: string, data?: unknown): void {
    const entry: LogEntry = {
      timestamp: Date.now(),
      level,
      module: this.module,
      message,
      data: data !== undefined ? data : undefined,
      correlationId: this.parentCorrelationId,
    };

    // 添加到内存（始终）
    logManager.addEntry(entry);

    // 控制台输出（始终，不受级别过滤）
    this.outputToConsole(entry);

    // 写入 native host 日志文件（INFO 及以上）
    if (level >= LogLevel.INFO) {
      logManager.writeToBackground(entry);
    }
  }

  private outputToConsole(entry: LogEntry): void {
    const levelName = LogLevel[entry.level];
    const prefix = `[WebAI][${levelName}][${entry.module}]`;
    const corrId = entry.correlationId ? ` [${entry.correlationId}]` : '';
    const fullPrefix = `${prefix}${corrId}`;

    const style =
      entry.level === LogLevel.ERROR
        ? 'color: #f87171; font-weight: bold'
        : entry.level === LogLevel.WARN
          ? 'color: #fbbf24'
          : entry.level === LogLevel.DEBUG
            ? 'color: #888'
            : 'color: #4ade80';

    if (entry.data !== undefined) {
      console.log(`%c${fullPrefix} ${entry.message}`, style, entry.data);
    } else {
      console.log(`%c${fullPrefix} ${entry.message}`, style);
    }
  }
}

// ============================================================
// 导出便捷函数
// ============================================================

export function getLogger(module: string): Logger {
  return new Logger(module);
}

export async function initializeLogger(): Promise<void> {
  await logManager.initialize();
}

export function getLogManager(): LogManager {
  return logManager;
}
