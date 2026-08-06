// 真正走代理的 fetch：Node 全局 fetch 不认 agent 选项，
// 统一用 node-fetch + HttpsProxyAgent（GEJUESHI_PROXY_URL）。
import fetch from "node-fetch";
import { HttpsProxyAgent } from "https-proxy-agent";

export function proxyUrl() {
  return process.env.GEJUESHI_PROXY_URL || "http://127.0.0.1:1001";
}

export async function proxiedFetch(url, opts = {}) {
  const { forceProxy = false, ...rest } = opts;
  const agent = new HttpsProxyAgent(proxyUrl());
  return fetch(url, { ...rest, agent });
}
