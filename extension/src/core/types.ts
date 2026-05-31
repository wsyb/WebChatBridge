/**
 * 核心类型定义
 * Web Chat Bridge 浏览器插件的基础类型
 */

// ============================================================
// 日志相关
// ============================================================

export enum LogLevel {
  DEBUG = 0,
  INFO = 1,
  WARN = 2,
  ERROR = 3,
}

export interface LogEntry {
  timestamp: number;
  level: LogLevel;
  module: string;
  message: string;
  data?: unknown;
  correlationId?: string;
}

// ============================================================
// 状态机相关
// ============================================================

/** 扩展全局状态 */
export type ExtensionState =
  | 'idle'
  | 'detecting'
  | 'executing'
  | 'injecting'
  | 'waiting'
  | 'paused';

export interface StateTransitions {
  idle: ['detecting', 'executing'];
  detecting: ['idle', 'executing'];
  executing: ['injecting', 'idle', 'paused'];
  injecting: ['waiting', 'idle', 'paused'];
  waiting: ['idle', 'paused'];
  paused: ['idle'];
}

export interface StateSnapshot {
  current: ExtensionState;
  connected: boolean;
  conversationId: string;
  currentRound: number;
}

// ============================================================
// AI 状态相关（适配器提供）
// ============================================================

export type AIStatus = 'generating' | 'idle' | 'paused' | 'stopped';

export interface AIStateSnapshot {
  status: AIStatus;
  hasContinueButton: boolean;
  hasStopButton: boolean;
  hasRegenerateButton: boolean;
  textareaHasContent: boolean;
  timestamp: number;
}

// ============================================================
// 管道系统相关
// ============================================================

export type ToolCallStatus =
  | 'pending'
  | 'validated'
  | 'deduplicated'
  | 'executing'
  | 'executed'
  | 'injecting'
  | 'injected'
  | 'confirming'
  | 'confirmed'
  | 'failed'
  | 'skipped';

export interface PipelineToolCall {
  id: string;
  hash: string;
  call: ToolCall;
  /** 关联的 DOM 元素（用于执行后标记 data-executed） */
  element?: Element;
  status: ToolCallStatus;
  result?: ToolResult;
  error?: string;
  attemptCount: number;
  createdAt: number;
  updatedAt: number;
}

// ============================================================
// 事件系统相关
// ============================================================

export type EventHandler<T = unknown> = (payload: T) => void | Promise<void>;

export interface Unsubscribe {
  (): void;
}

// ============================================================
// 工具系统相关
// ============================================================

export interface ToolResult {
  success: boolean;
  data?: unknown;
  error?: string;
  stdout?: string;
  stderr?: string;
  content?: string;
}

export interface ToolCall {
  name: string;
  arguments: Record<string, unknown>;
}

export interface ToolCallHash {
  hash: string;
  call: ToolCall;
}

// ============================================================
// 消息通信相关
// ============================================================

export interface Message<T = unknown> {
  type: string;
  payload?: T;
  requestId?: string;
  correlationId?: string;
}

export interface ToolExecutionMessage extends Message<ToolCall> {
  type: 'EXECUTE_TOOL_CALL';
}

export interface ToolResultMessage extends Message<ToolResult> {
  type: 'TOOL_RESULT';
}

export interface ConnectionStatusMessage extends Message {
  type: 'CONNECTION_STATUS';
  connected: boolean;
}

export interface SystemInfoMessage extends Message {
  type: 'DETECT_SYSTEM';
}

export interface SystemInfo {
  os: 'linux' | 'macos' | 'windows';
  shell: string;
  pathSeparator: string;
  homeDir: string;
  workDir: string;
}

// ============================================================
// 适配器相关
// ============================================================

export interface AdapterDefinition {
  name: string;
  detect(): boolean;
  findInput(): HTMLElement | null;
  findInputContainer(): HTMLElement | null;
  findSendButton(): HTMLButtonElement | null;
  isButtonDisabled(btn: HTMLButtonElement): boolean;
  injectText(input: HTMLElement, text: string): void;
  getConversationId(): string;
  messageSelectors: string[];
}

// ============================================================
// 配置相关
// ============================================================

export interface ExtensionConfig {
  logLevel: LogLevel;
  toolbarEnabled: boolean;
  autoInject: boolean;
  cooldownMs: number;
  maxProcessedHashes: number;
  nativeHostName: string;
  nativeHost: string;
  nativeHostPort: number;
  reconnectInterval: number;
  maxReconnectAttempts: number;
}

// ============================================================
// Chrome 扩展 API 类型增强
// ============================================================

export interface ChromeRuntimeMessage<T = unknown> {
  type: string;
  payload?: T;
  requestId?: number;
  content?: string;
  path?: string;
}

export interface ChromeRuntimeResponse<T = unknown> {
  success?: boolean;
  error?: string;
  result?: T;
  connected?: boolean;
}
