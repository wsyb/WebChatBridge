/**
 * Prompt 管理模块
 * 按 adapter 平台独立管理提示词
 * 优先级：用户自定义 > adapter 默认模板
 *
 * 支持两种提示词模式：
 * - local: 本机操控能力（文件、命令、任务）
 * - browser: 浏览器操控能力（标签、导航、页面交互）
 */

import { Logger } from '../core/logger';
import { getDefaultPrompt, getDefaultBrowserPrompt, PROMPT_TEMPLATES } from './templates.js';

const logger = new Logger('Prompt');

// ============================================================
// Storage key 前缀
// ============================================================

const STORAGE_PREFIX = 'customPrompt_';
const BROWSER_STORAGE_PREFIX = 'customBrowserPrompt_';

function getStorageKey(adapterName: string): string {
  return `${STORAGE_PREFIX}${adapterName}`;
}

function getBrowserStorageKey(adapterName: string): string {
  return `${BROWSER_STORAGE_PREFIX}${adapterName}`;
}

// ============================================================
// 读取
// ============================================================

/**
 * 获取指定 adapter 的本机系统提示词
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
 * 获取指定 adapter 的浏览器系统提示词
 * 优先级：用户自定义 > adapter 默认模板
 * @param workDir 工作目录，替换 {{workDir}} 占位符
 * @param adapterName adapter 名称（如 'kimi', 'deepseek'）
 */
export async function getBrowserSystemPrompt(workDir: string, adapterName: string): Promise<string> {
  let prompt = getDefaultBrowserPrompt(adapterName);

  try {
    const data = await chrome.storage.local.get(getBrowserStorageKey(adapterName));
    if (data[getBrowserStorageKey(adapterName)]) {
      prompt = data[getBrowserStorageKey(adapterName)];
      logger.info(`Using custom browser prompt for adapter: ${adapterName}`);
    }
  } catch (e) {
    logger.warn('Failed to load custom browser prompt', { error: String(e) });
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

/**
 * 获取指定 adapter 的自定义浏览器提示词（未自定义时返回空字符串）
 */
export async function getCustomBrowserPrompt(adapterName: string): Promise<string> {
  try {
    const data = await chrome.storage.local.get(getBrowserStorageKey(adapterName));
    return data[getBrowserStorageKey(adapterName)] || '';
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
 * 保存指定 adapter 的自定义浏览器提示词
 */
export async function saveCustomBrowserPrompt(adapterName: string, prompt: string): Promise<void> {
  try {
    await chrome.storage.local.set({ [getBrowserStorageKey(adapterName)]: prompt });
    logger.info(`Custom browser prompt saved for adapter: ${adapterName}`);
  } catch (e) {
    logger.error('Failed to save custom browser prompt', { error: String(e) });
  }
}

/**
 * 重置指定的提示词为默认
 */
export async function resetPrompt(adapterName: string): Promise<void> {
  try {
    await chrome.storage.local.remove(getStorageKey(adapterName));
    logger.info(`Prompt reset to default for adapter: ${adapterName}`);
  } catch (e) {
    logger.error('Failed to reset prompt', { error: String(e) });
  }
}

/**
 * 重置指定的浏览器提示词为默认
 */
export async function resetBrowserPrompt(adapterName: string): Promise<void> {
  try {
    await chrome.storage.local.remove(getBrowserStorageKey(adapterName));
    logger.info(`Browser prompt reset to default for adapter: ${adapterName}`);
  } catch (e) {
    logger.error('Failed to reset browser prompt', { error: String(e) });
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
