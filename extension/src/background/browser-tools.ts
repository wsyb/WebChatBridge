/**
 * 浏览器工具处理器（运行在 background service worker 中）
 * 接收 content script 的消息，执行 Chrome API，返回结果
 */

import { getActiveTab } from '../browser/tab-utils.js';

interface ToolRequest {
  name: string;
  arguments: Record<string, unknown>;
}

export async function handleBrowserTool(request: ToolRequest): Promise<{ success: boolean; content?: string; error?: string }> {
  try {
    switch (request.name) {
      case 'browser_list_tabs': {
        const tabs = await chrome.tabs.query({});
        const tabList = tabs.map((tab) => ({
          id: tab.id,
          url: tab.url,
          title: tab.title,
          active: tab.active,
          windowId: tab.windowId,
          index: tab.index,
        }));
        return { success: true, content: JSON.stringify({ tabs: tabList, count: tabList.length }, null, 2) };
      }

      case 'browser_create_tab': {
        const { url, active = true } = request.arguments as { url: string; active?: boolean };
        let finalUrl = url?.trim();
        if (!finalUrl) return { success: false, error: 'URL is required' };
        if (!/^https?:\/\//i.test(finalUrl) && !/^chrome:|^chrome-extension:/i.test(finalUrl)) {
          finalUrl = `https://${finalUrl}`;
        }
        const tab = await chrome.tabs.create({ url: finalUrl, active });
        if (!tab.id) return { success: false, error: 'Failed to create tab' };
        return { success: true, content: JSON.stringify({ tabId: tab.id, url: tab.url, title: tab.title }) };
      }

      case 'browser_close_tab': {
        const { tabId: rawTabId } = request.arguments as { tabId?: unknown };
        const tabId = rawTabId != null && !isNaN(Number(rawTabId)) ? Number(rawTabId) : undefined;
        if (tabId != null) {
          await chrome.tabs.remove(tabId);
          return { success: true, content: JSON.stringify({ closed: true, tabId }) };
        }
        const tab = await getActiveTab();
        await chrome.tabs.remove(tab.id!);
        return { success: true, content: JSON.stringify({ closed: true, tabId: tab.id }) };
      }

      case 'browser_switch_tab': {
        const { tabId: rawTabId, urlPattern } = request.arguments as { tabId?: unknown; urlPattern?: string };
        const tabId = rawTabId != null && !isNaN(Number(rawTabId)) ? Number(rawTabId) : undefined;
        if (tabId != null) {
          const tab = await chrome.tabs.get(tabId);
          if (!tab.id) return { success: false, error: 'Tab not found' };
          await chrome.tabs.update(tabId, { active: true });
          return { success: true, content: JSON.stringify({ tab: { id: tab.id, url: tab.url, title: tab.title } }) };
        }
        if (urlPattern) {
          const tabs = await chrome.tabs.query({ currentWindow: true });
          const matchingTab = tabs.find((tab) => tab.url?.includes(urlPattern));
          if (!matchingTab?.id) return { success: false, error: `No tab found matching pattern: ${urlPattern}` };
          await chrome.tabs.update(matchingTab.id, { active: true });
          return { success: true, content: JSON.stringify({ tab: { id: matchingTab.id, url: matchingTab.url, title: matchingTab.title } }) };
        }
        return { success: false, error: 'Either tabId or urlPattern must be provided' };
      }

      case 'browser_navigate': {
        const { url, action = 'goto', tabId: rawTabId } = request.arguments as { url?: string; action?: string; tabId?: unknown };
        const tabId = rawTabId != null && !isNaN(Number(rawTabId)) ? Number(rawTabId) : undefined;
        const getTab = async () => {
          if (tabId != null) {
            const tab = await chrome.tabs.get(tabId);
            if (!tab.id) throw new Error('Tab not found');
            return tab;
          }
          return getActiveTab();
        };
        switch (action) {
          case 'back': {
            const tab = await getTab();
            await chrome.tabs.goBack(tab.id!);
            return { success: true, content: JSON.stringify({ action: 'back', tabId: tab.id }) };
          }
          case 'forward': {
            const tab = await getTab();
            await chrome.tabs.goForward(tab.id!);
            return { success: true, content: JSON.stringify({ action: 'forward', tabId: tab.id }) };
          }
          case 'reload': {
            const tab = await getTab();
            await chrome.tabs.reload(tab.id!);
            return { success: true, content: JSON.stringify({ action: 'reload', tabId: tab.id }) };
          }
          case 'goto':
          default: {
            if (!url) return { success: false, error: 'URL is required for goto action' };
            let finalUrl = url.trim();
            if (!/^https?:\/\//i.test(finalUrl) && !/^chrome:|^chrome-extension:/i.test(finalUrl)) {
              finalUrl = `https://${finalUrl}`;
            }
            const tab = await getTab();
            await chrome.tabs.update(tab.id!, { url: finalUrl });
            return { success: true, content: JSON.stringify({ action: 'goto', url: finalUrl, tabId: tab.id }) };
          }
        }
      }


      case 'browser_screenshot': {
        // Request activeTab permission if not already granted
        try {
          const hasPermission = await chrome.permissions.contains({ permissions: ['activeTab'] });
          if (!hasPermission) {
            const granted = await chrome.permissions.request({ permissions: ['activeTab'] });
            if (!granted) return { success: false, error: 'Screenshot permission denied by user' };
          }
        } catch { /* permissions API may not be available */ }
        const tab = await getActiveTab();
        if (!tab.id || !tab.windowId) return { success: false, error: 'No active tab found' };
        if (tab.url && (tab.url.startsWith('chrome://') || tab.url.startsWith('chrome-extension://'))) {
          return { success: false, error: 'Cannot capture browser internal pages' };
        }
        if (tab.status === 'loading') {
          await new Promise((r) => setTimeout(r, 1000));
        }
        await chrome.windows.update(tab.windowId, { focused: true });
        await new Promise((r) => setTimeout(r, 100));
        const dataUrl = await chrome.tabs.captureVisibleTab(tab.windowId, { format: 'png', quality: 90 });
        if (!dataUrl || !dataUrl.startsWith('data:image/')) {
          return { success: false, error: 'Invalid image data captured' };
        }
        return {
          success: true,
          content: JSON.stringify({
            tabId: tab.id,
            url: tab.url,
            title: tab.title,
            imageData: dataUrl,
          }),
        };
      }

      case 'browser_get_page_content': {
        const { tabId: rawTabId2 } = request.arguments as { tabId?: unknown };
        const tabId2 = rawTabId2 != null ? Number(rawTabId2) : undefined;
        const getTab2 = async () => {
          if (tabId2 != null) { const t = await chrome.tabs.get(tabId2); if (!t.id) throw new Error('Tab not found'); return t; }
          return getActiveTab();
        };
        const tab2 = await getTab2();
        if (!tab2.id) return { success: false, error: 'No tab found' };
        const { maxLength = 5000 } = request.arguments as { maxLength?: number };
        const results = await chrome.scripting.executeScript({
          target: { tabId: tab2.id },
          func: (max: number) => {
            const title = document.title || '';
            const url = location.href;
            const body = document.body?.innerText || document.documentElement?.innerText || '';
            const truncated = body.length > max ? body.substring(0, max) + '... (truncated)' : body;
            return { title, url, content: truncated, fullLength: body.length };
          },
          args: [maxLength],
        });
        const data = results[0]?.result;
        return { success: true, content: JSON.stringify(data, null, 2) };
      }

      case 'browser_evaluate_js': {
        const { tabId: rawTabId3 } = request.arguments as { tabId?: unknown };
        const tabId3 = rawTabId3 != null ? Number(rawTabId3) : undefined;
        const getTab3 = async () => {
          if (tabId3 != null) { const t = await chrome.tabs.get(tabId3); if (!t.id) throw new Error('Tab not found'); return t; }
          return getActiveTab();
        };
        const tab3 = await getTab3();
        if (!tab3.id) return { success: false, error: 'No tab found' };
        const { code } = request.arguments as { code: string };
        if (!code) return { success: false, error: 'Code is required' };
        const jsResults = await chrome.scripting.executeScript({
          target: { tabId: tab3.id },
          func: (scriptCode: string) => {
            try {
              const result = eval(scriptCode);
              return { success: true, result: String(result) };
            } catch (e) {
              return { success: false, error: String(e) };
            }
          },
          args: [code],
        });
        const jsData = jsResults[0]?.result;
        return {
          success: jsData?.success ?? false,
          content: jsData?.result,
          error: jsData?.error,
        };
      }

      case 'browser_search_elements': {
        const { tabId: rawTabId4 } = request.arguments as { tabId?: unknown };
        const tabId4 = rawTabId4 != null && !isNaN(Number(rawTabId4)) ? Number(rawTabId4) : undefined;
        const getTab4 = async () => {
          if (tabId4 != null) { const t = await chrome.tabs.get(tabId4); if (!t.id) throw new Error('Tab not found'); return t; }
          return getActiveTab();
        };
        const tab4 = await getTab4();
        if (!tab4.id) return { success: false, error: 'No tab found' };
        const { query, contextLevels = 1 } = request.arguments as { query: string; contextLevels?: number };
        if (!query) return { success: false, error: 'Query is required' };

        // Step 1: Create snapshot in page
        const snapshotResults = await chrome.scripting.executeScript({
          target: { tabId: tab4.id },
          func: () => {
            const NODE_ID_ATTR = 'data-wcb-nodeid';
            const SKIP_TAGS = new Set(['script', 'style', 'noscript', 'template', 'svg', 'head', 'meta', 'link']);
            const INTERACTIVE_TAGS = new Set(['a', 'button', 'summary', 'details', 'select', 'textarea', 'input', 'label']);
            const INPUT_TYPES_AS_ROLE: Record<string, string> = { button: 'button', submit: 'button', reset: 'button', image: 'button', checkbox: 'checkbox', radio: 'radio', range: 'slider', email: 'textbox', search: 'searchbox', url: 'textbox', number: 'spinbutton', password: 'textbox', text: 'textbox' };
            let nodeIdCounter = 0;

            function collectNode(el: Element): any {
              if (SKIP_TAGS.has(el.tagName?.toLowerCase())) return null;
              const id = 'n' + (nodeIdCounter++);
              el.setAttribute(NODE_ID_ATTR, id);
              const tagName = el.tagName?.toLowerCase() || '';
              let role = '';
              if (el instanceof HTMLButtonElement || (tagName === 'input' && ['button','submit','reset','image'].includes((el as HTMLInputElement).type))) role = 'button';
              else if (el instanceof HTMLAnchorElement) role = 'link';
              else if (el instanceof HTMLInputElement) role = INPUT_TYPES_AS_ROLE[(el as HTMLInputElement).type] || 'textbox';
              else if (el instanceof HTMLTextAreaElement) role = 'textbox';
              else if (el instanceof HTMLSelectElement) role = 'combobox';
              else if (el instanceof HTMLLabelElement) role = 'StaticText';
              else if (tagName === 'div' || tagName === 'span' || tagName === 'p') role = 'StaticText';
              else role = 'generic';
              const name = el.getAttribute('aria-label') || el.getAttribute('title') || (el as HTMLInputElement).placeholder || el.textContent?.trim()?.substring(0, 80) || '';
              const children: any[] = [];
              for (const child of el.children) {
                const childNode = collectNode(child);
                if (childNode) children.push(childNode);
              }
              return { id, role, name: name.substring(0, 160), tagName, children, disabled: (el as HTMLInputElement).disabled || false, focused: document.activeElement === el };
            }

            const body = document.body || document.documentElement;
            const rootChildren: any[] = [];
            for (const child of body.children) {
              const childNode = collectNode(child);
              if (childNode) rootChildren.push(childNode);
            }
            return { root: { id: 'root', role: 'RootWebArea', name: document.title, children: rootChildren }, totalNodes: nodeIdCounter, timestamp: Date.now() };
          },
        });

        const snapshot = snapshotResults[0]?.result;
        if (!snapshot) return { success: false, error: 'Failed to create snapshot' };
        console.log('[WCB] Snapshot created, totalNodes:', snapshot.totalNodes, 'root children:', snapshot.root?.children?.length);

        // Step 2: Format and search
        function formatNode(node: any, depth: number): string {
          if (!node) return '';
          const skip = ['generic', 'none', 'group', 'main', 'navigation'];
          if (skip.includes(node.role) && node.role !== 'RootWebArea') {
            let result = '';
            for (const child of node.children || []) result += formatNode(child, depth);
            return result;
          }
          const attrs = [`uid=${node.id}`, node.role, `"${node.name || ''}"`];
          if (node.tagName) attrs.push(`<${node.tagName}>`);
          if (node.disabled) attrs.push('disabled');
          let result = ' '.repeat(depth) + attrs.join(' ') + '\n';
          for (const child of node.children || []) result += formatNode(child, depth + 1);
          return result;
        }

        const snapshotText = formatNode(snapshot.root, 0);
        const lines = snapshotText.split('\n');
        console.log('[WCB] Snapshot text lines:', lines.length, 'first 5:', lines.slice(0, 5));

        // 支持 glob 通配符：* 匹配任意字符，? 匹配单个字符
        function globMatch(pattern: string, text: string): boolean {
          const p = pattern.toLowerCase();
          const t = text.toLowerCase();
          // 转为正则：* -> .*, ? -> .
          const regex = new RegExp('^' + p.replace(/[.+^${}()|[\]\\]/g, '\\$&').replace(/\*/g, '.*').replace(/\?/g, '.') + '$');
          return regex.test(t);
        }

        const matchedLines: number[] = [];
        for (let i = 0; i < lines.length; i++) {
          if (lines[i] && globMatch(query, lines[i])) matchedLines.push(i);
        }

        if (matchedLines.length === 0) return { success: true, content: `No matches found for: ${query}` };

        // Expand context
        const contextSet = new Set<number>();
        for (const idx of matchedLines) {
          contextSet.add(idx);
          for (let j = 1; j <= contextLevels; j++) {
            if (idx - j >= 0) contextSet.add(idx - j);
            if (idx + j < lines.length) contextSet.add(idx + j);
          }
        }
        const sorted = Array.from(contextSet).sort((a, b) => a - b);
        const result = sorted.map(i => lines[i] || '').join('\n');
        return { success: true, content: result };
      }

      case 'browser_click': {
        const { tabId: rawTabId5, uid } = request.arguments as { tabId?: unknown; uid?: string };
        const tabId5 = rawTabId5 != null && !isNaN(Number(rawTabId5)) ? Number(rawTabId5) : undefined;
        const getTab5 = async () => {
          if (tabId5 != null) { const t = await chrome.tabs.get(tabId5); if (!t.id) throw new Error('Tab not found'); return t; }
          return getActiveTab();
        };
        const tab5 = await getTab5();
        if (!tab5.id) return { success: false, error: 'No tab found' };
        if (!uid) return { success: false, error: 'UID is required' };

        const clickResults = await chrome.scripting.executeScript({
          target: { tabId: tab5.id },
          func: (elementUid: string) => {
            const el = document.querySelector(`[data-wcb-nodeid="${elementUid}"]`);
            if (!el) return { success: false, error: `Element with UID "${elementUid}" not found` };
            (el as HTMLElement).scrollIntoView({ behavior: 'smooth', block: 'center' });
            el.dispatchEvent(new MouseEvent('mouseover', { bubbles: true, cancelable: true }));
            el.dispatchEvent(new MouseEvent('mousedown', { bubbles: true, cancelable: true }));
            el.dispatchEvent(new MouseEvent('mouseup', { bubbles: true, cancelable: true }));
            el.dispatchEvent(new MouseEvent('click', { bubbles: true, cancelable: true }));
            return { success: true };
          },
          args: [uid],
        });
        return clickResults[0]?.result || { success: false, error: 'Click failed' };
      }

      case 'browser_fill': {
        const { tabId: rawTabId6, uid: fillUid, value } = request.arguments as { tabId?: unknown; uid?: string; value?: string };
        const tabId6 = rawTabId6 != null && !isNaN(Number(rawTabId6)) ? Number(rawTabId6) : undefined;
        const getTab6 = async () => {
          if (tabId6 != null) { const t = await chrome.tabs.get(tabId6); if (!t.id) throw new Error('Tab not found'); return t; }
          return getActiveTab();
        };
        const tab6 = await getTab6();
        if (!tab6.id) return { success: false, error: 'No tab found' };
        if (!fillUid) return { success: false, error: 'UID is required' };
        if (value === undefined) return { success: false, error: 'Value is required' };

        const fillResults = await chrome.scripting.executeScript({
          target: { tabId: tab6.id },
          func: (elementUid: string, fillValue: string) => {
            const el = document.querySelector(`[data-wcb-nodeid="${elementUid}"]`) as HTMLInputElement | HTMLTextAreaElement;
            if (!el) return { success: false, error: `Element with UID "${elementUid}" not found` };
            el.scrollIntoView({ behavior: 'smooth', block: 'center' });
            el.focus();
            el.value = fillValue;
            el.dispatchEvent(new Event('input', { bubbles: true }));
            el.dispatchEvent(new Event('change', { bubbles: true }));
            return { success: true };
          },
          args: [fillUid, value],
        });
        return fillResults[0]?.result || { success: false, error: 'Fill failed' };
      }
      default:
        return { success: false, error: `Unknown browser tool: ${request.name}` };
    }
  } catch (error) {
    const msg = error instanceof Error ? error.message : String(error);
    return { success: false, error: msg };
  }
}
