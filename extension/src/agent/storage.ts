/**
 * Agent Storage — chrome.storage.local 持久化
 * 每个对话独立存储 agent 状态
 */

import { Logger } from '../core/logger';

// ============================================================
// 类型定义
// ============================================================

export interface AgentState {
  workDir: string;
  systemPrompt: string;
  completedHashes: string[];
  lastToolCall?: {
    hash: string;
    name: string;
    status: 'completed' | 'failed';
    timestamp: number;
  };
  lastActivity: number;
}

// ============================================================
// 常量
// ============================================================

const STORAGE_PREFIX = 'agent_';
const MAX_AGE_MS = 7 * 24 * 60 * 60 * 1000; // 7 天

// ============================================================
// AgentStorage
// ============================================================

export class AgentStorage {
  private logger = new Logger('AgentStorage');

  /** 加载对话的 agent 状态 */
  async load(conversationId: string): Promise<AgentState> {
    try {
      const key = STORAGE_PREFIX + conversationId;
      const data = await chrome.storage.local.get(key);
      const state = data[key] as AgentState | undefined;

      if (!state) {
        return this.getDefaultState();
      }

      // 检查是否过期
      if (Date.now() - state.lastActivity > MAX_AGE_MS) {
        this.logger.info(`State expired for conversation: ${conversationId}`);
        return this.getDefaultState();
      }

      return state;
    } catch (error) {
      this.logger.error('Failed to load state', { error: String(error) });
      return this.getDefaultState();
    }
  }

  /** 保存对话的 agent 状态 */
  async save(conversationId: string, state: AgentState): Promise<void> {
    try {
      const key = STORAGE_PREFIX + conversationId;
      state.lastActivity = Date.now();
      await chrome.storage.local.set({ [key]: state });
    } catch (error) {
      this.logger.error('Failed to save state', { error: String(error) });
    }
  }

  /** 检查 tool_call 是否已执行 */
  async isCompleted(conversationId: string, hash: string): Promise<boolean> {
    const state = await this.load(conversationId);
    return state.completedHashes.includes(hash);
  }

  /** 标记 tool_call 为已完成 */
  async markCompleted(conversationId: string, hash: string): Promise<void> {
    const state = await this.load(conversationId);
    if (!state.completedHashes.includes(hash)) {
      state.completedHashes.push(hash);
      // 限制历史记录数量
      if (state.completedHashes.length > 1000) {
        state.completedHashes = state.completedHashes.slice(-500);
      }
    }
    await this.save(conversationId, state);
  }

  /** 更新 workDir */
  async setWorkDir(conversationId: string, workDir: string): Promise<void> {
    const state = await this.load(conversationId);
    state.workDir = workDir;
    await this.save(conversationId, state);
  }

  /** 获取 workDir */
  async getWorkDir(conversationId: string): Promise<string> {
    const state = await this.load(conversationId);
    return state.workDir;
  }

  /** 清理过期数据 */
  async cleanup(): Promise<void> {
    try {
      const all = await chrome.storage.local.get(null);
      const now = Date.now();
      const toRemove: string[] = [];

      for (const [key, value] of Object.entries(all)) {
        if (key.startsWith(STORAGE_PREFIX)) {
          const state = value as AgentState;
          if (now - state.lastActivity > MAX_AGE_MS) {
            toRemove.push(key);
          }
        }
      }

      if (toRemove.length > 0) {
        await chrome.storage.local.remove(toRemove);
        this.logger.info(`Cleaned up ${toRemove.length} expired states`);
      }
    } catch (error) {
      this.logger.error('Cleanup failed', { error: String(error) });
    }
  }

  /** 获取默认状态 */
  private getDefaultState(): AgentState {
    return {
      workDir: '',
      systemPrompt: '',
      completedHashes: [],
      lastActivity: Date.now(),
    };
  }
}
