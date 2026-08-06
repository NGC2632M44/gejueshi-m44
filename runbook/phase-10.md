# Phase 10 — Discogs PAT + 网易云热度分（v3.7.0 · 2026-08-07）

## 一、已验证事实（verified）

- Discogs PAT `ywPzwd…`：`/oauth/identity` 200（username sayman44）
- Discogs search（Rose Gray Louder Please）：主结果 Louder, Please
  （id 32877246，Play It Again Sam Records，Vinyl LP/Album，2025，Europe）
- Discogs release detail：community have=351 / want=248 / rating=4.95（21 票），
  tracklist 含 Wet & Wild，封面直链可用
- 网易云 `/api/song/detail?ids=[id]`：Wet & Wild popularity=85；Louder, Please 标题曲=20
- 端口 3001 冒烟：/api/research 返回 discogs.community；aggregate.labels=Play It Again Sam Records；
  aggregate.communityRating.source=Discogs；无 errors

## 二、落盘清单

- `data/api-keys.json`：discogsToken 填入 PAT（gitignore）
- `services/researcher.js`：fetchDiscogsAPI 搜索排序 + 前 3 名详情 enrichment
  （community/labels/formats/tracklist/cover）；buildAggregate 厂牌/格式/社区评分/流行度回退；
  getNeteaseDetail(song) 并行取评论数 + popularity
- `server.js`：neteaseSong.playCount 改用 songDetail.popularity
- `services/audio-analyzer.js`：calcHeatScore 新增 netease_playcount（×30 辅助）
- `public/app-v5.html`：Discogs 评分/拥有/想要徽标 + 封面候选 + 厂牌自动填写；
  网易云热度徽标；heatData 增加 discogs_have/want、netease_playcount

## 三、热度模型现状（自动源）

- 网易云：专辑评论/收藏 + 单曲评论 + 热度分
- Last.fm：听众 / 播放量
- YouTube：官方视频播放量
- Discogs：拥有 + 想要（实体收藏热度）
- 手动：RYM 评分人数、QQ 评论、其余平台评分

## 四、测试

- `npm test`（新增 netease_playcount 用例）+ `pytest` 全绿后提交
