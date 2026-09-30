// options.js
import { translateText, _setOptsForTesting } from "./lib/translate.js";

const $ = (sel) => document.querySelector(sel);

const DEFAULTS = {
  engine: "free",
  deepseekKey: "",
  deepseekModel: "deepseek-chat",
  baiduAppid: "",
  baiduSecret: "",
  maxBlocks: 200,
  floatOnSelect: true
};

const ENGINE_LABELS = {
  free: "免费（腾讯+有道）",
  deepseek: "DeepSeek LLM",
  baidu: "百度翻译"
};

const statusEl = $("#status");

function setStatus(text, kind = "") {
  statusEl.textContent = text;
  statusEl.className = "status" + (kind ? " " + kind : "");
}

// ---- 引擎切换 UI ----
function currentEngine() {
  return document.querySelector('input[name="engine"]:checked')?.value || "free";
}

function refreshEngineUI() {
  const engine = currentEngine();
  $("#deepseekFields").hidden = engine !== "deepseek";
  $("#baiduFields").hidden = engine !== "baidu";
  $("#engineLabel").textContent = ENGINE_LABELS[engine] || engine;
}

document.querySelectorAll('input[name="engine"]').forEach((r) =>
  r.addEventListener("change", refreshEngineUI)
);

// 粘贴 Key 后自动选中对应引擎，避免"填了 Key 但引擎还是 free"的陷阱
$("#deepseekKey").addEventListener("input", () => {
  if ($("#deepseekKey").value.trim()) {
    document.querySelector('input[name="engine"][value="deepseek"]').checked = true;
    refreshEngineUI();
  }
});
$("#baiduAppid").addEventListener("input", () => {
  if ($("#baiduAppid").value.trim() && $("#baiduSecret").value.trim()) {
    document.querySelector('input[name="engine"][value="baidu"]').checked = true;
    refreshEngineUI();
  }
});
$("#baiduSecret").addEventListener("input", () => {
  if ($("#baiduAppid").value.trim() && $("#baiduSecret").value.trim()) {
    document.querySelector('input[name="engine"][value="baidu"]').checked = true;
    refreshEngineUI();
  }
});

// ---- 读写配置 ----
async function load() {
  const { et_options = {} } = await chrome.storage.sync.get("et_options");
  const cur = { ...DEFAULTS, ...et_options };
  document.querySelector(`input[name="engine"][value="${cur.engine}"]`).checked = true;
  $("#deepseekKey").value = cur.deepseekKey;
  $("#deepseekModel").value = cur.deepseekModel;
  $("#baiduAppid").value = cur.baiduAppid;
  $("#baiduSecret").value = cur.baiduSecret;
  $("#maxBlocks").value = cur.maxBlocks;
  $("#floatOnSelect").checked = cur.floatOnSelect;

  // 智能纠正：已配置 DeepSeek Key 但引擎仍是 free → 自动切到 deepseek（仍需保存/测试生效）
  if (cur.engine === "free" && cur.deepseekKey) {
    document.querySelector('input[name="engine"][value="deepseek"]').checked = true;
    setStatus("检测到已填 DeepSeek Key，已自动切换引擎，请点「测试连通」或「保存」生效", "error");
  }

  refreshEngineUI();
}

async function save() {
  const next = {
    engine: currentEngine(),
    deepseekKey: $("#deepseekKey").value.trim(),
    deepseekModel: $("#deepseekModel").value,
    baiduAppid: $("#baiduAppid").value.trim(),
    baiduSecret: $("#baiduSecret").value.trim(),
    maxBlocks: Math.max(20, Math.min(500, Number($("#maxBlocks").value) || DEFAULTS.maxBlocks)),
    floatOnSelect: $("#floatOnSelect").checked
  };

  // 切换到需要 Key 的引擎但没填时提醒
  if (next.engine === "deepseek" && !next.deepseekKey) {
    setStatus("✗ 已选 DeepSeek 但未填 API Key，翻译会失败", "error");
    return;
  }
  if (next.engine === "baidu" && (!next.baiduAppid || !next.baiduSecret)) {
    setStatus("✗ 已选百度但未填 APPID / 密钥，翻译会失败", "error");
    return;
  }

  await persist(next);
  setStatus("✓ 已保存", "success");
  setTimeout(() => setStatus(""), 1600);
}

async function persist(next) {
  await chrome.storage.sync.set({ et_options: next });
}

async function reset() {
  await chrome.storage.sync.set({ et_options: DEFAULTS });
  await load();
  setStatus("已恢复默认", "success");
  setTimeout(() => setStatus(""), 1600);
}

// ---- 连通性测试（用当前表单里填写的 Key，无需先保存） ----
async function testEngine(engine) {
  const btn = engine === "deepseek" ? $("#testDeepseek") : $("#testBaidu");
  const out = engine === "deepseek" ? $("#testDeepseekStatus") : $("#testBaiduStatus");

  const show = (text, kind = "") => {
    out.textContent = text;
    out.className = "test-status" + (kind ? " " + kind : "");
  };

  btn.disabled = true;
  show("⏳ 测试中...", "");
  _setOptsForTesting({
    engine,
    deepseekKey: $("#deepseekKey").value.trim(),
    deepseekModel: $("#deepseekModel").value,
    baiduAppid: $("#baiduAppid").value.trim(),
    baiduSecret: $("#baiduSecret").value.trim()
  });
  try {
    const r = await translateText("A rootless Android app that boots Alpine Linux to run containers.");
    show(`✓ 连通正常：${r}`, "success");
    // 测试通过即自动保存（含引擎选择），避免"测试成功但忘了保存"导致仍用旧引擎
    await persist({
      engine,
      deepseekKey: $("#deepseekKey").value.trim(),
      deepseekModel: $("#deepseekModel").value,
      baiduAppid: $("#baiduAppid").value.trim(),
      baiduSecret: $("#baiduSecret").value.trim(),
      maxBlocks: Math.max(20, Math.min(500, Number($("#maxBlocks").value) || DEFAULTS.maxBlocks)),
      floatOnSelect: $("#floatOnSelect").checked
    });
    setStatus(`✓ 已启用 ${ENGINE_LABELS[engine]} 并保存`, "success");
  } catch (err) {
    show("✗ " + (err.message || "连接失败"), "error");
  } finally {
    btn.disabled = false;
  }
}

$("#save").addEventListener("click", save);
$("#reset").addEventListener("click", () => {
  if (confirm("确定要恢复默认设置吗？")) reset();
});
$("#testDeepseek").addEventListener("click", () => testEngine("deepseek"));
$("#testBaidu").addEventListener("click", () => testEngine("baidu"));

load();