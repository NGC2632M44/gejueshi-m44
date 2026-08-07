# Phase 25 — 网易云专辑评论/收藏错位修复（v3.25.0 · 2026-08-07）

## 一、已核实事实（verified，实时抓取）

- 复现：query=“Status Update Music leroy”，专辑搜索把
  c0ncernn 同名专辑（378140149，138评论/586收藏）当主专辑；
  Summer Fling 单曲所属专辑实为 leroy 的 378530797（642评论/5686收藏）
- 修复后：主专辑=378530797，artist=leroy，commentCount=642，
  subCount=5686，`_matchedViaSong=true`
- Louder, Please（Wet & Wild）回归正常：259758678 / 412评论 / 10004收藏
  （数值为网易云实时计数，较历史 413/9998 有自然浮动）

## 二、落盘清单

- `services/researcher.js`：新增 fetchNeteaseAlbumInfo（专辑基本信息+封面）
- `server.js`：/api/research/chinese 主专辑改为“单曲所属专辑”优先；
  专辑搜索只作候选封面

## 三、测试

- `npm test`：42 项全绿
- `python -m pytest scripts/ -q`：9 项全绿（未动音频引擎）
