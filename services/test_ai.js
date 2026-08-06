import assert from "node:assert/strict";
import fs from "node:fs";
import http from "node:http";
import os from "node:os";
import path from "node:path";
import { test } from "node:test";

const SETTINGS_FILE = path.join(os.tmpdir(), `gejueshi-settings-${Date.now()}.json`);
process.env.GEJUESHI_SETTINGS_PATH = SETTINGS_FILE;

const { callAI, maskApiKey } = await import("./ai.js");


function startMock(handler) {
  return new Promise((resolve) => {
    const server = http.createServer(handler);
    server.listen(0, "127.0.0.1", () => resolve(server));
  });
}


test("callAI uses settings model/apiUrl/apiKey", async () => {
  const requests = [];
  const server = await startMock((req, res) => {
    let body = "";
    req.on("data", (c) => (body += c));
    req.on("end", () => {
      requests.push({ headers: req.headers, body: JSON.parse(body) });
      res.writeHead(200, { "Content-Type": "application/json" });
      res.end(JSON.stringify({ choices: [{ message: { content: "ok" } }] }));
    });
  });
  const url = `http://127.0.0.1:${server.address().port}/v1/chat/completions`;
  fs.writeFileSync(SETTINGS_FILE, JSON.stringify({ model: "test-model", apiUrl: url, apiKey: "test-key-123" }));
  try {
    const res = await callAI({ temperature: 0.1, messages: [] });
    assert.equal(res.status, 200);
    assert.equal(requests.length, 1);
    assert.equal(requests[0].headers.authorization, "Bearer test-key-123");
    assert.equal(requests[0].body.model, "test-model");
    assert.equal(requests[0].body.temperature, 0.1);
  } finally {
    server.close();
  }
});


test("callAI throws when no key configured", async () => {
  fs.writeFileSync(SETTINGS_FILE, JSON.stringify({ model: "m", apiUrl: "http://127.0.0.1:1", apiKey: "" }));
  delete process.env.DEEPSEEK_API_KEY;
  await assert.rejects(() => callAI({}), /未配置 DEEPSEEK_API_KEY/);
});


test("maskApiKey masks the middle and keeps the last four chars", () => {
  assert.equal(maskApiKey("sk-1234567890abcd"), "sk-****abcd");
  assert.equal(maskApiKey(""), "");
  assert.equal(maskApiKey("short"), "****");
});
