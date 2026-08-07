# Phase 19 — 一锤定音（v3.16.0 · 2026-08-07）

## 一、已验证事实（verified）

- 端到端真实 DeepSeek 冒烟：用户定音 词13/曲15/编15/唱17/混16，
  AI 输出完全一致（13/15/15/17/16，总分 76），`finalWordCompliance=true`
- 约束：总分 [用户总分-4, +4]；五维排序硬性（> / ≥ 按用户基准）；
  校验失败自动重试最多 2 次
- UI：Step4 新增五个定音输入 + “🎯 一锤定音”按钮；留空点击 → 全自动
- 单测：parseFinalScores / finalRankingText（唱>混>编≥曲>词）/
  buildFinalWordPromptSection（[72,80]）/ checkFinalWord（总分越界、排序违反）

## 二、落盘清单

- `services/final-word.js`（新增）：约束解析/排序文案/prompt 段/校验
- `services/audio-analyzer.js`：buildScoringPrompt 增加 finalWord 参数
- `server.js`：/api/analyze/score 解析+校验+重试+finalWordCompliance
- `public/app-v5.html`：定音输入区 + 按钮 + 请求体
- `services/test_final_word.js`（新增 4 项）

## 三、测试

- `npm test`：40 项全绿
- `python -m pytest scripts/ -q`：9 项全绿
