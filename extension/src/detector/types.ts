/**
 * Parsed tool call from AI message content.
 */
export interface ParsedToolCall {
  /** Tool name, e.g. "ls", "read", "write" */
  name: string;
  /** Tool arguments as key-value pairs */
  arguments: Record<string, unknown>;
}

/**
 * Result of a detection scan.
 */
export interface DetectionResult {
  /** All parsed tool calls found */
  calls: ParsedToolCall[];
  /** Combined hash for dedup */
  hash: string;
}
