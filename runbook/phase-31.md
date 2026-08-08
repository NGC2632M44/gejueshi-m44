# Phase 31 — Step 4 三模式：全自动 / 手动分数+AI 辅助 / 全手动（v3.29.8）

日期：2026-08-08

## 需求

Step 4 三个按钮：
1. 全自动生成（AI 全流程）；
2. 手动输入分数，AI 辅助打分写文（原“一锤定音”，约束 ±4 + 排序）；
3. 全手动生成：跳过 AI，手填五维分数/乐评/一句话总评/标签，总分自动相加。

## 改动

- `public/app-v5.html`：
  - 按钮行改为三按钮并调整顺序与文案；
  - 新增 `openManualEditor()`：进入审阅窗口“manual”模式，
    显示 0-20 分数输入框 + 乐评文本框，隐藏“恢复 AI 原文”；
  - 新增 `buildManualDraftAndScores()`：校验分数 0-20、乐评必填，
    总分自动累加，构建 card draft（复用音频修正值）；
  - `confirmCopyAndGenerate()` 按模式分流；`reloadAiCopy()` 手动模式禁用；
  - `showScoreHero()` 抽取为公共函数，手动模式生成前也更新 Hero。

## 验证

- app-v5 JS 语法检查通过；
- npm test 56 项全绿；
- 手动模式不调用 /api/analyze/score 与 /api/verify-card（纯前端生成）。
