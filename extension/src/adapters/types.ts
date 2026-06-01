/**
 * 平台适配器接口（精简版）
 *
 * 只保留 DOM 输入操作：文本注入、发送按钮点击、输入框锁定。
 * 状态检测和消息读取由 RequestInterceptor 负责。
 */

export interface Adapter {
  name: string;
  detect(): boolean;
  getConversationId(): string;
  findInput(): HTMLElement | null;
  injectTextSafely(text: string): boolean;
  clickSend(): Promise<boolean>;
  lockInput(): void;
  unlockInput(): void;
}
