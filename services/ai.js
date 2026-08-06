// 统一 AI 调用与模型设置（Phase 2：设置面板真正生效）
// - 所有 AI 接口必须走 callAI()，不再各自读环境变量
// - model/apiUrl/apiKey 统一来自 data/settings.json 或环境变量
// - /api/settings 只返回掩码 Key，避免明文暴露
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const DEFAULT_SETTINGS = {
  model: "deepseek-v4-flash",
  apiUrl: "https://api.deepseek.com/v1/chat/completions",
  apiKey: "",
};


export function settingsPath() {
  return process.env.GEJUESHI_SETTINGS_PATH
    || path.join(__dirname, "..", "data", "settings.json");
}


export function readSettings() {
  const p = settingsPath();
  try {
    if (fs.existsSync(p)) {
      return { ...DEFAULT_SETTINGS, ...JSON.parse(fs.readFileSync(p, "utf-8")) };
    }
  } catch (_) {
    // 配置损坏时回退默认值
  }
  return { ...DEFAULT_SETTINGS };
}


export function writeSettings(data) {
  const p = settingsPath();
  const dir = path.dirname(p);
  if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });
  fs.writeFileSync(p, JSON.stringify(data, null, 2), "utf-8");
}


export function getEffectiveSettings() {
  const stored = readSettings();
  return {
    model: stored.model || DEFAULT_SETTINGS.model,
    apiUrl: stored.apiUrl || DEFAULT_SETTINGS.apiUrl,
    apiKey: stored.apiKey || process.env.DEEPSEEK_API_KEY || "",
  };
}


export function maskApiKey(key) {
  if (!key) return "";
  if (key.length <= 8) return "****";
  return `${key.slice(0, 3)}****${key.slice(-4)}`;
}


/**
 * 统一 AI 请求。payload.model 缺省时使用 settings.model；
 * apiUrl/apiKey 可由调用方覆盖，缺省时使用 settings。
 */
export async function callAI(payload, opts = {}) {
  const settings = getEffectiveSettings();
  const apiKey = opts.apiKey || settings.apiKey;
  if (!apiKey) throw new Error("未配置 DEEPSEEK_API_KEY");

  const apiUrl = opts.apiUrl || settings.apiUrl;
  const retries = opts.retries ?? 2;
  const body = { ...payload, model: payload.model || settings.model };

  const doFetch = () => fetch(apiUrl, {
    method: "POST",
    headers: { "Content-Type": "application/json", "Authorization": `Bearer ${apiKey}` },
    body: JSON.stringify(body),
    signal: opts.signal,
  });

  for (let attempt = 0; attempt <= retries; attempt++) {
    if (attempt > 0) {
      const delay = Math.min(2000 * 2 ** (attempt - 1), 8000);
      console.log(`   ⏳ AI 重试 ${attempt}/${retries} (${delay}ms)...`);
      await new Promise((r) => setTimeout(r, delay));
    }
    const res = await doFetch();
    if (res.status !== 503) return res;
  }
  return doFetch();
}
