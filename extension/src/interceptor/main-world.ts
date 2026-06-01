/**
 * MAIN World 拦截器

 * 日志路径: 通过 postMessage → ISOLATED world → /tmp/webchatbridge-debug.log
 *
 * 运行在页面的 JS 上下文中（与页面代码共享 window），
 * 可以 hook window.fetch 和 XMLHttpRequest.prototype。
 *
 * 检测到聊天请求/响应后，通过 window.postMessage 通知 ISOLATED world。
 */

(function () {
  'use strict';

  // 防止重复注入
  if ((window as any).__wcbMainWorldHooked) return;
  (window as any).__wcbMainWorldHooked = true;

  // ============================================================
  // 平台检测
  // ============================================================

  function detectPlatform(): string | null {
    const h = window.location.hostname;
    if (h.includes('chat.deepseek.com')) return 'deepseek';
    if (h.includes('kimi.moonshot.cn') || h.includes('www.kimi.com')) return 'kimi';
    if (h.includes('www.doubao.com')) return 'doubao';
    return null;
  }

  function matchSendRequest(url: string, method: string): boolean {
    const platform = detectPlatform();
    if (!platform) return false;

    if (method !== 'POST') return false;

    logToHost('debug', 'matchSendRequest: ' + platform + ' ' + url.substring(0, 100));
    switch (platform) {
      case 'deepseek':
        return url.includes('/api/v0/chat/completion');
      case 'kimi':
        return url.includes('ChatService/Chat');
      case 'doubao':
        return url.includes('/chat/completion');
      default:
        return false;
    }
  }

  function extractUserMessage(body: string): string | null {
    const platform = detectPlatform();
    if (!platform) return null;
    try {
      const parsed = JSON.parse(body);
      switch (platform) {
        case 'deepseek':
          return parsed.prompt || null;
        case 'kimi': {
          const blocks = parsed.message?.blocks;
          return blocks?.[0]?.text?.content || null;
        }
        case 'doubao': {
          const blocks = parsed.messages?.[0]?.content_block;
          return blocks?.[0]?.content?.text_block?.text || null;
        }
      }
    } catch { /* ignore */ }
    return null;
  }

  function extractConversationId(body: string): string | null {
    const platform = detectPlatform();
    if (!platform) return null;
    try {
      const parsed = JSON.parse(body);
      switch (platform) {
        case 'deepseek':
          return parsed.chat_session_id || null;
        case 'kimi':
          return parsed.chat_id || null;
        case 'doubao':
          return parsed.client_meta?.conversation_id || null;
      }
    } catch { /* ignore */ }
    return null;
  }

  // ============================================================
  // 事件发送
  // ============================================================

  function postEvent(type: string, data: Record<string, unknown>): void {
    window.postMessage({ __wcbInterceptor: true, type, ...data }, '*');
  }

  // MAIN world 日志 → postMessage → ISOLATED world → 写入文件
  function logToHost(level: string, msg: string, data?: unknown): void {
    window.postMessage({
      __wcbInterceptor: true,
      type: 'main_world_log',
      level,
      msg,
      data: data !== undefined ? JSON.stringify(data).substring(0, 500) : undefined,
    }, '*');
  }

  // ============================================================
  // 流式数据处理
  // ============================================================

  let _accumulatedText = '';

  // ============================================================
  // API 直发支持 — 保存真实请求的完整信息（URL + init 对象）
  // ============================================================

  let _savedFetchInit: RequestInit | null = null;
  let _savedApiUrl = '';
  let _requestCaptured = false;

  function saveFetchInit(url: string, init: RequestInit): void {
    if (_requestCaptured) return;
    _savedApiUrl = url;
    // 深拷贝 init（包括 headers、credentials 等）
    _savedFetchInit = {
      method: init.method,
      headers: init.headers instanceof Headers
        ? new Headers(init.headers)
        : init.headers ? { ...init.headers } as Record<string, string> : undefined,
      body: init.body,
      credentials: init.credentials,
      mode: init.mode,
      cache: init.cache,
    };
    _requestCaptured = true;
    logToHost('info', 'Saved fetch init for ' + url.substring(0, 100));
  }

  function isFinished(data: string): boolean {
    const platform = detectPlatform();
    if (!platform) return false;
    try {
      const p = JSON.parse(data);
      // DeepSeek 格式
      if (p.p?.includes('status') && (p.v === 'FINISHED' || p.v === 'COMPLETED')) return true;
      if (p.o === 'BATCH' && Array.isArray(p.v)) {
        return p.v.some((i: any) => i.p?.includes('status') && (i.v === 'FINISHED' || i.v === 'COMPLETED'));
      }
      // 豆包格式: end_type: 1
      if (p.end_type === 1) return true;
    } catch { /* ignore */ }
    return false;
  }

  function processStreamData(data: string): void {
    // 先提取文本（防止 BATCH 事件中 FINISHED 和文本在同一包）
    try {
      const p = JSON.parse(data);

      // 提取文本：DeepSeek 用 p.v，豆包用 p.text
      const text = (typeof p.v === 'string' && p.v.length > 0) ? p.v
                 : (typeof p.text === 'string' && p.text.length > 0) ? p.text
                 : null;

      if (text) {
        _accumulatedText += text;
        postEvent('text_delta', { delta: text, accumulated: _accumulatedText });

        if (_accumulatedText.includes('tool_call') &&
            _accumulatedText.includes('===')) {
          postEvent('tool_call_detected', { text: _accumulatedText });
        }
      }

      // BATCH 事件：递归处理子事件
      if (p.o === 'BATCH' && Array.isArray(p.v)) {
        for (const item of p.v) {
          processStreamData(JSON.stringify(item));
        }
      }
    } catch { /* ignore non-JSON */ }

    // 文本提取完毕后再检查 FINISHED
    if (isFinished(data)) {
      logToHost('info', 'FINISHED detected, posting generation_complete');
      logToHost('debug', 'Accumulated text length: ' + _accumulatedText.length);
      postEvent('generation_complete', { text: _accumulatedText });
      _accumulatedText = '';
    }
  }

  // ============================================================
  // fetch 拦截
  // ============================================================

  const origFetch = window.fetch;
  window.fetch = async function (input, init) {
    const url = typeof input === 'string' ? input : (input instanceof URL ? input.href : input?.url || '');
    const method = init?.method || 'GET';
    const body = init?.body ? String(init.body) : null;
    const isOurs = !!(init?.headers as any)?.['X-WCB-Tool-Result'];

    if (matchSendRequest(url, method) && body) {
      // 保存完整的 fetch init（headers、credentials 等全部保留）
      if (!isOurs && init) {
        saveFetchInit(url, init);
      }

      // 只有非我们的请求才触发 send_detected
      if (!isOurs) {
        const msg = extractUserMessage(body);
        const convId = extractConversationId(body);
        if (msg) {
          _accumulatedText = '';
              postEvent('send_detected', { message: msg, conversationId: convId });
        }
      }
    }

    const resp = await origFetch.call(window, input, init);

    if (matchSendRequest(url, method)) {
      const ct = resp.headers.get('content-type') || '';
      if (ct.includes('event-stream') || ct.includes('connect+json') || ct.includes('octet-stream')) {
        readStream(resp.clone());
      }
    }

    return resp;
  };

  async function readStream(resp: Response): Promise<void> {
    const reader = resp.body?.getReader();
    if (!reader) return;
    const decoder = new TextDecoder();
    let buffer = '';
    try {
      while (true) {
        const { done, value } = await reader.read();
        if (value) {
          buffer += decoder.decode(value, { stream: true });
        }
        if (done) {
          // Process remaining buffer on stream end
          if (buffer.trim()) {
            const remaining = buffer.split('\n');
            for (const line of remaining) {
              if (line.startsWith('data: ')) {
                processStreamData(line.slice(6));
              }
            }
          }
          break;
        }
        const lines = buffer.split('\n');
        buffer = lines.pop() || '';
        for (const line of lines) {
          if (line.startsWith('data: ')) {
            processStreamData(line.slice(6));
          }
        }
      }
    } catch (e) {
      logToHost('error', 'Stream error: ' + String(e));
    }
  }

  // ============================================================
  // XHR 拦截
  // ============================================================

  const origOpen = XMLHttpRequest.prototype.open;
  const origSend = XMLHttpRequest.prototype.send;
  const xhrResponseTexts = new Map<XMLHttpRequest, string>();

  XMLHttpRequest.prototype.open = function (method: string, url: string | URL, async?: boolean, username?: string | null, password?: string | null) {
    (this as any).__wcbUrl = typeof url === 'string' ? url : (url as URL).href;
    (this as any).__wcbMethod = method;
    return origOpen.call(this, method, url, async ?? true, username, password);
  };

  XMLHttpRequest.prototype.send = function (body) {
    const url = (this as any).__wcbUrl || '';
    const method = (this as any).__wcbMethod || '';
    const bodyStr = body ? String(body) : null;

    if (matchSendRequest(url, method) && bodyStr) {
      const isOurs = !!(this as any).__wcbOurs;

      // XHR 不使用 origFetch，保存 URL 和 body 供 fallback
      if (!_requestCaptured) {
        _savedApiUrl = url;
        _savedFetchInit = { method: 'POST', body: bodyStr };
        _requestCaptured = true;
        console.log('[WCB MainWorld] Saved XHR request info for', url);
      }

      if (!isOurs) {
        const msg = extractUserMessage(bodyStr);
        const convId = extractConversationId(bodyStr);
        if (msg) {
          _accumulatedText = '';
              postEvent('send_detected', { message: msg, conversationId: convId });
        }
      }

      xhrResponseTexts.set(this, '');
      this.addEventListener('readystatechange', function () {
        if (this.readyState === 3 || this.readyState === 4) {
          const text = this.responseText || '';
          const prev = xhrResponseTexts.get(this) || '';
          if (text === prev) return;
          xhrResponseTexts.set(this, text);

          const newPart = text.substring(prev.length);
          const lines = newPart.split('\n');
          for (const line of lines) {
            if (line.startsWith('data: ')) {
              processStreamData(line.slice(6));
            }
          }
        }
      });
    }

    return origSend.call(this, body);
  };

  // ============================================================
  // API 直发 — content script 通过 postMessage 调用
  // ============================================================

  window.addEventListener('message', (event) => {
    if (event.source !== window) return;
    const data = event.data;
    if (!data || data.__wcbType !== 'sendViaApi') return;

    const { message, conversationId, platform } = data;
    if (platform !== 'deepseek') return;

    (async () => {
      try {
        if (!_requestCaptured || !_savedFetchInit) {
          logToHost('error', 'No API request captured yet');
          postEvent('sendViaApi_result', { success: false, error: 'No API request captured' });
          return;
        }

        // 克隆保存的 body，替换 prompt 字段
        const origBody = _savedFetchInit.body ? String(_savedFetchInit.body) : '';
        let newBody: string;
        try {
          const parsed = JSON.parse(origBody);
          if ('prompt' in parsed) {
            parsed.prompt = message;
          } else if ('messages' in parsed) {
            parsed.messages = [{ role: 'user', content: message }];
          }
          if (conversationId) {
            if ('chat_session_id' in parsed) parsed.chat_session_id = conversationId;
            if ('conversation_id' in parsed) parsed.conversation_id = conversationId;
          }
          newBody = JSON.stringify(parsed);
        } catch {
          newBody = message;
        }

        // 克隆 headers 并添加标记
        let headers: HeadersInit;
        if (_savedFetchInit.headers instanceof Headers) {
          headers = new Headers(_savedFetchInit.headers);
        } else if (_savedFetchInit.headers) {
          headers = { ..._savedFetchInit.headers as Record<string, string> };
        } else {
          headers = { 'Content-Type': 'application/json' };
        }
        // 设置标记头防止拦截器循环
        if (headers instanceof Headers) {
          headers.set('X-WCB-Tool-Result', '1');
        } else {
          (headers as Record<string, string>)['X-WCB-Tool-Result'] = '1';
        }

        console.log('[WCB MainWorld] Replaying fetch with modified body');

        const resp = await origFetch.call(window, _savedApiUrl, {
          ..._savedFetchInit,
          headers,
          body: newBody,
        });

        if (!resp.ok) {
          await resp.text().catch(() => {});
          logToHost('error', 'API send failed: HTTP ' + resp.status);
          postEvent('sendViaApi_result', { success: false, error: `HTTP ${resp.status}` });
          return;
        }

        const ct = resp.headers.get('content-type') || '';
        if (ct.includes('event-stream') || ct.includes('connect+json') || ct.includes('octet-stream')) {
          readStream(resp.clone());
        }

        postEvent('sendViaApi_result', { success: true });
        logToHost('info', 'Tool result sent via API');
      } catch (e) {
        logToHost('error', 'API send error: ' + String(e));
        postEvent('sendViaApi_result', { success: false, error: String(e) });
      }
    })();
  });


  // ============================================================
  // 文件上传 — content script 通过 postMessage 调用
  // 用于长工具结果，绕过平台消息长度限制
  // ============================================================

  window.addEventListener('message', (event) => {
    if (event.source !== window) return;
    const data = event.data;
    if (!data || data.__wcbType !== 'uploadToolResult') return;

    const { content: fileContent, fileName } = data;
    const platform = detectPlatform();
    logToHost('info', 'Upload requested: ' + fileName + ' (' + fileContent.length + ' chars)');

    (async () => {
      try {
        if (platform === 'doubao') {
          // 豆包：先点击 "+" 按钮，再点击 "本地文件"
          logToHost('info', 'Doubao: looking for + button');
          const plusBtn = document.querySelector<HTMLElement>(
            'button[data-dbx-name="button"] svg path[d*="12.0005 2.44971"]'
          )?.closest<HTMLElement>('button[data-dbx-name="button"]');
          if (!plusBtn) {
            logToHost('error', 'Doubao: + button not found');
            postEvent('upload_result', { success: false, error: 'Doubao: + button not found' });
            return;
          }
          logToHost('info', 'Doubao: clicking + button');
          plusBtn.click();
          await new Promise(r => setTimeout(r, 500));

          // 查找 "本地文件" 菜单项
          logToHost('info', 'Doubao: looking for 本地文件 menu item');
          const menuItems = document.querySelectorAll<HTMLElement>('[role="menuitem"], [data-radix-collection-item]');
          logToHost('info', 'Doubao: found ' + menuItems.length + ' menu items');
          let fileItem: HTMLElement | null = null;
          for (const item of menuItems) {
            const text = item.textContent || '';
            logToHost('debug', 'Doubao: menu item text: ' + text.substring(0, 30));
            if (text.includes('本地文件') || text.includes('文件')) {
              fileItem = item;
              break;
            }
          }
          if (!fileItem) {
            logToHost('error', 'Doubao: 本地文件 menu item not found');
            postEvent('upload_result', { success: false, error: 'Doubao: 本地文件 menu not found' });
            return;
          }
          logToHost('info', 'Doubao: clicking 本地文件');
          fileItem.click();
          await new Promise(r => setTimeout(r, 500));
        }

        // 查找 file input
        logToHost('info', 'Looking for file input');
        const fileInput = document.querySelector<HTMLInputElement>('input[type=file]');
        if (!fileInput) {
          logToHost('error', 'file input not found');
          postEvent('upload_result', { success: false, error: 'file input not found' });
          return;
        }
        logToHost('info', 'file input found, accept=' + (fileInput.accept || '').substring(0, 50));

        // 创建 File 对象并设置
        const blob = new Blob([fileContent], { type: 'text/plain; charset=utf-8' });
        const file = new File([blob], fileName, { type: 'text/plain; charset=utf-8' });
        const dt = new DataTransfer();
        dt.items.add(file);
        logToHost('info', 'Setting file input files: ' + fileName + ' (' + fileContent.length + ' chars)');
        fileInput.files = dt.files;
        logToHost('info', 'Files set, dispatching change event');

        // 触发 change 事件
        fileInput.dispatchEvent(new Event('change', { bubbles: true }));
        logToHost('info', 'Change event dispatched, file uploaded: ' + fileName);
        postEvent('upload_result', { success: true });
      } catch (e) {
        logToHost('error', 'Upload error: ' + String(e));
        postEvent('upload_result', { success: false, error: String(e) });
      }
    })();
  });

  logToHost('info', 'Hook installed on ' + detectPlatform());
})();
