# Phase 13 — 指引一致性 + 热度分拆 + 和弦来源 + 卡片数据页（v3.10.0 · 2026-08-07）

## 一、已验证事实（verified，本机实跑）

- 听歌指引：传入校准后的 audioFeatures（BPM 128.1 / A minor / 182.6s）实测输出
  “BPM: 128.1 —（多源校准）/ 调性: A minor（多源校准）/ 时长: 3分02秒”
- MIR：Wet & Wild chord_sequence=“Am-Dm-Em”，chord_evidence 含
  source=hooktheory、url、raw=“The three most important chords, built off the
  1st, 4th and 5th scale degrees are all minor chords (A minor, D minor, and E minor)”
- 热度（Wet & Wild 真实数据）：国内 ★★★☆☆（评论729/收藏9998/热度85），
  国外 ●●○○○（Last.fm 98.3K / YouTube 354.5K / Discogs 2.3K）
- `/api/heat` 返回 domestic/international + legend；阈值透明可查
- 卡片 `/api/card/v4`：含 dataPage 与 heatScore 分拆时正常渲染
  “VERIFIED DATA / 国内热度 DOMESTIC / 国外热度 OVERSEAS / ★★★☆☆ / ●●○○○ / Am-Dm-Em”
- 歌词引用：单引号不再被转换成「」，it's 保持原样；“乐评里提到”会被清除

## 二、落盘清单

- `services/audio-analyzer.js`：calcHeatScore 国内★/国外●分拆 + 阈值表；
  formatChordSequence；buildScoringPrompt 增加 oneLinerLang 与元描述/完整引用规则；
  generateListeningGuide 时长用 floor + 校准标记
- `services/mir-cross-ref.js`：recommended.chord_sequence 紧凑化 + chord_evidence
- `services/sanitize.js`：去掉单引号转「」；新增“乐评里提到”等禁用词；
  oneLiner 语言感知截断（中文20字/英文60字符）
- `server.js`：/api/heat；card/v4 保留前端 heatScore；评分传 oneLinerLang；
  verify-card 增加元描述/引用规则
- `public/app-v5.html`：MIR 后重生成听歌指引；国内/国外热度徽标；和弦来源行 +
  本地高频和弦；metaManual 手动字段跟踪 + API 校验差异徽标；流派/标签分离；
  buildDataPage；oneLinerLang
- `public/card-v6.html`：新增 P2 VERIFIED DATA 页；封面页版式收紧；热度分拆显示
- 测试：test_scoring_prompt（热度分拆）、test_calibrate（formatChordSequence）、
  test_sanitize（乐评里提到/引号保留）

## 三、测试

- `npm test`：33 项全绿
- `python -m pytest scripts/ -q`：9 项全绿（音频引擎未改，回归确认）

## 四、热度阈值（透明标准）

- 国内 ★：评论 100/300/999/5千/5万；收藏 1千/5千/1万/5万/20万；
  网易云热度分 55/70/85/95
- 国外 ●：Last.fm 听众 1万/5万/20万/100万/500万；YouTube 10万/50万/200万/
  1000万/5000万；Discogs 200/1千/5千/2万/10万；RYM 100/500/2千/1万/5万；
  Genius 1万/5万/20万/100万/500万
- 依据：网易云 999+ 评论为“热单入门”共识；周杰伦《晴天》首个百万评论；
  RYM 历史级专辑（OK Computer）约 8.3 万人评分；Discogs 收藏数按实体收集
  量级；YouTube 音乐视频 100 万播放为热门线
