# Phase 9 — 外部 API 批量接入（v3.6.0 · 2026-08-06）

## 一、密钥映射修正（实测后落盘）

| 项 | 之前（错误） | 现在（正确） | 验证 |
|---|---|---|---|
| getsongbpmApiKey | 00683e…（Last.fm 的 Key） | 530932aa29b2a0cda3166c8fb1bca3c3 | /search 返回 JSON |
| lastfmApiKey | tLaeSg…（Discogs 的 Key） | 00683eebce0dfa9bf65ca27a954da3a7 | album/track API 200 |
| discogsConsumerKey | （被当成 token） | tLaeSgmoNqssZmeVZjvk | 401 Invalid consumer token（不是 PAT） |
| geniusToken | 正确 | tChLLcJ1a… | /search 200 |
| spotify / youtube | 正确 | 同左 | token 200 / search+stats 200 |

## 二、已实测事实（verified）

- Last.fm album.search/getinfo + track.search/getinfo：正确 Key 全部 200。
  Louder, Please 听众 159,578；Wet & Wild 听众 98,333 / 播放 1,084,760 / 时长 182s。
- getsongbpm 官方 API：`search/?api_key=…&type=song&lookup=Wet & Wild` 返回 4 首同名歌
  （Holy Wave 111/Bm 等）；需按艺人名过滤。Rose Gray 曲目当前未入库 → no_data。
- Spotify：`/v1/search` 实测 403 "Active premium subscription required for the owner of the app"。
  Client Credentials 拿 token 成功，但所有业务请求被 Premium 门槛拦截 → retired。
- Discogs：`oauth/identity` + `database/search` 用 Consumer Key 当 token 均 401；
  必须 Personal Access Token（Settings → Developers → Generate token）。
- YouTube Data API：搜索 `Rose Gray Wet & Wild` 命中 Official Visualiser
  （TLvatAQlHBI，354,477 播放 / 6,032 赞 / 295 评论），必须走代理。
- Genius：搜索命中 Wet & Wild（id 10900767），走代理。
- LRCLIB：`/api/search?track_name=Wet Wild&artist_name=Rose Gray` 返回 15 条，
  plainLyrics 2,336 字符 + syncedLyrics 2,932 字符，无需 Key。
- 网易云：Louder, Please 专辑 259758678 → commentCount 413 / subCount 9997；
  单曲 Wet & Wild 2666204025 → 316 评论。当前代码与接口字段一致。
- iTunes 专辑搜索 "Rose Gray Louder Please" 返回空；track 搜索可命中主专辑封面。

## 三、本轮落盘清单

- `data/api-keys.json`（gitignore）：正确映射 + lastfmSharedSecret / discogsConsumerKey 位
- `services/keys.js`：新增字段
- `services/researcher.js`：fetchGeniusSong / fetchYouTubeStats（播放量排序）/
  fetchLastfmTrack；Discogs 仅接受 PAT（长度≥30）；网易云 album dynamic 失败时回退评论 API
- `services/mir-cross-ref.js`：SongBPM 官方 API（ok/no_config/error/no_data），
  Spotify retired；mirCrossReference 接收 opts（songTitle/artistName）
- `server.js`：/api/research/chinese 移除 QQ、新增 youtube/lastfmTrack/genius；
  /api/lyrics LRCLIB 优先；/api/status 数据源状态；密钥统一 getKeys()
- `public/app-v5.html`：Step1 联网检索名输入；Step2 自动带出+YouTube/Last.fm/Genius 徽标；
  网易云主封面优先；QQ 自动徽标移除；手动乐评字段扩展
- `services/audio-analyzer.js`：calcHeatScore 移除 Spotify/Apple

## 四、验证结果

- `/api/research/chinese?q=Rose Gray Louder Please&song=Wet & Wild Rose Gray`：
  网易云专辑 413/9997、单曲 316、YouTube 354,477、Last.fm 98,333/1,084,760、Genius 命中
- `/api/research?q=Rose Gray Louder Please`：artwork=Last.fm（iTunes 空），sources 无 error
- `/api/lyrics?q=Wet Wild Rose Gray`：LRCLIB 2,336 字符
- `/api/mir-cross-ref`（Holy Wave - Wet & Wild）：songbpm ok（111 BPM / Bm）
- `npm test` 15 项通过；`pytest` 9 项通过

## 五、pending_user

- Discogs Personal Access Token（当前只有 Consumer Key）
- Spotify Premium 升级后可重新启用搜索（需重新冒烟）
- 专辑/单曲手动评分字段拆分为两套（需求已记录，暂未改 UI）
