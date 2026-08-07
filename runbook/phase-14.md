# Phase 14 — 评分/热度/和弦/数据页全面修订（v3.11.0 · 2026-08-07）

## 一、已验证事实（verified，本机实跑）

- RYM/AOTY 专辑+单曲双输入接线完成；runScoring 生成 rym_album/rym_song/
  aoty_album/aoty_song 并分别带 scope
- 罗马数字：C-G-Am-F(C major) 与 G-D-Em-C(G major) 均输出 Ⅰ-Ⅴ-Ⅵ-Ⅳ
- 热度（Wet & Wild 真实数据）：国内 ★★★☆☆（单曲评论316/专辑评论413/
  专辑收藏9998/热度85），国外 ●●●○○（Last.fm 98.3K / YouTube 354.5K /
  Discogs 2.3K / RYM 1500）
- 数据页 wikiData（Louder, Please）：Charts=[Scottish Albums (Official
  Charts) #50]；Year-end=[Coup de Main 10, Dork 11, Elle N/A, Forty-Five 15,
  NME 47]；Aggregate=[ADM 7.2/10, Metacritic 77/100]；Reviews=[Clash 7/10,
  Pitchfork 6.7/10]；Credits=[Wet & Wild: Writer Gray/Sur Back, Producer Back]
- 英文 oneLiner “That off-beat keyboard…” 按词边界截断，不再出现 keyboa，
  不追加中文句号
- 音频引擎不再输出 subbass_type=808（改为 sustained_sub），prompt/净化禁用
  808/909
- Wikipedia 整页一次抓取成功（约 94KB），h2 拆节得到 Critical reception /
  Track listing / Personnel / Charts / References；艺人页自动重定向到专辑页

## 二、落盘清单

- `public/app-v5.html`：RYM/AOTY 双输入；百度指数/Google Trends/Chartmetric
  字段；buildDataPage 英文术语+具体引擎来源；卡片数据页数据组装
- `services/audio-analyzer.js`：calcHeatScore 国内细分阈值+国外新指标；
  formatChordSequenceRoman；oneLinerLang；prompt 禁 808/909 与元描述
- `services/mir-cross-ref.js`：罗马数字和弦逻辑 + chord_evidence（roman/keyNote/
  localProgression）
- `services/researcher.js`：cleanWikiCell（引注/CSS/星级清洗）、parseWikiTables、
  classifyWikiTables（聚合/媒体评分分桶）、parseWikiTrackCredits、
  fetchWikiPageSections、专辑页重定向
- `services/sanitize.js`：英文词边界截断；禁用 808/909/乐评里提到
- `scripts/analyze_audio.py`：subbass_type 808→sustained_sub
- `public/card-v6.html`：数据页无白框、英文术语渲染、Charts/Year-end/Ratings/
  Credits 分行；heatScore 兼容旧结构；英文总引用引号

## 三、测试

- `npm test`：35 项全绿（新增罗马数字、热度分拆、英文截断、净化断言）
- `python -m pytest scripts/ -q`：9 项全绿

## 四、说明

- Wikipedia 星级评分（Dork/Guardian/NME 的 StarStarStarStar）在 HTML 中以
  title="4/5 stars" 呈现，解析器已支持；媒体评分行可能因嵌套表格偶尔缺失，
  聚合分（ADM/Metacritic）与 Clash/Pitchfork 稳定可用
- 国外热度阈值参考：YouTube 官方里程碑 10万/100万/10亿；Discogs Demand
  Index（want/have）为稀缺信号；Chartmetric/Soundcharts 用 0-100 归一化分
