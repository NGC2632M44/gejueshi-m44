# Phase 2 报告（2026-08-06）—— 设置接线

## Spike/测试

- `services/test_ai.js`（node:test，RED→GREEN，3 项通过）：
  callAI 读取 settings 的 model/apiUrl/apiKey、无 Key 时报错、掩码规则
- 端到端冒烟 `歌掘士_work/phase2/smoke.mjs`（PASS）：
  主服务以独立端口 3101 + 临时 settings 启动，评分请求打到本地 mock AI，
  确认 Authorization=Bearer smoke-key-1234、body.model=smoke-model；
  /api/settings 返回掩码 `smo****1234` 与 apiKeyConfigured=true

## 落盘改动

- 新增 `services/ai.js`：readSettings/writeSettings/getEffectiveSettings/maskApiKey/callAI
  - 支持 `GEJUESHI_SETTINGS_PATH` 环境变量覆盖（测试用，不污染 data/）
  - callAI 统一注入 settings.model（调用方不再硬编码模型）
- `server.js`：
  - 删除本地 settings/deepseekFetch，全部改用 ai.js
  - /api/analyze/score、/api/research/ai、/api/mir-lookup、/api/verify-card
    均回退到 settings.apiKey；verify-card 不再硬编码 DeepSeek URL
  - /api/settings GET/POST 只返回掩码 Key
- `public/app-v5.html`：设置面板显示掩码 Key 占位，输入框留空；
  未填写新 Key 时不覆盖已存 Key
- `package.json`：新增 `npm test`（JS 单测）与 `npm run test:py`（pytest）

## 环境注意

- 端口 3001 上存在一个旧版服务实例（用户手动启动，含明文 Key 环境变量）。
  本次冒烟全部走 3101；旧实例需由用户重启后才能加载新代码。

## 验证

- `node --check server.js` ✅
- `node --test services/test_ai.js` → 3 passed ✅
- smoke.mjs → SMOKE PASS ✅
