// diagnose.mjs —— 翻译引擎连通性诊断
// 用法: node tools/diagnose.mjs
// 环境变量（可选，测试付费引擎）:
//   DEEPSEEK_API_KEY / BAIDU_APPID / BAIDU_SECRET
import { translateText, _setOptsForTesting } from "../lib/translate.js";

const engines = [
  { name: "腾讯 TransMart（免费主引擎）", url: "https://transmart.qq.com/api/imt" },
  { name: "有道 aidemo（免费兜底）", url: "https://aidemo.youdao.com/trans" },
  { name: "百度翻译开放平台", url: "https://fanyi-api.baidu.com/api/trans/vip/translate" },
  { name: "DeepSeek", url: "https://api.deepseek.com/chat/completions" }
];

console.log("--- 连通性 ---");
for (const e of engines) {
  const c = new AbortController();
  const t = setTimeout(() => c.abort(), 8000);
  try {
    await fetch(e.url, { method: "OPTIONS", signal: c.signal });
    console.log(`[OK]   ${e.name}`);
  } catch (err) {
    const reason = err.name === "AbortError" ? "timeout" : (err.cause?.code || err.message);
    console.log(`[FAIL] ${e.name} -> ${reason}`);
  } finally {
    clearTimeout(t);
  }
}

console.log("--- 免费引擎实测 ---");
try {
  console.log("单条:", await translateText("Hello world, this is a test."));
} catch (err) {
  console.log("单条 FAIL:", err.message);
}
try {
  const r = await translateText.batch(["First sentence.", "Second sentence."]);
  console.log("批量:", r);
} catch (err) {
  console.log("批量 FAIL:", err.message);
}

if (process.env.DEEPSEEK_API_KEY) {
  console.log("--- DeepSeek 实测 ---");
  _setOptsForTesting({ engine: "deepseek", deepseekKey: process.env.DEEPSEEK_API_KEY });
  try {
    console.log("单条:", await translateText("The quick brown fox jumps over the lazy dog."));
  } catch (err) {
    console.log("FAIL:", err.message);
  }
}

if (process.env.BAIDU_APPID && process.env.BAIDU_SECRET) {
  console.log("--- 百度实测 ---");
  _setOptsForTesting({ engine: "baidu", baiduAppid: process.env.BAIDU_APPID, baiduSecret: process.env.BAIDU_SECRET });
  try {
    console.log("单条:", await translateText("The quick brown fox jumps over the lazy dog."));
  } catch (err) {
    console.log("FAIL:", err.message);
  }
}