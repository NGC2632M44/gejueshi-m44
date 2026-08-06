# Changelog

## [3.8.0] - 2026-08-07

### Added
- 多源基础信息校准模块（`services/calibrate.js`）：歌名 / 艺人 / 专辑 / 年份 /
  厂牌 / 流派 / 时长做多源共识，来源为网易云、Last.fm、Genius、YouTube、
  MusicBrainz（aggregate）、Discogs Master；Step2 完成后自动调用并回填 Step4，
  评分 prompt 同步携带“基础信息校准”段。
- MIR 面板新增“时长校验”：本地 ffprobe 原文时长 vs MusicBrainz 录音时长，
  不一致时高亮提示。
- 歌词来源显示：LRCLIB / Genius / 网易云 会标注在界面与状态栏。
- 新增校准与 prompt 单测（`test_calibrate.js`、`test_prompt_calibration.js`）。

### Fixed
- 网易云“单曲评论”改用联网检索的单曲名（此前错误地用专辑搜索词，导致单曲
  评论永远取到专辑同名曲）。
- Last.fm 时长单位换算（API 返回毫秒，此前被当成秒，导致校准推荐 182000s）。
- YouTube 标题清洗：去掉艺人前缀与 (Official Visualiser) 等后缀，标题共识
  不再被 “Rose Gray - Wet & Wild” 污染。
- buildAggregate 回退链：MusicBrainz/iTunes 未命中时优先 Last.fm / Discogs
  的专辑身份，不再退回 Wikipedia 艺人页（此前 “Louder, Please Rose Gray”
  会被解析成 title=Rose Gray / artist=?）。
- 聚合流派标签过滤纯年份（如 2025）不再混入“流派”。
- MIR/歌词面板清理 Spotify、AcousticBrainz 已下线残留；SongBPM 手动 URL
  面板只显示真实查询过的来源。
- `/api/status` 来源列表去掉已下线的 RYM/AOTY (via DDG) 与未安装的 Demucs
  误导项，改为实际在用的免费 API 与本地引擎说明。

### Changed
- 版本统一 3.8.0。

## [3.7.0] - 2026-08-07

### Added
- Discogs Personal Access Token 接入（已实测）：实体发行版评分 / 拥有数 / 想要数 /
  厂牌 / 格式 / 曲目 / 封面；自动修正 Step4 厂牌，Discogs 评分进入社区评分与热度
- 网易云歌曲热度分（0-100）接入：`/api/song/detail` 实测返回 popularity，
  计入热度星级与评分上下文
- Step2 徽标：Discogs 评分 / 拥有 / 想要、网易云热度

### Changed
- 厂牌优先级：Discogs 详情 labels > MusicBrainz > Discogs 搜索 label
- 格式优先级：Discogs 详情 formats > MusicBrainz > Discogs 搜索 format
- 社区评分顺序：RYM > MusicBrainz > Discogs > Last.fm 听众推导
- 流行度回退链：Last.fm > Discogs have/want > Apple Music trackCount

### Fixed
- Spotify 保持停用（不付费）；可用免费源已最大化利用：Last.fm / YouTube /
  Genius / Discogs / 网易云 / LRCLIB / iTunes / MusicBrainz / Wikipedia

## [3.6.0] - 2026-08-06

### Added
- 接入已验证的免费 API：Last.fm（专辑/单曲听众+播放量）、Genius（歌曲页+页浏览）、
  YouTube Data API（官方视频播放/点赞/评论）、SongBPM 官方 API（BPM/Key 自动交叉）、
  LRCLIB（歌词，LRC 格式，与 lyricsfile 兼容）
- Step1 新增“联网检索·歌曲名/艺人/专辑”三个输入框：选音频后自动按 `艺人 - 歌名`
  解析，可手动修正；名称同步用于 Step2 搜索与 Step4 默认填写
- Step2 手动乐评字段：Pitchfork / Metacritic / NME / The Guardian / Clash / Dork（带官网链接）
- 网易云主专辑封面优先：不再被 MusicBrainz 的 Bonus/Deluxe 封面顶掉；iTunes/Last.fm 参与候选
- /api/status 返回各数据源配置状态；/api/research/chinese 返回 youtube/lastfmTrack/genius

### Fixed
- 密钥映射修正：Last.fm / Discogs / Genius 的 Key 之前串位，现按你提供的最新值接入
- QQ 音乐评论不再出现在自动搜索（无公开接口）；Spotify/Apple 不再参与热度（用户端无收藏/评论数据）
- 封面优先级：iTunes > Last.fm > MusicBrainz > Discogs > Wikipedia，前端再以网易云主专辑兜底
- 网易云专辑评论/收藏字段确认正确（Louder, Please = 413 评论 / 9997 收藏），旧进程需重启
- Discogs：Consumer Key 不是 Personal Access Token，未配置有效 PAT 前不再发请求（避免 401 噪音）
- Spotify：搜索接口实测 403（要求 Premium），MIR 面板标记 retired，不再浪费请求

### Changed
- 歌词接口：LRCLIB 优先、网易云兜底
- MIR 面板：SongBPM 状态区分 ok / no_config / error / no_data；Spotify 显示 retired
- 热度模型：自动来源 = 网易云（专辑+单曲评论/收藏）、Last.fm 听众、YouTube 播放；
  QQ/Spotify/Apple 仅保留手动字段
- 版本统一为 3.6.0

## [3.5.0] - 2026-08-06

### Fixed
- 时长：duration_seconds 改为原文件时长（ffprobe），裁剪后时长单独保留
- SongBPM 手动 URL 解析真正可用（端点曾因函数未导出而一直失败）
- 网易云专辑选择：标题精确匹配优先，不再把 Deluxe/Bonus 当主专辑；
  封面优先使用 MusicBrainz release-group 主封面
- 图片代理：直连失败后真正走 GEJUESHI_PROXY_URL（修复共享已中止 signal 的 bug）
- 外部源请求真正走代理（node-fetch + HttpsProxyAgent）

### Added
- 网易云专辑/单曲评论与收藏分开返回；QQ 失败返回 null（不计入，不伪装 0）
- 热度模型扩展：网易云专辑/单曲评论+收藏、QQ、RYM、Last.fm、Spotify/Apple/YouTube
- Step2 → Step4 自动带出所属专辑；音频文件名自动生成联网检索名
- MIR 面板新增 SongBPM URL 粘贴验证（交叉纠正 BPM/Key）
- Wikipedia 乐评“一句话评价”提取并展示/渲染到卡片
- 候选封面点选器（iTunes/网易云多版本）
- 手动平台字段增加 Spotify/Apple/YouTube + 各平台搜索链接

## [3.4.0] - 2026-08-06

### Added
- 音频引擎容器识别与 ffmpeg 归一化：WebM/Opus 伪装成 .mp3 的文件现在会被正确识别并记录真实编码/码率
- 五维评分证据包（audioFeatures.evidence）：词/曲/编/唱/混 各维度结构化证据，AI 评分必须引用证据键
- sonara 证据特征：key_candidates、和弦变化率、不和谐度、段落结构、vocalness、能量/舞蹈性/情绪等
- 设置面板真正生效：model/apiUrl/apiKey 统一走 data/settings.json，Key 只显示掩码
- MIR 面板逐源状态与“外部源全部不可用”警告
- 专辑模式：所属专辑字段、卡片 HTML 落盘、album-dirs 统计 HTML+PNG
- 测试体系：npm test（JS 单测/集成）+ pytest（音频引擎回归）

### Fixed
- 潜伏 bug：sonara 成功时 bpm_method 字符串拼接抛错，导致 sonara 从未真正生效
- 素材库入库顺序：albumId 未写入曲目，专辑分组恒为空
- SongBPM 解析：适配当前页面结构（BPM span + Key <dd> + 正文调式）
- JSON 类型：numpy 布尔不再序列化为字符串 "True"/"False"
- 卡片失败误判：`cardHTML.includes("error")` 改为 HTTP 状态码判断

### Changed
- 代理地址可用 `GEJUESHI_PROXY_URL` 配置（默认 127.0.0.1:1001）
- 移除 AcousticBrainz / DDG-RYM-AOTY / 播客稿件生成器 / /api/publish / scrape_rym.py 等死代码
- 启动脚本不再硬编码 API Key（请在设置面板配置或设置环境变量）

### Security
- API Key 从启动脚本与交接文档中移除；建议轮换历史文档中出现过的 Key
