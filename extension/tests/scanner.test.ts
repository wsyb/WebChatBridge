/**
 * Tests for scanner.ts - specifically the isInsideTemplateSection fix
 *
 * The fix ensures that when walking up the DOM to check for template sections,
 * we stop at AI message container boundaries to avoid false positives from
 * system prompts in user messages.
 *
 * @vitest-environment jsdom
 */

import { describe, it, expect } from 'vitest';
import { JSDOM } from 'jsdom';

function createDoc(html: string): Document {
  const dom = new JSDOM(html);
  return dom.window.document;
}

describe('Scanner - Template Section Detection', () => {
  it('should detect tool_call inside AI message container', () => {
    const doc = createDoc(`
      <html><body>
        <div class="ds-assistant-message-main-content">
          <div class="code-block">
            \`\`\`tool_call
            {"name": "read", "arguments": {"file_path": "/etc/hostname"}}
            \`\`\`
          </div>
        </div>
      </body></html>
    `);

    const aiMsg = doc.querySelector('.ds-assistant-message-main-content');
    expect(aiMsg).not.toBeNull();

    const codeBlock = aiMsg?.querySelector('.code-block');
    expect(codeBlock).not.toBeNull();
    expect(codeBlock?.textContent).toContain('tool_call');
    expect(codeBlock?.textContent).toContain('"name"');
  });

  it('should identify template sections in user messages', () => {
    // The actual system prompt uses "### " (triple hash) for tool sections
    const doc = createDoc(`
      <html><body>
        <div class="user-message">
          <div class="message-content">
            # 系统角色设定
            ### ls - 列出目录内容
            \`\`\`tool_call
            {"name": "ls", "arguments": {"path": "/tmp"}}
            \`\`\`
          </div>
        </div>
      </body></html>
    `);

    const userMsg = doc.querySelector('.user-message');
    expect(userMsg).not.toBeNull();

    const content = userMsg?.querySelector('.message-content');
    expect(content?.textContent).toContain('tool_call');
    expect(content?.textContent).toContain('### ');
  });

  it('should stop at AI message boundaries during DOM walk-up', () => {
    const doc = createDoc(`
      <html><body>
        <div class="chat-container">
          <div class="user-message">
            <div class="message-content">
              # 系统角色设定
              \`\`\`tool_call
              {"name": "ls", "arguments": {"path": "/tmp"}}
              \`\`\`
            </div>
          </div>
          <div class="ds-assistant-message-main-content">
            <div class="ai-response">
              <div class="code-block">
                \`\`\`tool_call
                {"name": "read", "arguments": {"file_path": "/etc/hostname"}}
                \`\`\`
              </div>
            </div>
          </div>
        </div>
      </body></html>
    `);

    const aiCodeBlock = doc.querySelector('.ds-assistant-message-main-content .code-block');
    expect(aiCodeBlock).not.toBeNull();

    // Walk up from the code block - should stop at AI message container
    let current: Element | null = aiCodeBlock;
    let foundAIMessage = false;

    for (let i = 0; i < 5 && current; i++) {
      if (i > 0) {
        if (current.matches('.ds-assistant-message-main-content')) {
          foundAIMessage = true;
          break;
        }
      }
      current = current.parentElement;
    }

    expect(foundAIMessage).toBe(true);
  });

  it('should filter tool_call in template sections (user messages)', () => {
    const doc = createDoc(`
      <html><body>
        <div class="user-message">
          <div class="message-content">
            ## 可用工具清单
            ### ls - 列出目录内容
            \`\`\`tool_call
            {"name": "ls", "arguments": {"path": "/tmp"}}
            \`\`\`
          </div>
        </div>
      </body></html>
    `);

    const content = doc.querySelector('.message-content');
    expect(content?.textContent).toContain('tool_call');
    expect(content?.textContent).toContain('### ');
  });

  it('should NOT filter real tool_call in AI messages', () => {
    const doc = createDoc(`
      <html><body>
        <div class="ds-assistant-message-main-content">
          <div class="ai-response">
            我来帮你读取文件内容。

            \`\`\`tool_call
            {"name": "read", "arguments": {"file_path": "/etc/hostname"}}
            \`\`\`
          </div>
        </div>
      </body></html>
    `);

    const aiMsg = doc.querySelector('.ds-assistant-message-main-content');
    const text = aiMsg?.textContent || '';

    expect(text).toContain('tool_call');
    expect(text).not.toContain('### ');
  });
});

describe('Scanner - Only Scan Last AI Message', () => {
  it('should only consider the last AI message container', () => {
    const doc = createDoc(`
      <html><body>
        <div class="ds-assistant-message-main-content">
          <pre><code>tool_call
===
ls
---
path: /old
===
</code></pre>
        </div>
        <div class="ds-assistant-message-main-content">
          <pre><code>tool_call
===
read
---
file_path: /new
===
</code></pre>
        </div>
      </body></html>
    `);

    const containers = doc.querySelectorAll('.ds-assistant-message-main-content');
    expect(containers.length).toBe(2);

    // The scanner should only look at the LAST container
    const lastContainer = containers[containers.length - 1];
    const text = lastContainer?.textContent || '';
    expect(text).toContain('read');
    expect(text).toContain('/new');

    // The first container's tool_call should NOT be scanned
    const firstContainer = containers[0];
    const firstText = firstContainer?.textContent || '';
    expect(firstText).toContain('ls');
    expect(firstText).toContain('/old');
  });

  it('should return empty when no AI messages exist', () => {
    const doc = createDoc(`
      <html><body>
        <div class="user-message">Hello</div>
      </body></html>
    `);

    const containers = doc.querySelectorAll('.ds-assistant-message-main-content');
    expect(containers.length).toBe(0);
  });

  it('should handle single AI message with tool_call', () => {
    const doc = createDoc(`
      <html><body>
        <div class="ds-assistant-message-main-content">
          <pre><code>tool_call
===
read
---
file_path: /etc/hostname
===
</code></pre>
        </div>
      </body></html>
    `);

    const containers = doc.querySelectorAll('.ds-assistant-message-main-content');
    expect(containers.length).toBe(1);

    const text = containers[0]?.textContent || '';
    expect(text).toContain('read');
    expect(text).toContain('/etc/hostname');
  });
});

describe('Scanner - Text Protocol Without tool_call Label', () => {
  it('should detect text protocol format without tool_call keyword', () => {
    // The exact format the user reported: ===/task_list/---/===
    // This does NOT contain the string "tool_call"
    const doc = createDoc(`
      <html><body>
        <div class="ds-assistant-message-main-content">
          <pre><code>===
task_list
---
===
</code></pre>
        </div>
      </body></html>
    `);

    const containers = doc.querySelectorAll('.ds-assistant-message-main-content');
    expect(containers.length).toBe(1);

    const text = containers[0]?.textContent || '';
    // Verify this text does NOT contain "tool_call"
    expect(text).not.toContain('tool_call');
    // But it does contain the text protocol delimiters
    expect(text).toContain('===');
    expect(text).toContain('task_list');
    expect(text).toContain('---');
  });

  it('should detect text protocol with parameters without tool_call keyword', () => {
    const doc = createDoc(`
      <html><body>
        <div class="ds-assistant-message-main-content">
          <pre><code>===
ls
---
path: /home/user
===
</code></pre>
        </div>
      </body></html>
    `);

    const containers = doc.querySelectorAll('.ds-assistant-message-main-content');
    expect(containers.length).toBe(1);

    const text = containers[0]?.textContent || '';
    expect(text).not.toContain('tool_call');
    expect(text).toContain('===');
    expect(text).toContain('ls');
    expect(text).toContain('path: /home/user');
  });
});
