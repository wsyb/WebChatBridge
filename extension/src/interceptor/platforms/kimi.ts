import type { PlatformPattern, StreamEvent } from '../types';

export class KimiPattern implements PlatformPattern {
  name = 'kimi';

  detect(): boolean {
    return (
      window.location.hostname.includes('kimi.moonshot.cn') ||
      window.location.hostname.includes('www.kimi.com')
    );
  }

  matchSendRequest(url: string, method: string): boolean {
    return method === 'POST' && url.includes('ChatService/Chat');
  }

  extractUserMessage(body: string): string | null {
    try {
      const parsed = JSON.parse(body);
      const blocks = parsed.message?.blocks;
      if (blocks?.[0]?.text?.content) return blocks[0].text.content;
      return null;
    } catch { return null; }
  }

  extractConversationId(body: string): string | null {
    try {
      const parsed = JSON.parse(body);
      return parsed.chat_id || null;
    } catch { return null; }
  }

  /**
   * Kimi 使用 gRPC-web (connect+json) 协议
   * 流式响应格式类似 SSE 但通过 Connect 协议传输
   * 需要根据实际响应格式调整
   */
  parseStreamEvent(data: string): StreamEvent | null {
    if (!data || data.trim() === '[DONE]') return null;
    try {
      const p = JSON.parse(data);
      if (typeof p.v === 'string') return { type: 'text_delta', text: p.v };
      if (p.p?.includes('status') && p.v) return { type: 'status', status: String(p.v) };
      if (p.content) return { type: 'text_delta', text: p.content };
      return { type: 'unknown', raw: data };
    } catch { return { type: 'unknown', raw: data }; }
  }

  isFinished(data: string): boolean {
    try {
      const p = JSON.parse(data);
      if (p.p?.includes('status') && (p.v === 'FINISHED' || p.v === 'COMPLETED')) return true;
      if (p.status === 'completed' || p.status === 'finished') return true;
    } catch {}
    return false;
  }
}
