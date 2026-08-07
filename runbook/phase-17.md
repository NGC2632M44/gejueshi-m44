# Phase 17 — 数据页/封面/雷达版式与总评收尾（v3.14.0 · 2026-08-07）

## 一、已核实改动（verified）

- `/api/heat`（Wet & Wild 真实数据 + QQ 200）：
  domestic=★★★☆☆ :: NC专辑收藏 9,998；NC热度 85
  international=●●●○○ :: Last.fm 98.3K；YouTube 354.5K；
  Discogs 2.3K（want/have=0.45）；RYM 1.5K
- 国内热度 top2 规则：按星级→数值排序，取前二；QQ 单曲评论更高时标签自动
  写 `QQ单曲评论`，否则 `NC单曲评论`
- 英文总评净化：100 字符窗口优先找句号收尾；无句号时按词边界（含连字符）
  截断并去掉尾部 `-`，测试 `dance-floor...` 不再以 `dance-` 结尾
- 卡片模板：sleeve 252px、radar 390px、数据页字体加大、榜单两列、
  Credits 移入顶部 `.who` 区

## 二、测试

- `npm test`：36 项全绿（新增连字符截断断言）
- `python -m pytest scripts/ -q`：9 项全绿（未动音频引擎）
