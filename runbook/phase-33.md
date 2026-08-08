# Phase 33 — 热度以最终手动数据为准（v3.29.11）

日期：2026-08-08

## 问题

自动爬取的 YouTube/网易云等热度错误时，用户手动修正后卡片仍显示旧热度——
因为卡片生成用的是评分时的 heatData 快照。

## 修复

- `window._autoHeatData`：自动爬取值单独存档；
- `collectManualHeatOverrides()`：读取当前手动输入
  （QQ 评论 / 网易云单曲评论 / 专辑评论 / 专辑收藏 / YouTube 播放 /
  RYM 人数）；
- `refreshHeatFromManual()`：手动输入 oninput 时立即用
  “自动 + 手动”重算热度，并刷新国内★/国外● 徽章；
- `generateCardFromDraft`：生成卡片时重新合并计算热度，
  不再使用评分时的旧快照；
- `runScoring`：评分请求前同样用合并后的最新热度。

## 验证

- app-v5 JS 语法检查通过；
- npm test 56 项全绿；
- 手动改 YouTube 播放量 → Step2 徽章与卡片热度立即更新。
