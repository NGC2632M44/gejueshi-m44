# Phase 34 — 榜单人工审核 + 换歌防串数据（v3.29.12）

日期：2026-08-08

## 问题

用户发现卡片上的榜单是 2 Chainz《So Help Me God!》的数据（US Billboard 200 #15、
US Top R&B/Hip-Hop #8、Canadian #77），而不是 Kelsey Lu 的——研究数据串到了
上一首歌/同名专辑。且榜单只能跑完整流程后才发现，无法在生成前人工修正。

## 修复

1. `public/app-v5.html`：
   - Step 2 新增“📊 榜单人工审核”区（`#charts-review`）；
   - 研究完成后立即渲染全部榜单，每条可编辑榜单名/排名、可删除、可添加
     （`renderChartsReview / updateChartRow / removeChartRow / addChartRow`）；
   - `window._chartsReview` 人工榜单优先于 Wikipedia 自动值；
   - `buildDataPage` 读取人工榜单并仍按影响力排序；
   - 换歌防护：`resetResearchIfSongChanged()` 在切换音频文件/重新分析时，
     若研究数据艺人 ≠ 当前歌曲艺人，自动清空研究数据与榜单审核区。

## 实测

- `researchAlbum("Kelsey Lu")` → Wikipedia 艺人页、charts 为空；
  之前出现的 2 Chainz 数据来自旧研究数据残留，换歌防护已拦截。

## 测试

- npm test 56 项全绿；
- app-v5 JS 语法检查通过。
