/**
 * 纯文本协议解析器
 *
 * 格式：
 * ```tool_call
 * ===
 * tool_name
 * ---
 * key: value
 * ---
 * key: <<<
 * multi-line content
 * >>>
 * ===
 * ```
 *
 * - `===` 分隔多个工具调用
 * - `---` 分隔参数
 * - `<<<`/`>>>` 包裹多行内容（无需转义）
 */

import type { ParsedToolCall } from './types';

/**
 * Debug logging gated by environment. Set WEBAI_DEBUG=1 to enable.
 */



const TOOL_CALL_SEPARATOR = '===';
const PARAM_SEPARATOR = '---';
const MULTILINE_START = '<<<';
const MULTILINE_END = '>>>';

/**
 * Check if text contains the text protocol format.
 * Returns true if the text contains `===` followed by a known tool name.
 */
export function isTextProtocol(text: string): boolean {
  const lines = text.split('\n');
  for (let i = 0; i < lines.length; i++) {
    const trimmed = lines[i].trim();
    if (trimmed.includes(TOOL_CALL_SEPARATOR)) {
      return true;
    }
  }
  return false;
}

/**
 * Parse tool calls from text protocol format.
 * Only returns COMPLETE tool_calls (with closing `===` and all `<<<` closed by `>>>`).
 */
export function parseTextToolCalls(text: string): ParsedToolCall[] {
  const calls: ParsedToolCall[] = [];
  const lines = text.split('\n');

  let i = 0;

  while (i < lines.length) {
    // Find next `===` (possibly concatenated with other text)
    while (i < lines.length && !lines[i].trim().includes(TOOL_CALL_SEPARATOR)) {
      i++;
    }
    if (i >= lines.length) break;

    // Skip past `===`
    i++;

    // Find tool name (skip empty lines)
    let toolName = '';
    while (i < lines.length) {
      const line = lines[i].trim();
      i++;
      if (line === '') continue;
      toolName = line;
        break;
    }

    if (!toolName) continue;

    // Parse parameters until next `===` or end of text
    const args: Record<string, unknown> = {};
    let foundClosingSeparator = false;
    let hasUnclosedMultiline = false;

    while (i < lines.length) {
      const line = lines[i];
      const trimmed = line.trim();

      // Next tool call starts — this tool_call is complete
      if (trimmed === TOOL_CALL_SEPARATOR) {
        foundClosingSeparator = true;
        break;
      }

      // Skip param separator
      if (trimmed === PARAM_SEPARATOR) {
        i++;
        continue;
      }

      // Parse key: value or key: <<<...>>>
      const colonIdx = line.indexOf(':');
      if (colonIdx > 0) {
        const key = line.substring(0, colonIdx).trim();
        const valuePart = line.substring(colonIdx + 1).trim();

        if (valuePart === MULTILINE_START) {
          // Multi-line value: collect until `>>>`
          i++;
          const contentLines: string[] = [];
          let foundMultilineEnd = false;
          while (i < lines.length) {
            if (lines[i].trim() === MULTILINE_END) {
              foundMultilineEnd = true;
              i++;
              break;
            }
            contentLines.push(lines[i]);
            i++;
          }
          if (!foundMultilineEnd) {
            hasUnclosedMultiline = true;
            console.warn('[WebAI][TextParser] WARN: unclosed multiline for key:', key);
          }
          args[key] = contentLines.join('\n');
          // 如果内容为空，标记为未闭合（内容还在流式渲染中）
          if (contentLines.length === 0 || (contentLines.length === 1 && contentLines[0].trim() === '')) {
            hasUnclosedMultiline = true;
            console.warn('[WebAI][TextParser] WARN: empty multiline content for key:', key);
          }
        } else if (valuePart.startsWith(MULTILINE_START) && valuePart.endsWith(MULTILINE_END) && valuePart.length > MULTILINE_START.length + MULTILINE_END.length) {
          // Edge case: <<<content>>> on same line (no newlines in DOM extraction)
          const inner = valuePart.slice(MULTILINE_START.length, -MULTILINE_END.length);
          args[key] = inner;
          i++;
        } else if (valuePart !== '') {
          // Single-line value with type coercion
          args[key] = coerceValue(valuePart);
          i++;
        } else {
          // Empty value
          args[key] = '';
          i++;
        }
      } else {
        i++;
      }
    }

    // Only return COMPLETE tool_calls:
    // - Must have closing `===` separator
    // - Must not have unclosed `<<<` multiline content
    if (foundClosingSeparator && !hasUnclosedMultiline) {
      calls.push({ name: toolName, arguments: args });
    } else {
      // discarded incomplete tool_call
    }
  }

  return calls;
}

/**
 * Coerce string values to their proper types.
 * "true" → true, "false" → false, "123" → 123, "3.14" → 3.14
 */
function coerceValue(value: string): unknown {
  const lower = value.toLowerCase();
  if (lower === 'true') {
    return true;
  }
  if (lower === 'false') return false;
  const trimmed = value.trim();
  if (trimmed !== '' && !isNaN(Number(trimmed))) return Number(trimmed);
  return value;
}
