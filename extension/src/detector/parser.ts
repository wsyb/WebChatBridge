import type { ParsedToolCall } from './types';

/**
 * Debug logging gated by environment. Set WEBAI_DEBUG=1 to enable.
 */
import { isTextProtocol, parseTextToolCalls } from './text-parser';

/**
 * Valid tool names that we recognize.
 */
const VALID_TOOLS: readonly string[] = [
  'ls',
  'read',
  'write',
  'edit',
  'grep',
  'glob',
  'run_shell_command',
  'task_start',
  'task_list',
  'task_logs',
  'task_kill',
  'task_restart',
];

/**
 * Placeholder keywords found in prompt templates / examples.
 * If a JSON string contains any of these, it is likely a template, not a real call.
 */
const PLACEHOLDER_KEYWORDS: readonly string[] = [
  'real_value',
  'your_',
  'xxx',
  '/path/to/',
  '/search/in/',
];

// ---------------------------------------------------------------------------
// JSON extraction (brace matching + string-aware)
// ---------------------------------------------------------------------------

interface ExtractedJSON {
  json: string;
  endPos: number;
}

/**
 * Extract the first complete JSON object starting from `startPos`.
 *
 * Walks character-by-character, tracking brace depth and string state so that
 * braces inside quoted strings are ignored.
 */
export function extractJSON(text: string, startPos: number): ExtractedJSON | null {
  let braceStart = -1;
  for (let i = startPos; i < text.length; i++) {
    if (text[i] === '{') {
      braceStart = i;
      break;
    }
  }
  if (braceStart === -1) return null;

  let depth = 0;
  let inString = false;
  let escapeNext = false;

  for (let i = braceStart; i < text.length; i++) {
    const ch = text[i];

    if (escapeNext) {
      escapeNext = false;
      continue;
    }

    if (ch === '\\' && inString) {
      escapeNext = true;
      continue;
    }

    if (ch === '"') {
      inString = !inString;
      continue;
    }

    if (inString) continue;

    if (ch === '{') {
      depth++;
    } else if (ch === '}') {
      depth--;
      if (depth === 0) {
        return {
          json: text.substring(braceStart, i + 1),
          endPos: i + 1,
        };
      }
    }
  }

  return null;
}

/**
 * Fix JSON strings that contain literal newlines inside quoted strings.
 * AI models sometimes output unescaped newlines in JSON, which breaks JSON.parse.
 */
function fixLiteralNewlines(jsonStr: string): string {
  const result: string[] = [];
  let inString = false;
  let escapeNext = false;

  for (let i = 0; i < jsonStr.length; i++) {
    const ch = jsonStr[i];

    if (escapeNext) {
      result.push(ch);
      escapeNext = false;
      continue;
    }

    if (ch === '\\' && inString) {
      result.push(ch);
      escapeNext = true;
      continue;
    }

    if (ch === '"') {
      inString = !inString;
      result.push(ch);
      continue;
    }

    if (inString) {
      // Replace literal newlines with escaped newlines
      if (ch === '\n') {
        result.push('\\n');
      } else if (ch === '\r') {
        result.push('\\r');
      } else if (ch === '\t') {
        result.push('\\t');
      } else {
        result.push(ch);
      }
    } else {
      result.push(ch);
    }
  }

  return result.join('');
}

// ---------------------------------------------------------------------------
// Placeholder detection
// ---------------------------------------------------------------------------

/**
 * Check whether a text string looks like a placeholder/template example.
 */
export function isPlaceholder(text: string): boolean {
  const lower = text.toLowerCase();
  return PLACEHOLDER_KEYWORDS.some((kw) => lower.includes(kw));
}

// ---------------------------------------------------------------------------
// Normalize tool call shape
// ---------------------------------------------------------------------------

/**
 * Normalize various tool_call JSON shapes into a consistent `{ name, arguments }` form.
 *
 * Handles:
 * - `{ name, arguments }`       (canonical)
 * - `{ tool, args }`            (alternate keys)
 * - `{ name, ...rest }`         (inline args)
 */
export function normalizeToolCall(raw: Record<string, unknown>): ParsedToolCall {
  const name = (raw.name ?? raw.tool) as string | undefined;
  let args = (raw.arguments ?? raw.args) as Record<string, unknown> | undefined;

  if (!raw.arguments && !raw.args) {
    const { name: _n, tool: _t, ...rest } = raw;
    if (Object.keys(rest).length > 0) {
      args = rest as Record<string, unknown>;
    }
  }

  return {
    name: name ?? '',
    arguments: (args && typeof args === 'object' ? args : {}) as Record<string, unknown>,
  };
}

// ---------------------------------------------------------------------------
// Parse tool calls from raw text
// ---------------------------------------------------------------------------

/**
 * Scan `text` for every `tool_call{...}` pattern and return the parsed calls.
 *
 * Supports two formats:
 * 1. Text protocol: `===` separated tool calls with `---` params and `<<<`/`>>>` multiline
 * 2. JSON protocol: `tool_call{...}` with JSON objects (legacy)
 *
 * Only calls whose name is in `VALID_TOOLS` are kept.
 */
export function parseToolCallsFromText(text: string): ParsedToolCall[] {
  // Text protocol: check for `===` + known tool name pattern
  if (isTextProtocol(text)) {
    return parseTextToolCalls(text);
  }

  // JSON protocol (legacy)
  const calls: ParsedToolCall[] = [];
  let searchPos = 0;

  while (searchPos < text.length) {
    const markerPos = text.indexOf('tool_call', searchPos);
    if (markerPos === -1) break;

    const result = extractJSON(text, markerPos + 9);
    if (!result) {
      searchPos = markerPos + 9;
      continue;
    }

    try {
      const jsonStr = result.json;

      // Skip placeholder/template examples
      if (isPlaceholder(jsonStr)) {
        searchPos = result.endPos;
        continue;
      }

      let rawCall: Record<string, unknown>;
      try {
        rawCall = JSON.parse(jsonStr) as Record<string, unknown>;
      } catch {
        // JSON parse failed — try fixing literal newlines
        const fixedJson = fixLiteralNewlines(jsonStr);
        rawCall = JSON.parse(fixedJson) as Record<string, unknown>;
      }

      const call = normalizeToolCall(rawCall);

      // Only accept known tool names with valid arguments
      if (call.name && VALID_TOOLS.includes(call.name)) {
        if (!call.arguments || typeof call.arguments !== 'object') {
          call.arguments = {};
        }
        calls.push(call);
      }
    } catch {
      // JSON parse failure — skip and continue
    }

    searchPos = result.endPos;
  }

  return calls;
}
