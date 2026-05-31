/**
 * Options 页面逻辑
 * 管理每个 adapter 平台的独立 prompt 配置
 */

import { getDefaultPrompt, PROMPT_TEMPLATES } from '../prompts/templates.js';

// ============================================================
// Storage key
// ============================================================

const STORAGE_PREFIX = 'customPrompt_';

function getStorageKey(adapterName: string): string {
  return `${STORAGE_PREFIX}${adapterName}`;
}

// ============================================================
// DOM
// ============================================================

const tabsEl = document.getElementById('platform-tabs')!;
const editorEl = document.getElementById('prompt-editor') as HTMLTextAreaElement;
const labelEl = document.getElementById('current-adapter-label')!;
const saveBtn = document.getElementById('save-btn')!;
const resetBtn = document.getElementById('reset-btn')!;
const statusMsg = document.getElementById('status-msg')!;

// ============================================================
// 状态
// ============================================================

let currentAdapter: string = PROMPT_TEMPLATES[0].name;

// ============================================================
// 初始化
// ============================================================

function init(): void {
  renderTabs();
  switchAdapter(PROMPT_TEMPLATES[0].name);
  bindEvents();
}

function renderTabs(): void {
  tabsEl.innerHTML = PROMPT_TEMPLATES.map((t) => {
    const active = t.name === currentAdapter ? ' active' : '';
    return `<div class="platform-tab${active}" data-adapter="${t.name}">${t.label}</div>`;
  }).join('');
}

function bindEvents(): void {
  // 平台切换
  tabsEl.addEventListener('click', (e) => {
    const target = e.target as HTMLElement;
    const tab = target.closest('.platform-tab') as HTMLElement;
    if (!tab) return;
    switchAdapter(tab.dataset.adapter!);
  });

  // 保存
  saveBtn.addEventListener('click', () => save());

  // 重置
  resetBtn.addEventListener('click', () => reset());
}

// ============================================================
// 切换平台
// ============================================================

async function switchAdapter(name: string): Promise<void> {
  currentAdapter = name;

  // 更新 tab 样式
  tabsEl.querySelectorAll('.platform-tab').forEach((tab) => {
    tab.classList.toggle('active', (tab as HTMLElement).dataset.adapter === name);
  });

  // 更新标签
  const template = PROMPT_TEMPLATES.find((t) => t.name === name);
  labelEl.textContent = template?.label ?? name;

  // 加载 prompt
  const prompt = await loadPrompt(name);
  editorEl.value = prompt;

  hideStatus();
}

// ============================================================
// 加载 / 保存 / 重置
// ============================================================

async function loadPrompt(adapterName: string): Promise<string> {
  try {
    const data = await chrome.storage.local.get(getStorageKey(adapterName));
    if (data[getStorageKey(adapterName)]) {
      return data[getStorageKey(adapterName)];
    }
  } catch {
    // ignore
  }
  return getDefaultPrompt(adapterName);
}

async function save(): Promise<void> {
  const prompt = editorEl.value.trim();
  if (!prompt) {
    showStatus('提示词不能为空', 'error');
    return;
  }

  try {
    await chrome.storage.local.set({ [getStorageKey(currentAdapter)]: prompt });
    showStatus('已保存', 'success');
  } catch (e) {
    showStatus('保存失败: ' + String(e), 'error');
  }
}

async function reset(): Promise<void> {
  const defaultPrompt = getDefaultPrompt(currentAdapter);

  try {
    await chrome.storage.local.remove(getStorageKey(currentAdapter));
    editorEl.value = defaultPrompt;
    showStatus('已重置为默认', 'success');
  } catch (e) {
    showStatus('重置失败: ' + String(e), 'error');
  }
}

// ============================================================
// 状态提示
// ============================================================

function showStatus(msg: string, type: 'success' | 'error'): void {
  statusMsg.textContent = msg;
  statusMsg.className = `status-msg show ${type}`;
  setTimeout(() => hideStatus(), 2500);
}

function hideStatus(): void {
  statusMsg.className = 'status-msg';
}

// ============================================================
// 启动
// ============================================================

init();
