# Phase 20 — 数据页自适应列 + 去 AI 味 + 红分说明（v3.18.0 · 2026-08-07）

## 一、已核实改动（verified）

- 模型确认：settings.json model=deepseek-v4-flash，
  apiUrl=https://api.deepseek.com/v1/chat/completions —— 详情页文字就是
  deepseek-v4-flash 生成（DeepSeek 走 chat-completions 是正常 API 格式，
  并非另一个“chat 模型”）
- 数据页 listCols：单行文本 ≤26 字符 → 两列；>26 字符 → 单列完整显示
- 页脚 flex-shrink:0，头部 flex-shrink:0；Charts 3 / Year-end 3 / Reviews 4，
  750px 内页脚不再出框
- 乐评提示词与 sanitize 增加 AI 腔禁用词；红分 ≥17/20 优秀档加 tooltip

## 二、测试

- `npm test`：40 项全绿
- `python -m pytest scripts/ -q`：9 项全绿（未动音频引擎）
