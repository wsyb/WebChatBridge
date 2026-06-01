import type { PlatformPattern, StreamEvent } from '../types';

export class DoubaoPattern implements PlatformPattern {
  name = 'doubao';

  detect(): boolean {
    return window.location.hostname.includes('www.doubao.com');
  }

  matchSendRequest(url: string, method: string): boolean {
    return method === 'POST' && url.includes('/chat/completion');
  }

  extractUserMessage(body: string): string | null {
    try {
      const parsed = JSON.parse(body);
      const blocks = parsed.messages?.[0]?.content_block;
      if (blocks?.[0]?.content?.text_block?.text) {
        return blocks[0].content.text_block.text;
      }
      return null;
    } catch { return null; }
  }

  extractConversationId(body: string): string | null {
    try {
      const parsed = JSON.parse(body);
      return parsed.client_meta?.conversation_id || null;
    } catch { return null; }
  }

  parseStreamEvent(data: string): StreamEvent | null {
    if (!data || data.trim() === '[DONE]') return null;
    try {
      const p = JSON.parse(data);
      if (p.event === 'SSE_HEARTBEAT') return { type: 'heartbeat' };
      if (p.event === 'SSE_ACK') return { type: 'heartbeat' };
      if (typeof p.v === 'string') return { type: 'text_delta', text: p.v };
      if (p.p?.includes('status') && p.v) return { type: 'status', status: String(p.v) };
      if (p.o === 'BATCH' && Array.isArray(p.v)) {
        for (const item of p.v) {
          if (item.p?.includes('status')) return { type: 'status', status: String(item.v) };
        }
      }
      return { type: 'unknown', raw: data };
    } catch { return { type: 'unknown', raw: data }; }
  }

  isFinished(data: string): boolean {
    try {
      const p = JSON.parse(data);
      if (p.p?.includes('status') && p.v === 'FINISHED') return true;
      if (p.o === 'BATCH' && Array.isArray(p.v)) {
        return p.v.some((i: any) => i.p?.includes('status') && i.v === 'FINISHED');
      }
    } catch {}
    return false;
  }
}
