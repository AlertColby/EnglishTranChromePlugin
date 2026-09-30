// lib/translate.js
// 多引擎翻译架构（英 → 中）：
//   free    —— 腾讯 TransMart（主）+ 有道（兜底），免密钥，质量一般
//   baidu   —— 百度翻译开放平台通用版，需 APPID + 密钥，免费额度 5万字符/月（标准版不限量）
//   deepseek—— DeepSeek LLM，需 API Key，语义理解最好，价格极低
// 引擎与密钥在 options 页配置，保存于 chrome.storage.sync。

const TENCENT_ENDPOINT = "https://transmart.qq.com/api/imt";
const YOUDAO_ENDPOINT = "https://aidemo.youdao.com/trans";
const BAIDU_ENDPOINT = "https://fanyi-api.baidu.com/api/trans/vip/translate";
const DEEPSEEK_ENDPOINT = "https://api.deepseek.com/chat/completions";

const TENCENT_CHUNK = 20;   // 腾讯接口单批条数
const DEEPSEEK_CHUNK = 8;   // LLM 单批条数（JSON 批量）
const MAX_SEGMENT = 800;    // 单条文本分段上限
const TIMEOUT = 30000;      // LLM 稍慢，放宽到 30s

const DEFAULTS = {
  engine: "free",
  baiduAppid: "",
  baiduSecret: "",
  deepseekKey: "",
  deepseekModel: "deepseek-chat"
};

// ---------- 公共入口 ----------

/** 单段翻译（划词 / popup 输入框） */
export async function translateText(text) {
  const opts = await loadOpts();
  const segments = splitForApi(text, MAX_SEGMENT);
  const parts = [];
  for (const seg of segments) {
    if (!seg.trim()) continue;
    parts.push(await dispatchSingle(seg, opts));
  }
  return parts.join("");
}

/** 批量翻译（整页翻译）：入参 string[]，出参 string[]，一一对应 */
translateText.batch = async function batchTranslate(texts) {
  if (!texts.length) return [];
  const opts = await loadOpts();
  const results = new Array(texts.length);
  let cursor = 0;

  const worker = async () => {
    while (cursor < texts.length) {
      const idx = cursor++;
      const text = texts[idx];
      try {
        results[idx] = await dispatchSingle(text, opts);
      } catch (e) {
        results[idx] = `[译失败] ${e.message || e}`;
      }
    }
  };
  // 并发：LLM 引擎保守（2），其余 3
  const n = opts.engine === "deepseek" ? 2 : 3;
  await Promise.all(Array.from({ length: Math.min(n, texts.length) }, () => worker()));
  return results;
};

async function dispatchSingle(text, opts) {
  switch (opts.engine) {
    case "baidu":
      return baiduOnce(text, opts);
    case "deepseek":
      return deepseekOnce(text, opts);
    default:
      return freeOnce(text);
  }
}

// ---------- 引擎 1：免费（腾讯 TransMart + 有道兜底） ----------
async function freeOnce(text) {
  try {
    const r = await tencentBatch([text]);
    return r[0];
  } catch {
    const r = await youdaoOnce(text);
    if (r.startsWith("[译失败]")) throw new Error(r.slice(6));
    return r;
  }
}

async function tencentBatch(textList) {
  const data = await postJSON(TENCENT_ENDPOINT, {
    header: { fn: "auto_translation", session: "", client_key: "browser-chrome-131.0.0.0-Windows_10" },
    type: "plain",
    model_category: "matrix",
    text_source_lang: "en",
    text_target_lang: "zh",
    source: { text_list: textList }
  });
  if (data?.header?.ret_code !== "succ" || !Array.isArray(data.auto_translation)) {
    throw new Error(data?.message || "腾讯翻译接口返回异常");
  }
  return data.auto_translation.map((s) => String(s ?? ""));
}

async function youdaoOnce(text) {
  try {
    const data = await postForm(YOUDAO_ENDPOINT, { q: text, from: "en", to: "zh-CHS" });
    const t = data?.translation?.[0];
    if (typeof t !== "string") throw new Error("有道翻译接口返回异常");
    return t;
  } catch (err) {
    return `[译失败] ${err.message}`;
  }
}

// 批量（整页）时用腾讯原生批量
async function freeBatch(texts) {
  const results = [];
  for (let i = 0; i < texts.length; i += TENCENT_CHUNK) {
    const chunk = texts.slice(i, i + TENCENT_CHUNK);
    let translated;
    try {
      translated = await tencentBatch(chunk);
    } catch {
      translated = await Promise.all(chunk.map((t) => youdaoOnce(t)));
    }
    results.push(...translated);
  }
  return results;
}
// 挂到 batch 分发：免费引擎走原生批量更高效
translateText.batch = async function (texts) {
  if (!texts.length) return [];
  const opts = await loadOpts();
  if (opts.engine === "free") return freeBatch(texts);
  if (opts.engine === "baidu") return baiduBatch(texts, opts);
  if (opts.engine === "deepseek") return deepseekBatch(texts, opts);
  return freeBatch(texts);
};

// ---------- 引擎 2：百度翻译开放平台 ----------
// 文档: https://fanyi-api.baidu.com/doc/21  签名 = MD5(appid + q + salt + 密钥)
async function baiduOnce(text, opts) {
  if (!opts.baiduAppid || !opts.baiduSecret) {
    throw new Error("未配置百度翻译 APPID / 密钥（设置页 → 翻译引擎）");
  }
  const salt = Date.now().toString();
  const sign = md5(opts.baiduAppid + text + salt + opts.baiduSecret);
  const data = await postForm(BAIDU_ENDPOINT, {
    q: text,
    from: "en",
    to: "zh",
    appid: opts.baiduAppid,
    salt,
    sign
  });
  if (data?.error_code) {
    throw new Error(`百度[${data.error_code}] ${data.error_msg || "调用失败"}`);
  }
  const dst = data?.trans_result?.map((r) => r.dst).join("\n");
  if (!dst) throw new Error("百度翻译返回为空");
  return dst;
}

// 百度支持一次请求多行（\n 分隔），按行返回
async function baiduBatch(texts, opts) {
  const results = [];
  for (let i = 0; i < texts.length; i += 20) {
    const chunk = texts.slice(i, i + 20).map((t) => t.replace(/\s*\n\s*/g, " "));
    try {
      const joined = chunk.join("\n");
      const salt = Date.now().toString();
      const sign = md5(opts.baiduAppid + joined + salt + opts.baiduSecret);
      const data = await postForm(BAIDU_ENDPOINT, {
        q: joined, from: "en", to: "zh",
        appid: opts.baiduAppid, salt, sign
      });
      if (data?.error_code || !Array.isArray(data.trans_result)) throw new Error(data?.error_msg || "百度批量翻译失败");
      const lines = data.trans_result.map((r) => r.dst);
      if (lines.length !== chunk.length) throw new Error("百度批量返回行数不匹配");
      results.push(...lines);
    } catch {
      // 逐条兜底
      for (const t of chunk) {
        try { results.push(await baiduOnce(t, opts)); }
        catch (e) { results.push(`[译失败] ${e.message}`); }
      }
    }
  }
  return results;
}

// ---------- 引擎 3：DeepSeek LLM（质量最佳） ----------
const DEEPSEEK_SYSTEM_PROMPT =
  "你是专业的英译中翻译。把用户提供的英文翻译成流畅、准确、符合中文表达习惯的中文。" +
  "只输出译文本身，不要解释、不要加引号、保留原文的语气和格式（如换行）。专有名词可保留英文。";

async function deepseekOnce(text, opts) {
  if (!opts.deepseekKey) throw new Error("未配置 DeepSeek API Key（设置页 → 翻译引擎）");
  const data = await postJSON(DEEPSEEK_ENDPOINT, {
    model: opts.deepseekModel || "deepseek-chat",
    messages: [
      { role: "system", content: DEEPSEEK_SYSTEM_PROMPT },
      { role: "user", content: text }
    ],
    temperature: 1.3,
    stream: false
  }, { Authorization: `Bearer ${opts.deepseekKey}` });
  const out = data?.choices?.[0]?.message?.content?.trim();
  if (!out) throw new Error(data?.error?.message || "DeepSeek 返回为空");
  return out;
}

// LLM 批量：用 JSON 数组批量，失败则降级为逐条
async function deepseekBatch(texts, opts) {
  const results = [];
  for (let i = 0; i < texts.length; i += DEEPSEEK_CHUNK) {
    const chunk = texts.slice(i, i + DEEPSEEK_CHUNK);
    let translated = null;
    try {
      const data = await postJSON(DEEPSEEK_ENDPOINT, {
        model: opts.deepseekModel || "deepseek-chat",
        messages: [
          {
            role: "system",
            content:
              "你是专业的英译中翻译引擎。用户会给出一个 JSON 字符串数组，" +
              "把其中每项英文翻译成流畅准确的中文，返回**相同长度的 JSON 字符串数组**。" +
              "只输出 JSON 数组本身，不要任何解释、不要 markdown 代码块。"
          },
          { role: "user", content: JSON.stringify(chunk) }
        ],
        temperature: 1.3,
        stream: false
      }, { Authorization: `Bearer ${opts.deepseekKey}` });
      const raw = (data?.choices?.[0]?.message?.content || "").trim()
        .replace(/^```(?:json)?\s*/i, "")
        .replace(/\s*```$/, "");
      const parsed = JSON.parse(raw);
      if (Array.isArray(parsed) && parsed.length === chunk.length) {
        translated = parsed.map((s) => String(s ?? ""));
      } else {
        throw new Error("LLM 批量返回结构不符");
      }
    } catch {
      // 降级：逐条翻译
      translated = [];
      for (const t of chunk) {
        try { translated.push(await deepseekOnce(t, opts)); }
        catch (e) { translated.push(`[译失败] ${e.message}`); }
      }
    }
    results.push(...translated);
  }
  return results;
}

// ---------- 网络工具 ----------
async function withTimeout(promiseFactory, ms = TIMEOUT) {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), ms);
  try {
    return await promiseFactory(controller.signal);
  } catch (err) {
    if (err.name === "AbortError") throw new Error("请求超时，请检查网络或稍后重试");
    throw err;
  } finally {
    clearTimeout(timer);
  }
}

async function postJSON(url, body, headers = {}) {
  return withTimeout(async (signal) => {
    const resp = await fetch(url, {
      method: "POST",
      headers: { "Content-Type": "application/json", ...headers },
      body: JSON.stringify(body),
      signal
    });
    if (!resp.ok) {
      let msg = `HTTP ${resp.status}`;
      try { const e = await resp.json(); if (e?.error?.message) msg += ` ${e.error.message}`; } catch {}
      throw new Error(msg);
    }
    return resp.json();
  });
}

async function postForm(url, params) {
  return withTimeout(async (signal) => {
    const resp = await fetch(url, {
      method: "POST",
      headers: { "Content-Type": "application/x-www-form-urlencoded" },
      body: new URLSearchParams(params).toString(),
      signal
    });
    if (!resp.ok) throw new Error(`HTTP ${resp.status}`);
    return resp.json();
  });
}

// ---------- MD5（百度签名需要；Web Crypto 不支持 MD5，内置实现） ----------
function md5(str) {
  function rl(n, c) { return (n << c) | (n >>> (32 - c)); }
  function add(a, b) { return (((a >> 16) + (b >> 16)) + (((a & 0xffff) + (b & 0xffff)) >> 16) << 16) | (((a & 0xffff) + (b & 0xffff)) & 0xffff); }
  function cmn(q, a, b, x, s, t) {
    a = add(add(a, q), add(x, t));
    return add(rl(a, s), b);
  }
  function ff(a, b, c, d, x, s, t) { return cmn((b & c) | (~b & d), a, b, x, s, t); }
  function gg(a, b, c, d, x, s, t) { return cmn((b & d) | (c & ~d), a, b, x, s, t); }
  function hh(a, b, c, d, x, s, t) { return cmn(b ^ c ^ d, a, b, x, s, t); }
  function ii(a, b, c, d, x, s, t) { return cmn(c ^ (b | ~d), a, b, x, s, t); }

  const utf8 = new TextEncoder().encode(str);
  const n = utf8.length;
  const words = [];
  for (let i = 0; i < n * 8; i += 8) words[i >> 5] |= (utf8[i / 8] & 0xff) << (i % 32);
  words[n * 8 >> 5] |= 0x80 << (n * 8 % 32);
  const len = (((n + 8) >> 6) + 1) * 16;
  for (let i = 0; i < len; i++) words[i] = words[i] || 0;
  words[len - 2] = n * 8;

  let a = 1732584193, b = -271733879, c = -1732584194, d = 271733878;
  for (let i = 0; i < len; i += 16) {
    const [oa, ob, oc, od] = [a, b, c, d];
    a = ff(a, b, c, d, words[i], 7, -680876936);
    d = ff(d, a, b, c, words[i + 1], 12, -389564586);
    c = ff(c, d, a, b, words[i + 2], 17, 606105819);
    b = ff(b, c, d, a, words[i + 3], 22, -1044525330);
    a = ff(a, b, c, d, words[i + 4], 7, -176418897);
    d = ff(d, a, b, c, words[i + 5], 12, 1200080426);
    c = ff(c, d, a, b, words[i + 6], 17, -1473231341);
    b = ff(b, c, d, a, words[i + 7], 22, -45705983);
    a = ff(a, b, c, d, words[i + 8], 7, 1770035416);
    d = ff(d, a, b, c, words[i + 9], 12, -1958414417);
    c = ff(c, d, a, b, words[i + 10], 17, -42063);
    b = ff(b, c, d, a, words[i + 11], 22, -1990404162);
    a = ff(a, b, c, d, words[i + 12], 7, 1804603682);
    d = ff(d, a, b, c, words[i + 13], 12, -40341101);
    c = ff(c, d, a, b, words[i + 14], 17, -1502002290);
    b = ff(b, c, d, a, words[i + 15], 22, 1236535329);

    a = gg(a, b, c, d, words[i + 1], 5, -165796510);
    d = gg(d, a, b, c, words[i + 6], 9, -1069501632);
    c = gg(c, d, a, b, words[i + 11], 14, 643717713);
    b = gg(b, c, d, a, words[i], 20, -373897302);
    a = gg(a, b, c, d, words[i + 5], 5, -701558691);
    d = gg(d, a, b, c, words[i + 10], 9, 38016083);
    c = gg(c, d, a, b, words[i + 15], 14, -660478335);
    b = gg(b, c, d, a, words[i + 4], 20, -405537848);
    a = gg(a, b, c, d, words[i + 9], 5, 568446438);
    d = gg(d, a, b, c, words[i + 14], 9, -1019803690);
    c = gg(c, d, a, b, words[i + 3], 14, -187363961);
    b = gg(b, c, d, a, words[i + 8], 20, 1163531501);
    a = gg(a, b, c, d, words[i + 13], 5, -1444681467);
    d = gg(d, a, b, c, words[i + 2], 9, -51403784);
    c = gg(c, d, a, b, words[i + 7], 14, 1735328473);
    b = gg(b, c, d, a, words[i + 12], 20, -1926607734);

    a = hh(a, b, c, d, words[i + 5], 4, -378558);
    d = hh(d, a, b, c, words[i + 8], 11, -2022574463);
    c = hh(c, d, a, b, words[i + 11], 16, 1839030562);
    b = hh(b, c, d, a, words[i + 14], 23, -35309556);
    a = hh(a, b, c, d, words[i + 1], 4, -1530992060);
    d = hh(d, a, b, c, words[i + 4], 11, 1272893353);
    c = hh(c, d, a, b, words[i + 7], 16, -155497632);
    b = hh(b, c, d, a, words[i + 10], 23, -1094730640);
    a = hh(a, b, c, d, words[i + 13], 4, 681279174);
    d = hh(d, a, b, c, words[i], 11, -358537222);
    c = hh(c, d, a, b, words[i + 3], 16, -722521979);
    b = hh(b, c, d, a, words[i + 6], 23, 76029189);
    a = hh(a, b, c, d, words[i + 9], 4, -640364487);
    d = hh(d, a, b, c, words[i + 12], 11, -421815835);
    c = hh(c, d, a, b, words[i + 15], 16, 530742520);
    b = hh(b, c, d, a, words[i + 2], 23, -995338651);

    a = ii(a, b, c, d, words[i], 6, -198630844);
    d = ii(d, a, b, c, words[i + 7], 10, 1126891415);
    c = ii(c, d, a, b, words[i + 14], 15, -1416354905);
    b = ii(b, c, d, a, words[i + 5], 21, -57434055);
    a = ii(a, b, c, d, words[i + 12], 6, 1700485571);
    d = ii(d, a, b, c, words[i + 3], 10, -1894986606);
    c = ii(c, d, a, b, words[i + 10], 15, -1051523);
    b = ii(b, c, d, a, words[i + 1], 21, -2054922799);
    a = ii(a, b, c, d, words[i + 8], 6, 1873313359);
    d = ii(d, a, b, c, words[i + 15], 10, -30611744);
    c = ii(c, d, a, b, words[i + 6], 15, -1560198380);
    b = ii(b, c, d, a, words[i + 13], 21, 1309151649);
    a = ii(a, b, c, d, words[i + 4], 6, -145523070);
    d = ii(d, a, b, c, words[i + 11], 10, -1120210379);
    c = ii(c, d, a, b, words[i + 2], 15, 718787259);
    b = ii(b, c, d, a, words[i + 9], 21, -343485551);

    a = add(a, oa); b = add(b, ob); c = add(c, oc); d = add(d, od);
  }
  const hex = (x) => {
    let s = "";
    for (let i = 0; i < 4; i++) s += ((x >> (i * 8 + 4)) & 0x0f).toString(16) + ((x >> (i * 8)) & 0x0f).toString(16);
    return s;
  };
  return hex(a) + hex(b) + hex(c) + hex(d);
}

// ---------- 配置读取 ----------
async function loadOpts() {
  // 测试注入（options 连通性测试 / Node 诊断脚本）优先
  if (globalThis.__ET_OPTS__) return { ...DEFAULTS, ...globalThis.__ET_OPTS__ };
  try {
    const { et_options = {} } = await chrome.storage.sync.get("et_options");
    return { ...DEFAULTS, ...et_options };
  } catch {
    return { ...DEFAULTS };
  }
}

// 供 Node 诊断脚本注入配置
export function _setOptsForTesting(opts) {
  globalThis.__ET_OPTS__ = opts;
}

// ---------- 文本分段 ----------
function splitForApi(text, maxLen) {
  if (text.length <= maxLen) return [text];
  const chunks = [];
  let buf = "";
  const parts = text.split(/(?<=[.!?。！？])\s+/);
  for (const p of parts) {
    if ((buf + " " + p).trim().length > maxLen) {
      if (buf) chunks.push(buf.trim());
      if (p.length > maxLen) {
        for (let i = 0; i < p.length; i += maxLen) chunks.push(p.slice(i, i + maxLen));
        buf = "";
      } else {
        buf = p;
      }
    } else {
      buf = (buf ? buf + " " : "") + p;
    }
  }
  if (buf) chunks.push(buf.trim());
  return chunks;
}