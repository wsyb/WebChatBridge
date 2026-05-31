/**
 * Detector module — 检测 AI 回复中的 tool_call
 */

// Re-export all public types
export type { ParsedToolCall, DetectionResult } from './types';

// Re-export parser functions
export {
  extractJSON,
  isPlaceholder,
  normalizeToolCall,
  parseToolCallsFromText,
} from './parser';
