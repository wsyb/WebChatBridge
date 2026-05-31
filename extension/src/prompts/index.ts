/**
 * Prompt 管理模块
 * 按 adapter 平台独立管理提示词
 * 优先级：用户自定义 > adapter 默认模板
 */

import { Logger } from '../core/logger';
import { getDefaultPrompt, PROMPT_TEMPLATES } from './templates.js';

const logger = new Logger('Prompt');

// ============================================================
// Storage key 前缀
// ============================================================

const STORAGE_PREFIX = 'customPrompt_';

function getStorageKey(adapterName: string): string {
  return `${STORAGE_PREFIX}${adapterName}`;
}

// ============================================================
// 读取
// ============================================================

/**
 * 获取指定 adapter 的系统提示词
 * 优先级：用户自定义 > adapter 默认模板
 * @param workDir 工作目录，替换 {{workDir}} 占位符
 * @param adapterName adapter 名称（如 'kimi', 'deepseek'）
 */
export async function getSystemPrompt(workDir: string, adapterName: string): Promise<string> {
  let prompt = getDefaultPrompt(adapterName);

  try {
    const data = await chrome.storage.local.get(getStorageKey(adapterName));
    if (data[getStorageKey(adapterName)]) {
      prompt = data[getStorageKey(adapterName)];
      logger.info(`Using custom prompt for adapter: ${adapterName}`);
    }
  } catch (e) {
    logger.warn('Failed to load custom prompt', { error: String(e) });
  }

  return prompt.replace(/\{\{workDir\}\}/g, workDir);
}

/**
 * 获取指定 adapter 的自定义提示词（未自定义时返回空字符串）
 */
export async function getCustomPrompt(adapterName: string): Promise<string> {
  try {
    const data = await chrome.storage.local.get(getStorageKey(adapterName));
    return data[getStorageKey(adapterName)] || '';
  } catch {
    return '';
  }
}

// ============================================================
// 保存 / 重置
// ============================================================

/**
 * 保存指定 adapter 的自定义提示词
 */
export async function saveCustomPrompt(adapterName: string, prompt: string): Promise<void> {
  try {
    await chrome.storage.local.set({ [getStorageKey(adapterName)]: prompt });
    logger.info(`Custom prompt saved for adapter: ${adapterName}`);
  } catch (e) {
    logger.error('Failed to save custom prompt', { error: String(e) });
  }
}

/**
 * 重置指定 adapter 的提示词为默认
 */
export async function resetPrompt(adapterName: string): Promise<void> {
  try {
    await chrome.storage.local.remove(getStorageKey(adapterName));
    logger.info(`Prompt reset to default for adapter: ${adapterName}`);
  } catch (e) {
    logger.error('Failed to reset prompt', { error: String(e) });
  }
}

// ============================================================
// 兼容旧接口（popup / toolbar 可能还在用）
// ============================================================

/**
 * @deprecated 使用 getSystemPrompt(workDir, adapterName) 替代
 */
export async function getCurrentPrompt(adapterName: string): Promise<string> {
  const custom = await getCustomPrompt(adapterName);
  return custom || getDefaultPrompt(adapterName);
}

/**
 * 获取所有已配置的 adapter 列表
 */
export function getSupportedAdapters(): { name: string; label: string }[] {
  return PROMPT_TEMPLATES.map((t) => ({ name: t.name, label: t.label }));
}
