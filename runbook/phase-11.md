# Phase 11 — 多源基础信息校准 + 歌词链 + MIR 修复（v3.8.0 · 2026-08-07）

## 一、已验证事实（verified，均为本机实跑）

- Last.fm track.getinfo：Wet & Wild 听众 98,333 / 播放 1,084,760 / 时长 182s
  （API 的 duration 单位是毫秒，需 ÷1000）
- 网易云：Louder, Please 专辑=413 评论 / 9,998 收藏；Wet & Wild 单曲=316 评论 /
  popularity 85 / 时长 182.21s；用单曲搜索词（songQ）才能取到 Wet & Wild 自身评论
- YouTube Data API：官方视觉版 354,503 播放；标题 “Rose Gray - Wet & Wild
  (Official Visualiser)” 需清洗艺人前缀与后缀才可参与标题共识
- Genius API：Wet & Wild 歌曲页定位成功；歌词页面 `data-lyrics-container` 解析可用
- LRCLIB：Wet & Wild 2336 字、Louder, Please 393 字，无需 Key
- Discogs Master（Rose Gray Louder Please）：master=3722568 →
  main_release=32868000；top 版本 32877246（Vinyl LP，rating 4.95/21 票）；
  master 聚合 have=1561 / want=697；厂牌 Play It Again Sam Records
- Hooktheory：`/theorytab/view/rose-gray/wet-wild` 真实页面返回 BPM=128 /
  Key=A minor（此前显示 no_data 是因为没把联网检索名传给查询）
- SongBPM 手动 URL `https://songbpm.com/@rose-gray/wet-wild-njwcb`：BPM=128 /
  Key=A minor（与本地 E minor 冲突 → 面板如实展示，可手动改）
- MusicBrainz：Wet & Wild 录音定位成功，duration=186s（与本地 182s 不一致 →
  面板高亮提示；校准模块以 Last.fm+网易云 182s 共识为准）
- `/api/research`：MusicBrainz/iTunes 未命中时 aggregate 现在回退
  Last.fm/Discogs（此前退回 Wikipedia 艺人页：title=Rose Gray / artist=?）

## 二、落盘清单（v3.8.0）

- `services/calibrate.js`：normCalib / tokenMatch / consensus /
  durationConsensus / cleanYouTubeTitle / buildBasicCalibration
- `server.js`：`POST /api/research/calibrate`；网易云单曲搜索改用 songQ；
  /api/status 来源列表清理 RYM/AOTY-via-DDG、Demucs 误导项
- `services/researcher.js`：buildAggregate 回退链修复；流派标签过滤纯年份；
  fetchGeniusSong/YouTube/Last.fm 全部关键词命中过滤
- `services/mir-cross-ref.js`：移除 Spotify 已下线代码与 AcousticBrainz；
  Hooktheory 接收 songTitle/artistName；SongBPM 仅保留手动 URL 解析
- `services/audio-analyzer.js`：评分 prompt 新增“基础信息校准（多源共识）”段
- `public/app-v5.html`：Step2 自动调校准并回填 Step4；时长校验显示；
  歌词来源标注；MIR 面板清理 spotify/acousticbrainz 残留
- 测试：`services/test_calibrate.js`、`services/test_prompt_calibration.js`

## 三、测试

- `npm test`：21 项全绿（含新增 5 项）
- `python -m pytest scripts/ -q`：9 项全绿
- 真实冒烟：/api/research、/api/research/chinese、/api/research/calibrate、
  /api/lyrics（LRCLIB）、/api/mir-cross-ref、/api/songbpm-url 全部通过

## 四、结论与边界

- Spotify 仍默认停用（新 App 需 Premium，不付费）；MIR 面板不再显示该来源
- getsongbpm API 对 Wet & Wild 无收录，因此该曲 BPM/Key 只能靠手动 URL；
  其他曲目 API 搜索可用
- Hooktheory 无官方 API，只做页面解析；无 Tab 时如实显示 no_data
- QQ 音乐无公开评论接口：只保留手动输入，不伪装成自动源
