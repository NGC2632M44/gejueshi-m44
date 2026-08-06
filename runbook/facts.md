# 已核验事实清单

更新时间：2026-08-06（Phase 9）

| # | 事实 | 状态 | 验证方式 |
|---|---|---|---|
| F1 | audio/ 下 4/7 个 .mp3 实为 WebM/Matroska（EBML 头 1A 45 DF A3），3 个为真 MP3（ID3） | verified | 读取全部音频文件魔数 |
| F2 | demucs / spleeter / essentia / pydub 未安装；sonara / librosa / pyloudnorm / scipy / soundfile / ffmpeg / mutagen（Phase1 已装）/ pytest（Phase1 已装）可用 | verified | Python importlib 探测 + ffmpeg -version |
| F3 | sonara 对 Camera WAV（相对路径）返回 BPM 125.996 ≈ 126（正确），Key 无输出、候选 G# major（错误） | verified | 本机实跑 sonara.analyze_file |
| F4 | sonara 对含中文的绝对路径报错（???），对两个假 MP3 解码失败 | verified | 本机实跑 |
| F5 | server.js 的评分/研究/MIR/自查接口只读环境变量或请求头，settings.json 的 model/apiUrl/apiKey 不生效；verify-card 硬编码 DeepSeek URL | verified | 代码核查 |
| F6 | 单曲模式用“歌名”当 albumTitle 入库；album-dirs 只统计 .html；output 目录实际只有 PNG | verified | 代码 + 目录核查 |
| F7 | 分析 JSON 中布尔值序列化为字符串 "True"/"False" | verified | 读取 output 测试 JSON |
| F8 | 版本三处不一致（server 3.3.0 / Python 3.2.0 / package.json 2.0.0） | verified | 代码核查 |
| F9 | songbpm 已知 URL 页面可抓：BPM=128 在 span，Key=A、mode=minor 在正文 prose | verified | curl 实抓 Wet & Wild 页面 |
| F10 | songbpm 搜索页 URL 带随机后缀、结果与查询不相关，自动定位不可行 | verified | curl 实测 search?q= |
| F11 | api.getsongbpm.com 无 Key 返回 403；官方页称免费+需回链 | verified（403 部分）/ pending_user（字段质量） | curl 实测 + 官方页 |
| F12 | Spotify 新应用 audio-features 受限（2024-11-27 起 403）、Developer Mode 需 Premium（2026-02 起） | verified | 官方公告 + TechCrunch + spotipy issue |
| F13 | 现有两个回归脚本（True Peak、MIR 校准）实跑通过 | verified | 本机执行 |
| F14 | MIREX 2019 调性检测准确率 50%~90%，“其他错误”最高 20%+ | verified | 官方结果页 |
| F15 | 项目 git 仓库已初始化（根提交 b9af628）；`Desktop\歌掘士_backup_20260806\` 为历史全量备份 | verified | git init + commit |
| F16 | 2026-08-06 建立全新基线备份 `Desktop\歌掘士_backup_v2_baseline_20260806\`（排除 node_modules/.git） | verified | robocopy exit=1 |
| F17 | 项目根目录的 `启动M44.bat` 不存在，只有 `启动M44.vbs`；桌面另有 `启动M44.bat` | verified | 目录核查 |
| F18 | 启动脚本已移除明文 Key；桌面 bat 目录已修正指向 歌掘士 项目 | verified | Phase6 修改后核查 |
| F19 | 版本统一为 3.4.0（package.json 为服务端唯一来源；Python 常量同步） | verified | package.json / analyze_audio.py / /api/status |
| F20 | 全量测试：npm test 7 项 + pytest 9 项通过；album 集成测试通过 | verified | 本机执行 |
| F21 | 时长展示改为 ffprobe 原时长（Wet&Wild 182.6s=3:02），trimmed 单独保留 | verified | 实测 + 测试断言 |
| F22 | /api/songbpm-url 曾因 querySongBPMByUrl 未导出而失败，已修复（128 BPM / A minor） | verified | 实跑端点 |
| F23 | 网易云专辑搜索标题排名修复：Louder, Please（评论413/收藏9995）优先于 Deluxe 版 | verified | 实跑 /api/research/chinese |
| F24 | MusicBrainz release-group 封面 + /api/proxy-image 双通道（直连→代理） | verified | 实跑：archive.org 封面 200 |
| F25 | 版本升至 3.5.0（package.json / Python / 横幅同步） | verified | 代码核查 |
| F26 | Last.fm 正确 Key（00683e…）可用：album.getinfo Louder, Please 听众 159,578；track.getinfo Wet & Wild 听众 98,333 / 播放 1,084,760 / 182s | verified | 本机实跑 |
| F27 | getsongbpm 官方 API：search type=song lookup="Wet & Wild" 返回 4 首同名歌（tempo/key_of/artist），需按艺人过滤；Rose Gray 曲目未入库 | verified | 本机实跑 |
| F28 | Spotify /v1/search 2026-08-06 实测 403 “Active premium subscription required” | verified | 本机实跑 |
| F29 | Discogs Consumer Key 当 token 用返回 401；需 Personal Access Token | verified | 本机实跑 |
| F30 | YouTube Data API：搜索 + statistics 走代理可用（Official Visualiser 354,477 播放） | verified | 本机实跑 |
| F31 | Genius API：search 走代理可用（Wet & Wild id 10900767） | verified | 本机实跑 |
| F32 | LRCLIB：无需 Key，plainLyrics + syncedLyrics 均返回 | verified | 本机实跑 |
| F33 | 网易云 Louder, Please 专辑：commentCount 413 / subCount 9997；单曲 Wet & Wild 316 评论 | verified | 实跑 /api/research/chinese |
| F34 | 版本升至 3.6.0（package.json 唯一来源） | verified | 代码核查 |

## 未验证 / 待用户提供

- U1 ~~getsongbpm API~~ → 已解决（F27）
- U2 ~~Genius API~~ → 已解决（F31）
- U3 代理 127.0.0.1:1001 下的 Wikipedia/MusicBrainz/ADM（需代理在线）
- U4 Demucs 分轨（未安装；默认 out_of_scope）
- U5 Spotify 接入（需 Premium；当前 retired）
- U6 Discogs Personal Access Token（当前只有 Consumer Key）

## 关键结论

- 假 MP3（WebM 容器）是 sonara/mutagen/码率检测全部失效的根因 → 引擎必须做容器识别 + ffmpeg 归一化
- sonara 在 Windows 上不能吃含中文的绝对路径 → 用项目内相对路径或 ffmpeg 临时 WAV
- 调性检测单算法不可信 → BPM/Key 置信度必须按“多引擎 + 多源一致度”计算
- 素材库入库顺序曾是 bug：autoOrganizeAlbum 需先于 push，否则 albumId 丢失
