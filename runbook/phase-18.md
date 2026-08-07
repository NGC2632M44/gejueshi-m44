# Phase 18 — 热度信号纠错 + 语气/版式优化（v3.15.0 · 2026-08-07）

## 一、已核实改动（verified）

- `/api/heat` 传入 netease_song_album_collections=10002 被忽略：
  domestic=★★★☆☆ :: NC专辑收藏 9,998；NC热度 85；
  sources 只含 单曲评论/QQ评论/专辑评论/专辑收藏/热度分，不再有“单曲收藏”
- 评分 prompt 与 sanitize 已加入专业语气规则与轻佻词禁用表
- 数据页榜单字体 17px（与参数值一致），Charts 4 行 / Year-end 3 行 /
  Reviews 5 行，两列布局
- 卡片：sleeve 288px、radar 410px、radar-zone padding 0、
  mini-scores margin 4px、r-verdict 间距收紧

## 二、测试

- `npm test`：36 项全绿
- `python -m pytest scripts/ -q`：9 项全绿（未动音频引擎）
