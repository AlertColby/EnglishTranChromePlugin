// background.js  ——  Service Worker (MV3 module)
// 职责：
//   1) 创建右键菜单
//   2) 处理快捷键命令
//   3) 调用腾讯交互翻译 API（有道兜底）
//   4) 把译文渲染到当前 tab（划词 / 整页 / 右键）

import { t } from "./i18n.js";
import { translateText } from "./lib/translate.js";

const MENU_ID_SELECTION = "et-selection";
const MENU_ID_PAGE = "et-page";

// ---------- 右键菜单 ----------
chrome.runtime.onInstalled.addListener(() => {
  chrome.contextMenus.create({
    id: MENU_ID_SELECTION,
    title: t("menu_selection", "翻译选中的英文 “%s”"),
    contexts: ["selection"]
  });
  chrome.contextMenus.create({
    id: MENU_ID_PAGE,
    title: t("menu_page", "翻译当前页面正文为中文"),
    contexts: ["page"]
  });
});

// 兼容浏览器重启后 service worker 重新激活但菜单未重建
chrome.runtime.onStartup?.addListener(() => {
  chrome.contextMenus.removeAll(() => {
    chrome.contextMenus.create({
      id: MENU_ID_SELECTION,
      title: t("menu_selection", "翻译选中的英文 “%s”"),
      contexts: ["selection"]
    });
    chrome.contextMenus.create({
      id: MENU_ID_PAGE,
      title: t("menu_page", "翻译当前页面正文为中文"),
      contexts: ["page"]
    });
  });
});

chrome.contextMenus.onClicked.addListener(async (info, tab) => {
  if (!tab?.id) return;
  try {
    if (info.menuItemId === MENU_ID_SELECTION && info.selectionText) {
      await translateAndShowInTab(tab.id, info.selectionText, "selection");
    } else if (info.menuItemId === MENU_ID_PAGE) {
      await runPageTranslation(tab.id);
    }
  } catch (err) {
    console.error("[ET] context menu error:", err);
    notifyTab(tab.id, "❌ " + (err.message || "翻译失败"));
  }
});

// ---------- 快捷键 ----------
chrome.commands.onCommand.addListener(async (command) => {
  const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
  if (!tab?.id) return;
  try {
    if (command === "translate-selection") {
      const sel = await getSelectionFromTab(tab.id);
      if (!sel) {
        notifyTab(tab.id, "请先在页面上选中要翻译的文字。");
        return;
      }
      await translateAndShowInTab(tab.id, sel, "selection");
    } else if (command === "translate-page") {
      await runPageTranslation(tab.id);
    }
  } catch (err) {
    console.error("[ET] command error:", err);
    notifyTab(tab.id, "❌ " + (err.message || "翻译失败"));
  }
});

// ---------- 弹窗 / content 消息 ----------
chrome.runtime.onMessage.addListener((msg, sender, sendResponse) => {
  (async () => {
    try {
      if (msg?.type === "popup-translate") {
        const text = (msg.text || "").trim();
        if (!text) throw new Error("请输入要翻译的文本");
        const result = await translateText(text);
        sendResponse({ ok: true, result });
        return;
      }
      if (msg?.type === "content-translate-text") {
        // content.js 划词浮按钮：文本随消息传入（此时页面选区可能已被清除）
        const text = (msg.text || "").trim();
        if (!text) throw new Error("没有可翻译的文本");
        const result = await translateText(text);
        sendResponse({ ok: true, result });
        return;
      }
      if (msg?.type === "popup-translate-selection") {
        const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
        if (!tab?.id) throw new Error("无法获取当前标签页");
        const sel = await getSelectionFromTab(tab.id);
        if (!sel) throw new Error("请先在页面上选中要翻译的文字");
        const result = await translateText(sel);
        sendResponse({ ok: true, result, text: sel });
        return;
      }
      if (msg?.type === "popup-translate-page") {
        const targetTabId = msg.tabId;
        if (!targetTabId) throw new Error("缺少 tabId");
        const [{ result: blocks }] = await chrome.scripting.executeScript({
          target: { tabId: targetTabId },
          func: collectPageParagraphs,
          args: [200]
        });
        if (!blocks || blocks.length === 0) {
          sendResponse({ ok: false, error: "本页没有可翻译的段落。" });
          return;
        }
        notifyTab(targetTabId, `⏳ 正在翻译 ${blocks.length} 段...`);
        const results = await translateText.batch(blocks.map((b) => b.text));
        await chrome.scripting.executeScript({
          target: { tabId: targetTabId },
          func: applyPageTranslation,
          args: [blocks.map((b) => b.id), results]
        });
        sendResponse({
          ok: true,
          message: `已翻译 ${results.length} 段，点击右下角「恢复原文」按钮可还原。`
        });
        return;
      }
      sendResponse({ ok: false, error: "unknown message" });
    } catch (err) {
      sendResponse({ ok: false, error: err.message || String(err) });
    }
  })();
  return true; // 异步
});

// ---------- 辅助函数 ----------
async function getSelectionFromTab(tabId) {
  try {
    const [{ result }] = await chrome.scripting.executeScript({
      target: { tabId },
      func: () => {
        const sel = window.getSelection?.();
        return sel ? sel.toString().trim() : "";
      }
    });
    return result;
  } catch {
    return "";
  }
}

async function translateAndShowInTab(tabId, text, mode = "selection") {
  const translated = await translateText(text);
  await chrome.scripting.executeScript({
    target: { tabId },
    func: showFloatingTranslation,
    args: [{ original: text, translated, mode }]
  });
}

async function runPageTranslation(tabId) {
  // 让 content.js 提取正文并把译文写回
  const [{ result: blocks }] = await chrome.scripting.executeScript({
    target: { tabId },
    func: collectPageParagraphs,
    args: [200] // 最多 200 段，避免超过免费 API 限额
  });
  if (!blocks || blocks.length === 0) {
    notifyTab(tabId, "本页没有可翻译的段落。");
    return;
  }
  notifyTab(tabId, `⏳ 正在翻译 ${blocks.length} 段...`);
  const results = await translateText.batch(blocks.map((b) => b.text), "en", "zh-CN");
  await chrome.scripting.executeScript({
    target: { tabId },
    func: applyPageTranslation,
    args: [
      blocks.map((b) => b.id),
      results
    ]
  });
  notifyTab(tabId, `✅ 已翻译 ${results.length} 段（点击图标 → 设置可恢复原文）`);
}

function notifyTab(tabId, text) {
  chrome.scripting.executeScript({
    target: { tabId },
    func: (msg) => {
      const old = document.getElementById("__et_toast__");
      if (old) old.remove();
      const el = document.createElement("div");
      el.id = "__et_toast__";
      el.textContent = msg;
      el.style.cssText =
        "position:fixed;top:16px;right:16px;z-index:2147483647;background:rgba(20,20,28,.92);" +
        "color:#fff;padding:10px 14px;border-radius:8px;font:13px/1.4 system-ui,sans-serif;" +
        "box-shadow:0 6px 20px rgba(0,0,0,.3);max-width:60vw;word-break:break-word;";
      document.body.appendChild(el);
      setTimeout(() => el.remove(), 2600);
    },
    args: [text]
  }).catch(() => {});
}

// ---------- 注入到页面的函数（必须保持纯净，不能引用外部变量） ----------
function showFloatingTranslation(payload) {
  // 避免重复
  document.querySelectorAll(".__et_float__").forEach((n) => n.remove());

  const box = document.createElement("div");
  box.className = "__et_float__";
  box.innerHTML = `
    <div class="et-head">
      <span class="et-title">英 → 中</span>
      <button class="et-close" title="关闭" aria-label="关闭">×</button>
    </div>
    <div class="et-original"></div>
    <div class="et-result"></div>
    <div class="et-actions">
      <button class="et-copy">复制译文</button>
    </div>
  `;
  box.querySelector(".et-original").textContent = payload.original;
  box.querySelector(".et-result").textContent = payload.translated;
  box.querySelector(".et-close").addEventListener("click", () => box.remove());
  box.querySelector(".et-copy").addEventListener("click", async () => {
    try {
      await navigator.clipboard.writeText(payload.translated);
      box.querySelector(".et-copy").textContent = "✓ 已复制";
      setTimeout(() => (box.querySelector(".et-copy").textContent = "复制译文"), 1400);
    } catch {
      box.querySelector(".et-copy").textContent = "复制失败";
    }
  });

  // 先隐藏挂载，量好尺寸再定位（CSS 中 .__et_float__ 为 position:fixed，用视口坐标）
  box.style.visibility = "hidden";
  document.body.appendChild(box);

  const bw = box.offsetWidth || 320;
  const bh = box.offsetHeight || 200;
  const vw = window.innerWidth;
  const vh = window.innerHeight;

  const sel = window.getSelection?.();
  const hasSel = sel && sel.rangeCount > 0 && !sel.isCollapsed && payload.mode === "selection";

  let top, left;
  if (hasSel) {
    const rect = sel.getRangeAt(0).getBoundingClientRect();
    top = rect.bottom + 8;
    left = rect.left;
    // 视口内放不下时：尝试放到选区上方；再不行就贴边
    if (top + bh > vh - 8) top = Math.max(8, rect.top - bh - 8);
    if (left + bw > vw - 8) left = Math.max(8, vw - bw - 8);
  } else {
    top = Math.max(8, (vh - bh) / 2);
    left = Math.max(8, (vw - bw) / 2);
  }
  box.style.top = `${top}px`;
  box.style.left = `${left}px`;
  box.style.visibility = "visible";
}

function collectPageParagraphs(maxBlocks) {
  const skipTags = new Set(["SCRIPT", "STYLE", "NOSCRIPT", "CODE", "PRE", "TEXTAREA"]);
  const nodes = Array.from(document.body.querySelectorAll("p, li, h1, h2, h3, h4, h5, h6, blockquote, dd, dt, td, th"));
  const blocks = [];
  const seen = new Set();
  for (const n of nodes) {
    if (skipTags.has(n.tagName)) continue;
    if (n.closest("[contenteditable]")) continue;
    const text = (n.innerText || "").trim();
    if (text.length < 4 || text.length > 800) continue;
    if (seen.has(text)) continue;
    seen.add(text);
    const id = "__et_p_" + blocks.length + "__";
    n.setAttribute("data-et-id", id);
    n.classList.add("__et_pending__");
    blocks.push({ id, text });
    if (blocks.length >= maxBlocks) break;
  }
  return blocks;
}

function applyPageTranslation(ids, translateds) {
  ids.forEach((id, i) => {
    const el = document.querySelector(`[data-et-id="${id}"]`);
    if (!el) return;
    el.classList.remove("__et_pending__");
    el.classList.add("__et_done__");
    const span = document.createElement("span");
    span.className = "__et_inline__";
    span.textContent = translateds[i] || "";
    el.appendChild(span);
  });
}