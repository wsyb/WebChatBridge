import type { Adapter } from './types';

export class AdapterManager {
  private adapters: Adapter[] = [];
  private currentAdapter: Adapter | null = null;

  register(adapter: Adapter): void {
    this.adapters.push(adapter);
  }

  detect(): Adapter {
    for (const adapter of this.adapters) {
      try {
        if (adapter.detect()) {
          this.currentAdapter = adapter;
          console.log(`[WebAI] Detected AI service: ${adapter.name}`);
          return adapter;
        }
      } catch (e) {
        console.error(`[WebAI] Error detecting ${adapter.name}:`, e);
      }
    }

    throw new Error('[WebAI] No adapters registered');
  }

  getAdapter(): Adapter {
    if (!this.currentAdapter) {
      this.detect();
    }
    return this.currentAdapter!;
  }
}
