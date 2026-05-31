/**
 * Options 页面逻辑
 * 连接设置 + 提示词编辑
 */

import { globalConfig } from '../core/config.js';

interface PromptTemplate {
  name: string;
  label: string;
  defaultPrompt: string;
}

// Prompt templates will be loaded dynamically
const PROMPT_TEMPLATES: PromptTemplate[] = [];

let currentPlatformIndex = 0;
let customPrompts: Record<string, string> = {};

// ============================================================
// 初始化
// ============================================================

document.addEventListener('DOMContentLoaded', async () => {
  await globalConfig.initialize();
  loadConnectionSettings();
  await loadPromptTemplates();
  renderPlatformTabs();
  loadCustomPrompts();
  bindEvents();
});

// ============================================================
// 连接设置
// ============================================================

function loadConnectionSettings(): void {
  const hostInput = document.getElementById('native-host') as HTMLInputElement;
  const portInput = document.getElementById('native-port') as HTMLInputElement;

  if (hostInput) hostInput.value = globalConfig.get('nativeHost');
  if (portInput) portInput.value = String(globalConfig.get('nativeHostPort'));
}

function saveConnectionSettings(): void {
  const hostInput = document.getElementById('native-host') as HTMLInputElement;
  const portInput = document.getElementById('native-port') as HTMLInputElement;

  const host = hostInput?.value.trim() || '127.0.0.1';
  const port = parseInt(portInput?.value || '18789', 10);

  if (port < 1 || port > 65535) {
    showStatus('端口范围应为 1-65535', false);
    return;
  }

  globalConfig.update({
    nativeHost: host,
    nativeHostPort: port,
  });
}

// ============================================================
// 提示词设置
// ============================================================

async function loadPromptTemplates(): Promise<void> {
  // Dynamic import to get templates
  try {
    const mod = await import('../prompts/templates.js');
    const templates = mod.PROMPT_TEMPLATES || [];
    PROMPT_TEMPLATES.length = 0;
    PROMPT_TEMPLATES.push(...templates);
  } catch {
    // Fallback: empty templates
  }
}

function renderPlatformTabs(): void {
  const container = document.getElementById('platform-tabs');
  if (!container) return;

  container.innerHTML = PROMPT_TEMPLATES.map((t, i) =>
    `<div class="platform-tab ${i === currentPlatformIndex ? 'active' : ''}" data-index="${i}">${t.label}</div>`
  ).join('');

  container.querySelectorAll('.platform-tab').forEach(tab => {
    tab.addEventListener('click', () => {
      currentPlatformIndex = parseInt(tab.getAttribute('data-index') || '0', 10);
      renderPlatformTabs();
      loadPromptForCurrentPlatform();
    });
  });

  loadPromptForCurrentPlatform();
}

function loadCustomPrompts(): void {
  // Load from individual keys (same as prompts/index.ts)
  const template = PROMPT_TEMPLATES[currentPlatformIndex];
  if (!template) return;
  
  const storageKey = `customPrompt_${template.name}`;
  chrome.storage.local.get([storageKey], (result) => {
    if (result[storageKey]) {
      customPrompts[template.name] = result[storageKey];
    }
    loadPromptForCurrentPlatform();
  });
}

function loadPromptForCurrentPlatform(): void {
  const template = PROMPT_TEMPLATES[currentPlatformIndex];
  if (!template) return;

  const editor = document.getElementById('prompt-editor') as HTMLTextAreaElement;
  const label = document.getElementById('current-adapter-label');

  if (editor) {
    editor.value = customPrompts[template.name] || template.defaultPrompt;
  }
  if (label) {
    label.textContent = template.label;
  }
}

function saveCurrentPrompt(): void {
  const template = PROMPT_TEMPLATES[currentPlatformIndex];
  if (!template) return;

  const editor = document.getElementById('prompt-editor') as HTMLTextAreaElement;
  if (!editor) return;

  // Use same storage key as prompts/index.ts
  const storageKey = `customPrompt_${template.name}`;
  chrome.storage.local.set({ [storageKey]: editor.value });
}

function resetCurrentPrompt(): void {
  const template = PROMPT_TEMPLATES[currentPlatformIndex];
  if (!template) return;

  const editor = document.getElementById('prompt-editor') as HTMLTextAreaElement;
  if (editor) {
    editor.value = template.defaultPrompt;
  }

  // Remove custom prompt from storage
  const storageKey = `customPrompt_${template.name}`;
  chrome.storage.local.remove(storageKey);
  delete customPrompts[template.name];
}

// ============================================================
// UI
// ============================================================

// ============================================================
// 测试连接
// ============================================================

async function testConnection(): Promise<void> {
  const hostInput = document.getElementById('native-host') as HTMLInputElement;
  const portInput = document.getElementById('native-port') as HTMLInputElement;
  const resultEl = document.getElementById('test-result');

  const host = hostInput?.value.trim() || '127.0.0.1';
  const port = parseInt(portInput?.value || '18789', 10);

  if (resultEl) {
    resultEl.textContent = '测试中...';
    resultEl.className = 'test-result';
  }

  try {
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), 5000);

    const response = await fetch(`http://${host}:${port}/health`, {
      signal: controller.signal,
    });
    clearTimeout(timer);

    if (response.ok) {
      if (resultEl) {
        resultEl.textContent = '✓ 连接成功';
        resultEl.className = 'test-result success';
      }
    } else {
      if (resultEl) {
        resultEl.textContent = '✗ 服务响应异常';
        resultEl.className = 'test-result error';
      }
    }
  } catch (e) {
    if (resultEl) {
      const msg = e instanceof Error && e.name === 'AbortError' ? '连接超时' : '无法连接';
      resultEl.textContent = `✗ ${msg}`;
      resultEl.className = 'test-result error';
    }
  }
}

function showStatus(msg: string, success: boolean): void {
  const el = document.getElementById('status-msg');
  if (!el) return;
  el.textContent = msg;
  el.className = `status-msg show ${success ? 'success' : 'error'}`;
  setTimeout(() => { el.className = 'status-msg'; }, 2000);
}

function bindEvents(): void {
  document.getElementById('save-btn')?.addEventListener('click', () => {
    saveConnectionSettings();
    saveCurrentPrompt();
    showStatus('已保存', true);
  });

  document.getElementById('test-conn-btn')?.addEventListener('click', () => {
    testConnection();
  });

  document.getElementById('reset-btn')?.addEventListener('click', () => {
    resetCurrentPrompt();
    showStatus('已重置为默认', true);
  });
}
