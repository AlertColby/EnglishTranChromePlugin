// popup.js —— 弹窗逻辑
import { translateText } from "./lib/translate.js";

const $ = (sel) => document.querySelector(sel);

const srcEl = $("#src");
const dstEl = $("#dst");
const statusEl = $("#status");
const btnTranslate = $("#btn-translate");
const btnClear = $("#btn-clear");
const btnCopy = $("#btn-copy");
const btnPage = $("#btn-page");
const btnSelection = $("#btn-selection");
const btnOptions = $("#btn-options");

function setStatus(text, kind = "") {
  statusEl.textContent = text || "";
  statusEl.className = "status" + (kind ? " " + kind : "");
}

function setBusy(busy) {
  for (const b of [btnTranslate, btnPage, btnSelection, btnCopy]) b.disabled = busy;
}

// 翻译输入框
btnTranslate.addEventListener("click", async () => {
  const text = srcEl.value.trim();
  if (!text) {
    setStatus("请输入英文", "error");
    return;
  }
  setBusy(true);
  setStatus("翻译中...");
  try {
    const result = await translateText(text);
    dstEl.textContent = result;
    btnCopy.disabled = false;
    setStatus("✓ 完成", "success");
  } catch (err) {
    setStatus("✗ " + (err.message || err), "error");
  } finally {
    setBusy(false);
  }
});

btnClear.addEventListener("click", () => {
  srcEl.value = "";
  dstEl.textContent = "";
  btnCopy.disabled = true;
  setStatus("");
  srcEl.focus();
});

btnCopy.addEventListener("click", async () => {
  const text = dstEl.textContent.trim();
  if (!text) return;
  try {
    await navigator.clipboard.writeText(text);
    setStatus("✓ 已复制", "success");
  } catch {
    setStatus("复制失败", "error");
  }
});

// 翻译当前页面正文
btnPage.addEventListener("click", async () => {
  setBusy(true);
  setStatus("正在翻译页面...");
  try {
    const tab = await getActiveTab();
    const resp = await chrome.runtime.sendMessage({ type: "popup-translate-page", tabId: tab.id });
    if (!resp?.ok) throw new Error(resp?.error || "未知错误");
    setStatus("✓ " + (resp.message || "已翻译页面"), "success");
    window.close();
  } catch (err) {
    setStatus("✗ " + (err.message || err), "error");
  } finally {
    setBusy(false);
  }
});

// 翻译选中文本
btnSelection.addEventListener("click", async () => {
  setBusy(true);
  setStatus("获取选区...");
  try {
    const resp = await chrome.runtime.sendMessage({ type: "popup-translate-selection" });
    if (!resp?.ok) throw new Error(resp?.error || "请先在页面上选中文字");
    dstEl.textContent = resp.result.translated || resp.result;
    srcEl.value = resp.text || srcEl.value;
    btnCopy.disabled = false;
    setStatus("✓ 完成", "success");
  } catch (err) {
    setStatus("✗ " + (err.message || err), "error");
  } finally {
    setBusy(false);
  }
});

btnOptions.addEventListener("click", () => {
  chrome.runtime.openOptionsPage?.();
});

async function getActiveTab() {
  const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
  return tab;
}

// 回车快捷翻译
srcEl.addEventListener("keydown", (e) => {
  if ((e.metaKey || e.ctrlKey) && e.key === "Enter") {
    e.preventDefault();
    btnTranslate.click();
  }
});

// 显示当前引擎
(async () => {
  const labels = {
    free: "免费（腾讯+有道）",
    deepseek: "DeepSeek",
    baidu: "百度翻译"
  };
  try {
    const { et_options = {} } = await chrome.storage.sync.get("et_options");
    const engine = et_options.engine || "free";
    const badge = document.getElementById("engineBadge");
    if (badge) badge.textContent = `引擎：${labels[engine] || engine}`;
  } catch {}
})();

// 页面加载时尝试读取当前选区
(async () => {
  try {
    const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
    if (!tab?.id) return;
    const [{ result }] = await chrome.scripting.executeScript({
      target: { tabId: tab.id },
      func: () => window.getSelection?.()?.toString().trim() || ""
    });
    if (result && result.length < 480) {
      srcEl.value = result;
    }
  } catch {
    // 某些页面（如 chrome:// 内部）会注入失败，忽略
  }
})();