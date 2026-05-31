/**
 * 配置管理
 * 统一管理扩展配置，支持持久化
 */

import type { ExtensionConfig } from './types.js';

// ============================================================
// 默认配置
// ============================================================

const DEFAULT_CONFIG: ExtensionConfig = {
  logLevel: 1, // INFO
  toolbarEnabled: true,
  autoInject: false,
  cooldownMs: 3000,
  maxProcessedHashes: 50,
  nativeHostName: 'com.webchatbridge.host',
  nativeHost: '127.0.0.1',
  nativeHostPort: 18789,
  reconnectInterval: 2000,
  maxReconnectAttempts: 30,
};

const STORAGE_KEY = 'wcb_config';

// ============================================================
// 配置管理器
// ============================================================

export class ConfigManager {
  private config: ExtensionConfig = { ...DEFAULT_CONFIG };
  private initialized = false;

  async initialize(): Promise<void> {
    if (this.initialized) return;

    try {
      if (typeof chrome !== 'undefined' && chrome?.runtime?.id) {
        const result = await chrome.storage.local.get([STORAGE_KEY]);
        if (result[STORAGE_KEY]) {
          this.config = { ...DEFAULT_CONFIG, ...result[STORAGE_KEY] };
        }
      }
    } catch {
      // 使用默认配置
    }

    this.initialized = true;
  }

  get<K extends keyof ExtensionConfig>(key: K): ExtensionConfig[K] {
    return this.config[key];
  }

  getAll(): Readonly<ExtensionConfig> {
    return { ...this.config };
  }

  async set<K extends keyof ExtensionConfig>(
    key: K,
    value: ExtensionConfig[K],
  ): Promise<void> {
    this.config[key] = value;
    await this.save();
  }

  async update(partial: Partial<ExtensionConfig>): Promise<void> {
    this.config = { ...this.config, ...partial };
    await this.save();
  }

  private async save(): Promise<void> {
    try {
      if (typeof chrome !== 'undefined' && chrome?.runtime?.id) {
        await chrome.storage.local.set({ [STORAGE_KEY]: this.config });
      }
    } catch {
      // 忽略存储错误
    }
  }
}

// ============================================================
// 全局配置实例
// ============================================================

export const globalConfig = new ConfigManager();
