# Phase 32 — YouTube 播放量选错视频修复（v3.29.10）

日期：2026-08-08

## 问题

用户反馈 YouTube 播放量只有 89——旧逻辑只取搜索前 5 条，按标题关键词粗排，
容易选中无人气的同名/粉丝视频。

## 修复（services/researcher.js fetchYouTubeStats）

- maxResults 5 → 20；
- videos 接口同时取 statistics + contentDetails；
- 评分：
  - 标题/频道与查询词（歌曲名+艺人）匹配度（缺失 60% 词重罚）；
  - Official / Visualiser / Audio / Lyric +30；
  - 频道含艺人名 +40、VEVO +15；
  - Remix / Live / Cover / Reaction / #shorts -30；
  - Shorts（<60s）-80、>30min -50；
  - 播放量 10K/100K/1M 分层加分；
- 按分数排序，同分按播放量。

## 实测

- Charli XCX Camera → Official Video，4,794,261 播放；
- Rose Gray Wet & Wild → Official Visualiser，355,047 播放；
- Leroy Summer Fling → 无官方源，选最匹配上传（shyn.2014），16,960 播放。

## 测试

- npm test 56 项全绿。
