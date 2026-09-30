// content.js —— 注入到每个网页
// 主要职责：
//   1) 整页翻译后提供「恢复原文」按钮
//   2) 与 popup / background 协作，处理"恢复"指令
//   3) 划词时显示轻量入口（点击触发翻译，可选）

(() => {
  // ---- 防止重复注入 ----
  if (window.__ET_LOADED__) return;
  window.__ET_LOADED__ = true;

  // ---- 监听消息 ----
  chrome.runtime.onMessage.addListener((msg, _sender, sendResponse) => {
    if (msg?.type === "et-restore-page") {
      restoreAllTranslations();
      sendResponse({ ok: true });
      return true;
    }
    if (msg?.type === "et-get-selection") {
      const sel = window.getSelection?.()?.toString().trim() || "";
      sendResponse({ ok: true, text: sel });
      return true;
    }
  });

  // ---- 整页翻译时挂一个恢复按钮 ----
  const observer = new MutationObserver(() => {
    if (document.querySelector(".__et_done__") && !document.querySelector("#__et_restore__")) {
      mountRestoreBar();
    }
  });
  observer.observe(document.documentElement, { childList: true, subtree: true });

  function mountRestoreBar() {
    if (document.getElementById("__et_restore__")) return;
    const bar = document.createElement("div");
    bar.id = "__et_restore__";
    bar.innerHTML = `
      <span>已翻译</span>
      <button id="__et_restore_btn__">恢复原文</button>
    `;
    document.body.appendChild(bar);
    document.getElementById("__et_restore_btn__").addEventListener("click", () => {
      restoreAllTranslations();
      bar.remove();
    });
  }

  function restoreAllTranslations() {
    document.querySelectorAll(".__et_inline__").forEach((n) => n.remove());
    document.querySelectorAll(".__et_done__").forEach((n) => n.classList.remove("__et_done__"));
    document.querySelectorAll("[data-et-id]").forEach((n) => n.removeAttribute("data-et-id"));
  }

  // ---- 划词增强：选中后悬浮一个"译"按钮 ----
  let floatBtn = null;
  let floatEnabled = true;

  // 读取用户偏好
  chrome.storage.sync.get("et_options", (res) => {
    floatEnabled = res?.et_options?.floatOnSelect !== false;
  });

  chrome.storage.onChanged.addListener((changes, area) => {
    if (area === "sync" && changes.et_options) {
      floatEnabled = changes.et_options.newValue?.floatOnSelect !== false;
    }
  });

  document.addEventListener("mouseup", () => {
    if (!floatEnabled) return;
    scheduleFloatBtn();
  });
  document.addEventListener("mousedown", (e) => {
    if (floatBtn && !floatBtn.contains(e.target)) removeFloatBtn();
  });
  document.addEventListener("keyup", () => {
    if (!floatEnabled) return;
    scheduleFloatBtn();
  });

  function scheduleFloatBtn() {
    removeFloatBtn();
    setTimeout(maybeShowFloatBtn, 10);
  }

  function maybeShowFloatBtn() {
    const sel = window.getSelection?.();
    if (!sel || sel.isCollapsed) return;
    const text = sel.toString().trim();
    if (!text || text.length > 500) return;
    const range = sel.getRangeAt(0);
    const rect = range.getBoundingClientRect();
    if (!rect.width && !rect.height) return;

    floatBtn = document.createElement("button");
    floatBtn.id = "__et_float_btn__";
    floatBtn.textContent = "译";
    floatBtn.title = "点击翻译选中文本";
    floatBtn.style.cssText = `
      position:absolute;z-index:2147483647;
      background:#2563eb;color:#fff;border:0;border-radius:6px;
      padding:2px 8px;font:12px/1.6 system-ui,sans-serif;cursor:pointer;
      box-shadow:0 4px 12px rgba(0,0,0,.2);
    `;
    floatBtn.style.top = `${window.scrollY + rect.top - 26}px`;
    floatBtn.style.left = `${window.scrollX + rect.right + 4}px`;

    const startTranslate = async () => {
      const selected = text;
      const anchorRect = {
        top: rect.top,
        left: rect.left,
        right: rect.right,
        bottom: rect.bottom
      };
      removeFloatBtn();
      // 先显示"翻译中"提示，再发消息（此时选区可能已被清除，所以把文本直接传过去）
      showFloatingResult(selected, "⏳ 翻译中...", anchorRect);
      try {
        const resp = await chrome.runtime.sendMessage({
          type: "content-translate-text",
          text: selected
        });
        if (!resp?.ok) throw new Error(resp?.error || "翻译失败");
        showFloatingResult(selected, resp.result, anchorRect);
      } catch (err) {
        console.error("[ET] content translate:", err);
        showFloatingResult(selected, friendlyError(err), anchorRect);
      }
    };

    // 关键：在 mousedown 就触发翻译。
    // 如果等 click，mouseup 会先冒泡到 document 触发 scheduleFloatBtn 把按钮删除重建，
    // 导致 click 处理器永远执行不到（按钮"点了没反应"的原因）。
    floatBtn.addEventListener("mousedown", (e) => {
      e.preventDefault();   // 防止按下时丢失文本选区
      e.stopPropagation();  // 防止 document 的 mousedown 监听移除按钮
      startTranslate();
    });
    floatBtn.addEventListener("mouseup", (e) => {
      e.preventDefault();
      e.stopPropagation();  // 防止 document 的 mouseup 监听重建按钮
    });
    floatBtn.addEventListener("click", (e) => {
      e.preventDefault();
      e.stopPropagation();  // mousedown 已处理，这里只做兜底拦截
    });
    document.body.appendChild(floatBtn);
  }

  function removeFloatBtn() {
    floatBtn?.remove();
    floatBtn = null;
  }

  // 把底层报错转成用户能看懂的提示
  function friendlyError(err) {
    const msg = err?.message || String(err);
    if (/context invalidated/i.test(msg)) {
      return "✗ 插件刚更新过，请刷新本页面 (F5) 后再试";
    }
    if (/Receiving end does not exist/i.test(msg)) {
      return "✗ 无法连接到插件后台，请刷新本页面 (F5) 后再试";
    }
    return "✗ " + msg;
  }

  // content 层渲染结果气泡（避免依赖 background 注入函数跨域受限）
  // anchorRect：选区的视口坐标（getBoundingClientRect 快照），气泡就近显示；缺省则居中
  function showFloatingResult(original, translated, anchorRect = null) {
    document.querySelectorAll(".__et_float__").forEach((n) => n.remove());
    const box = document.createElement("div");
    box.className = "__et_float__";
    box.innerHTML = `
      <div class="et-head">
        <span class="et-title">英 → 中</span>
        <button class="et-close" aria-label="关闭">×</button>
      </div>
      <div class="et-original"></div>
      <div class="et-result"></div>
      <div class="et-actions">
        <button class="et-copy">复制译文</button>
      </div>
    `;
    box.querySelector(".et-original").textContent = original;
    box.querySelector(".et-result").textContent = translated;
    box.querySelector(".et-close").addEventListener("click", () => box.remove());
    box.querySelector(".et-copy").addEventListener("click", async () => {
      try {
        await navigator.clipboard.writeText(translated);
        box.querySelector(".et-copy").textContent = "✓ 已复制";
        setTimeout(() => (box.querySelector(".et-copy").textContent = "复制译文"), 1400);
      } catch {
        box.querySelector(".et-copy").textContent = "复制失败";
      }
    });

    box.style.position = "fixed";
    box.style.visibility = "hidden"; // 先隐藏，量好尺寸再定位，避免闪烁
    document.body.appendChild(box);

    const bw = box.offsetWidth;
    const bh = box.offsetHeight;
    const vw = window.innerWidth;
    const vh = window.innerHeight;

    if (anchorRect) {
      let top = anchorRect.bottom + 8;
      let left = anchorRect.left;
      // 放不下时依次尝试：上方 → 视口内贴边
      if (top + bh > vh - 8) top = Math.max(8, anchorRect.top - bh - 8);
      if (left + bw > vw - 8) left = Math.max(8, vw - bw - 8);
      box.style.top = `${top}px`;
      box.style.left = `${left}px`;
    } else {
      box.style.top = `${Math.max(8, (vh - bh) / 2)}px`;
      box.style.left = `${Math.max(8, (vw - bw) / 2)}px`;
    }
    box.style.visibility = "visible";
  }
})();