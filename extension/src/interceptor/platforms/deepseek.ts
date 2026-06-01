import type { PlatformPattern, StreamEvent } from '../types';

export class DeepseekPattern implements PlatformPattern {
  name = 'deepseek';

  detect(): boolean {
    return window.location.hostname.includes('chat.deepseek.com');
  }

  matchSendRequest(url: string, method: string): boolean {
    return method === 'POST' && url.includes('/api/v0/chat/completion');
  }

  extractUserMessage(body: string): string | null {
    try { return JSON.parse(body).prompt || null; } catch { return null; }
  }

  extractConversationId(body: string): string | null {
    try { return JSON.parse(body).chat_session_id || null; } catch { return null; }
  }

  parseStreamEvent(data: string): StreamEvent | null {
    if (!data || data.trim() === '[DONE]') return null;
    try {
      const p = JSON.parse(data);
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
