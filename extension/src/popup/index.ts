/**
 * Popup 入口
 * 初始化 PopupController
 */

import { PopupController } from './popup.js';

// ============================================================
// 初始化
// ============================================================

document.addEventListener('DOMContentLoaded', () => {
  const controller = new PopupController();
  controller.initialize();

  // 页面卸载时清理
  window.addEventListener('unload', () => {
    controller.destroy();
  });
});
