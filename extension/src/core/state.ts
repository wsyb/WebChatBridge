/**
 * 状态机管理
 * 使用明确的状态转换规则，防止非法状态
 */

import type { ExtensionState, StateSnapshot } from './types.js';
import { Logger } from './logger.js';

// ============================================================
// 常量
// ============================================================

const VALID_STATES: ExtensionState[] = [
  'idle',
  'detecting',
  'executing',
  'injecting',
  'waiting',
  'paused',
];

// 合法的状态转换表
const VALID_TRANSITIONS: Record<ExtensionState, ExtensionState[]> = {
  idle: ['detecting', 'executing'],
  detecting: ['idle', 'executing'],
  executing: ['injecting', 'idle', 'paused'],
  injecting: ['waiting', 'idle', 'paused'],
  waiting: ['idle', 'paused'],
  paused: ['idle'],
};

const DEFAULT_COOLDOWN_MS = 3000;

// ============================================================
// 状态管理器
// ============================================================

export class StateManager {
  private logger = new Logger('State');

  private current: ExtensionState = 'idle';
  private connected = false;
  private conversationId = '';
  private lastExecutionTime = 0;
  private currentRound = 0;

  private cooldownMs: number;

  constructor(
    cooldownMs = DEFAULT_COOLDOWN_MS,
    _maxHashes?: number,
  ) {
    this.cooldownMs = cooldownMs;
  }

  // ============================================================
  // 状态查询
  // ============================================================

  getState(): ExtensionState {
    return this.current;
  }

  getSnapshot(): StateSnapshot {
    return {
      current: this.current,
      connected: this.connected,
      conversationId: this.conversationId,

      currentRound: this.currentRound,
    };
  }

  isConnected(): boolean {
    return this.connected;
  }

  getConversationId(): string {
    return this.conversationId;
  }

  getCurrentRound(): number {
    return this.currentRound;
  }

  // ============================================================
  // 状态转换
  // ============================================================

  canDetect(): boolean {
    return this.current === 'idle' || this.current === 'detecting';
  }

  canExecute(): boolean {
    return this.current === 'idle' && !this.isCoolingDown();
  }

  isCoolingDown(): boolean {
    return Date.now() - this.lastExecutionTime < this.cooldownMs;
  }

  transition(to: ExtensionState): boolean {
    if (!VALID_STATES.includes(to)) {
      this.logger.error(`Invalid target state: ${to}`);
      return false;
    }

    const from = this.current;
    const allowed = VALID_TRANSITIONS[from];

    if (!allowed || !allowed.includes(to)) {
      this.logger.warn(`Invalid state transition: ${from} -> ${to}`, { allowed });
      return false;
    }

    this.current = to;
    this.logger.debug(`State transition: ${from} -> ${to}`);
    return true;
  }

  // ============================================================
  // 状态修改
  // ============================================================

  setConnected(connected: boolean): void {
    this.connected = connected;
  }

  setConversationId(id: string): void {
    this.conversationId = id;
  }

  isNewConversation(id: string): boolean {
    return this.conversationId !== '' && this.conversationId !== id;
  }





  // ============================================================
  // 去重由 DedupStep 处理（内存快照机制）
  // ============================================================

  incrementRound(): number {
    this.currentRound++;
    return this.currentRound;
  }

  /**
   * 软重置：清内存状态
   */
  softReset(): void {
    this.current = 'idle';
    this.lastExecutionTime = 0;
    this.currentRound = 0;

    this.logger.info('State soft reset');
  }

  /**
   * 硬重置：清内存状态
   */
  reset(): void {
    this.softReset();
    this.logger.info('State reset');
  }
}
