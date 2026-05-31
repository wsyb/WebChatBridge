/**
 * 平台适配器接口
 * 每个 AI 平台（DeepSeek、ChatGPT、Kimi 等）实现此接口
 * 封装所有平台特定逻辑，保持核心引擎干净
 */

import type { AIStatus, AIStateSnapshot } from '../core/types';

export interface Adapter {
  name: string;
  messageSelectors: string[];

  // === 平台检测 ===
  detect(): boolean;
  getConversationId(): string;

  // === AI 状态检测 ===
  getAIStatus(): AIStatus;
  getAIStateSnapshot(): AIStateSnapshot;
  isGenerating(): boolean;
  isIdle(): boolean;
  isReady(): boolean;
  isPaused(): boolean;

  // === 消息读取 ===
  /** 获取最后一条 AI 消息的 DOM 元素（用于解析 tool_call） */
  getLastAIMessageElement(): Element | null;
  /** 获取最后一条 AI 回复文本 */
  getLastAIMessage(): string;

  // === 输入框操作 ===
  findInput(): HTMLElement | null;
  findInputContainer(): HTMLElement | null;
  findSendButton(): HTMLButtonElement | null;
  findContinueButton(): HTMLButtonElement | null;
  findRegenerateButton(): HTMLElement | null;
  isButtonDisabled(btn: HTMLButtonElement): boolean;

  // === 文本注入 ===
  injectTextSafely(text: string): boolean;
  /** 点击发送按钮 */
  clickSend(): Promise<boolean>;

  // === 输入框锁定 ===
  /** 锁定输入框（不可编辑） */
  lockInput(): void;
  /** 解锁输入框 */
  unlockInput(): void;

  // === 停止按钮 ===
  /** 在输入区显示停止按钮 */
  /** 隐藏停止按钮 */

  // === 事件 ===
  /** 监听 AI 生成完成事件 */
  onGenerationComplete(callback: () => void): void;
  /** 移除监听 */
  offGenerationComplete(callback: () => void): void;
  /** 监听 AI 停止事件（用户中断/网络断开） */
  onAIStopped(callback: () => void): void;
  /** 移除监听 */
  offAIStopped(callback: () => void): void;

  // === UI 操作 ===
  hideInput(): HTMLElement | null;
  showInput(element: HTMLElement): void;
  showLoading(): void;
  hideLoading(): void;
}
