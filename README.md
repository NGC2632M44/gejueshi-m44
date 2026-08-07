# 歌掘士 M44 — 音乐五维分析工作台

单曲/专辑音乐分析工作台：输入音频 → 客观音频分析（BPM/调性/频谱/响度/编曲纹理）
→ 外部数据研究（Wikipedia / MusicBrainz / iTunes / Last.fm / Discogs / Genius / YouTube / 网易云音乐 / getsongbpm / LRCLIB）
→ 多源基础信息校准（歌名/艺人/专辑/年份/厂牌/流派/时长共识）
→ 五维评分（词 / 曲 / 编 / 唱 / 混）→ 生成可视化评分卡。

## 技术栈

- Node.js Express（ESM）+ Python 3.11 音频分析（sonara / librosa / pyloudnorm / ffmpeg）
- 原生 HTML/JS 前端（无框架）

## 快速开始

```bash
npm install
python -m pip install -r requirements.txt   # 见下
node server.js
```

打开 http://localhost:3001/app-v5.html ，首次使用在右上角设置面板填写
DeepSeek 的模型 / API 地址 / Key（也可用环境变量 `DEEPSEEK_API_KEY`）。

Python 依赖：`librosa pyloudnorm soundfile scipy mutagen sonara`（可选 `demucs` 分轨）。

## 测试

```bash
npm test
python -m pytest scripts/ -q
```

## 外部 API 配置

密钥统一放在 `data/api-keys.json`（已 gitignore，不会提交），或使用同名环境变量。
参考 `.env.example`。以下是当前接入的数据源与状态：

| 数据源 | 用途 | 状态 |
| --- | --- | --- |
| [GetSongBPM.com](https://getsongbpm.com/api) | BPM / 调性交叉验证（API 未收录的歌曲走手动 URL 页面解析） | 免费 API Key，已接入 |
| [Last.fm](https://www.last.fm/api/account/create) | 专辑/单曲听众、播放量、封面 | 免费 API Key，已接入 |
| [Genius](https://genius.com/api-clients) | 歌曲页、页浏览量 | 免费 Access Token，已接入 |
| [YouTube Data API v3](https://console.cloud.google.com/apis) | 官方视频播放量/点赞/评论 | 免费 API Key，已接入 |
| [LRCLIB](https://lrclib.net) | 歌词（LRC 格式） | 无需 Key，已接入 |
| [lyricsfile](https://github.com/tranxuanthang/lyricsfile) | 歌词格式参考 | 已接入（LRCLIB 返回 LRC） |
| [MusicBrainz](https://musicbrainz.org/doc/MusicBrainz_API) | 专辑/曲目/厂牌/评分 | 无需 Key |
| [Cover Art Archive](https://coverartarchive.org) | 封面回退 | 无需 Key |
| [iTunes Search API](https://developer.apple.com/library/archive/documentation/AudioVideo/Conceptual/iTuneSearchAPI/index.html) | 封面/曲目/发行日期 | 无需 Key |
| [Wikipedia API](https://www.mediawiki.org/wiki/API:Main_page) | 专辑摘要/乐评/人员/榜单 | 无需 Key |
| [网易云音乐](https://music.163.com) | 专辑/单曲评论与收藏 | 无需 Key |
| [Discogs](https://www.discogs.com/developers) | 实体发行版评分/拥有/想要/厂牌/封面 | Personal Access Token 已配置，已接入 |
| 多源校准（内置） | 歌名/艺人/专辑/年份/厂牌/流派/时长共识，来源=网易云/Last.fm/Genius/YouTube/MusicBrainz/Discogs | 自动，无需额外 Key |
| [Spotify](https://developer.spotify.com/dashboard) | ~~搜索/封面/热度~~ | 2026 起新 App 需 Premium（已实测 403），默认停用 |

## 外源状态与评分对象

- 每个外源 API 在各自检验区域显示真实状态（✅ 可用 / ○ 无数据 / ✕ 失败 /
  ○ 已定位），不再把“没数据”和“失败”混为一谈；歌词区、Step2 研究、基础信息校准、
  封面来源均有状态行。
- Step4 可切换“单曲赏析 / 专辑赏析”：单曲模式下专辑级评分只作背景支撑，
  词/唱维度禁止用专辑分推断；RYM / AOTY 可单独标记单曲级或专辑级。
- 卡片文本会清除 `[混音:LUFS=-7.6]` 这类元数据串，只保留面向读者的自然语言。
- 热度分国内（★）与国外（●）两套透明阈值；卡片第 2 页展示经核验的客观参数
  与热度详情（BPM/调性/时长/LUFS/立体声/频谱/和弦/榜单）。

音频特征计算参考 ITU-R BS.1770-4、EBU R128、Lerch (2012) 与 Katz (2015)。

## 回链

本工具在界面与卡片中引用以上公开数据源时均保留来源链接；API 使用遵循各平台服务条款。
此仓库同时作为 GetSongBPM / Last.fm / Genius / Discogs / YouTube Data API 申请页的回链地址。
