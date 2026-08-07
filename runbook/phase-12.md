# Phase 12 — 外源状态可视化 + 单曲/专辑评分拆分 + 卡片净化（v3.9.0 · 2026-08-07）

## 一、已验证事实（verified，本机实跑）

- `/api/lyrics` 每次返回 `attempts`：LRCLIB 命中 Wet & Wild（ok）时只含
  LRCLIB:ok；Genius / 网易云失败会分别记录 no_data / error
- `/api/research/calibrate` 返回 `sourceStatus`：网易云/Last.fm/Genius/YouTube/
  MusicBrainz 聚合/Discogs 各自状态 + 命中字段（歌名/艺人/专辑/年份/厂牌/流派/时长）
- 卡片端点 `/api/card/v4` 实测：含 `[混音:LUFS=-7.6]`、`[混音:subbass_stereo_width=0.1]`
  的输入，渲染后 HTML 不再出现任何 `[混音` / `LUFS` / `subbass`，且无“ ，”标点前空格
- 评分 prompt（单曲 scope）：输出“单曲级评分参考（直接支撑）”+“专辑级评分参考
  （背景支撑，不直接决定单曲得分）”，并禁止 [键:值] 形式字段串
- RYM/AOTY 手动输入可标记单曲/专辑；Step4 全局“评分对象”默认单曲

## 二、落盘清单

- `services/sanitize.js`（新增）：sanitizeScores / sanitizeOneLiner，
  MAX_RATIONALE=220，删除 [键:值] 元数据、编辑日志用语、错误歌词引用
- `services/calibrate.js`：新增 sourceStatus（每源状态+命中字段）
- `services/audio-analyzer.js`：buildScoringPrompt 增加 ratingScope 参数，
  单曲/专辑评分分块 + 新规则；rationale 长度 150-220 字
- `server.js`：/api/lyrics attempts；/api/research/calibrate 透传；
  /api/analyze/score 传 ratingScope；/api/card/v3、v4、/api/album/card 渲染前清洗；
  /api/verify-card 自查后二次清洗
- `public/app-v5.html`：buildSourceChips 通用组件；Step2/歌词/校准状态行；
  封面来源标注；评分对象选择；RYM/AOTY 单曲/专辑标记
- `public/card-v6.html`：详情页 rationale 行数 6→8 行
- 测试：test_sanitize.js（4 项）、test_prompt_calibration.js 新增
  单曲/专辑 scope 与禁元数据断言

## 三、测试

- `npm test`：30 项全绿（新增 sanitize 4 项 + prompt scope 3 项）
- `python -m pytest scripts/ -q`：9 项全绿
- 端到端：/api/card/v4 元数据清洗冒烟通过

## 四、边界说明

- 平台来源大多为专辑级评分（Pitchfork/Metacritic/Discogs/AOTY 等），单曲模式
  下只作为背景支撑；真正单曲级数据来自热度（网易云单曲评论/Last.fm 单曲/
  YouTube 播放）与用户手动标记的 RYM/AOTY 单曲评分
- 卡片净化是三层兜底（评分返回、自查覆盖、卡片渲染），即使旧素材库里有脏文本
  也会被清洗
