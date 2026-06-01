/**
 * 请求拦截器类型定义
 * 基于 API 请求/响应的平台感知，替代 DOM 适配器
 */

import type { AIStatus } from '../core/types';

export interface PlatformPattern {
  name: string;
  detect(): boolean;
  matchSendRequest(url: string, method: string): boolean;
  extractUserMessage(body: string): string | null;
  extractConversationId(body: string): string | null;
  parseStreamEvent(data: string): StreamEvent | null;
  isFinished(data: string): boolean;
}

export type StreamEventType = 'text_delta' | 'status' | 'heartbeat' | 'error' | 'unknown';

export interface StreamEvent {
  type: StreamEventType;
  text?: string;
  status?: string;
  raw?: string;
}

export type InterceptorState = 'idle' | 'generating' | 'finished' | 'error';

export interface InterceptorSnapshot {
  aiStatus: AIStatus;
  platform: string | null;
  conversationId: string | null;
  lastUserMessage: string | null;
  accumulatedText: string;
  textStable: boolean;
  finishedAt: number | null;
  updatedAt: number;
}

export interface InterceptorCallbacks {
  onGenerationStart?: (conversationId: string | null) => void;
  onTextDelta?: (text: string, accumulated: string) => void;
  onGenerationComplete?: (fullText: string, conversationId: string | null) => void;
  onGenerationStopped?: () => void;
  onToolCallDetected?: (toolCallText: string) => void;
  onSendViaApiResult?: (success: boolean, error?: string) => void;
  onError?: (error: string) => void;
}
