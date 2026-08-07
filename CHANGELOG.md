# Changelog

## [3.16.0] - 2026-08-07

### Added
- 工作台新增“🎯 一锤定音”按钮：由你填写词/曲/编/唱/混五维分数，
  AI 评分必须满足：
  - 总分落在你的总分 ±4 区间（例如 76 → [72, 80]）；
  - 五维大小排序与你一致（并列允许 ≥，如 唱>混>编≥曲>词）；
  - 各维度尽量贴近你的基准（±3 内），排序与总分是硬约束。
- 服务端自动校验，不满足时最多重试 2 次让 AI 修正，返回
  `finalWordCompliance`；未填写完整五维时自动退化为全自动评分。

## [3.15.0] - 2026-08-07
## [3.15.0] - 2026-08-07

### Fixed
- 删除“单曲收藏”热度信号：网易云/QQ 没有可用的单曲收藏接口，原实现把
  单曲所属专辑收藏当“单曲收藏”导致与专辑收藏重复错位
  （如 NC单曲收藏 10,002；NC专辑收藏 10,002）。国内热度现在只使用：
  单曲评论（NC/QQ 取更高）、专辑评论、专辑收藏、热度分。

### Changed
- 评分语气改为专业乐评口吻：克制、准确、有依据；prompt、AI 自查与卡片净化
  同时禁用“上头/绝了/拿捏/很顶/氛围感拉满/封神/yyds/天花板/杀疯了”等轻佻表达。
- 数据页 Charts / Year-end / Professional Ratings 字体放大到与参数值一致
  （17px），缩减行数（Charts 4、Year-end 3、Reviews 5）并收紧间距保持工整。
- 第一页专辑封面放大到 288px，上下空间基本被封面覆盖；雷达图放大到 410px，
  顶部信息栏与底部标签气泡之间空白压缩。

## [3.14.0] - 2026-08-07
## [3.14.0] - 2026-08-07

### Changed
- 数据页字体整体放大（参数项 17px、榜单行 11px、标题 9px）。
- 国内热度只展示贡献最大的两项，用 NC=网易云 缩写：
  如 `NC专辑收藏 9,998；NC热度 85`（QQ 更高时写 `QQ单曲评论`）。
- 国外热度去掉“听众/人”等单位词，直接贴数据：
  `Last.fm 98.3K；YouTube 354.5K；Discogs 2.3K（want/have=0.45）；RYM 1.5K`。
- Charts / Year-end Lists / Professional Ratings 改为两列布局，行间距收紧、
  字体加大，内容不再出框。
- Credits（Writer(s)/Producer(s)）移到数据页顶部歌手信息右侧，不再占底部。
- 第一页专辑封面放大到 252px、上下间距进一步压缩；雷达页缩略图放大到 96px、
  雷达图放大到 390px。
- 英文总评上限 100 字符、必须是完整句子并以句号结尾；截断时按词边界
  （含连字符），不再出现 `dance-` 这种半词结尾；封面英文总评用 13px 单行。

## [3.13.0] - 2026-08-07
## [3.13.0] - 2026-08-07

### Fixed
- “Failed to fetch”根因：本地 Node 服务进程退出后所有接口都会报此错误。
  已重启服务；SongBPM 验证、评分、卡片渲染恢复正常，前端错误提示补充
  “请确认本地服务已启动”。
- SongBPM 验证更稳：直连失败自动走代理重试；接口始终返回结构化错误。
- AnyDecentMusic 修复：原代码用 `/review/{id}.aspx`（缺 slug）访问必然 404，
  现改用搜索结果的完整 URL；搜索改为用专辑名（Discogs/Last.fm 解析结果），
  按查询词匹配度选最相关结果；正确解析 ADM 总分、媒体个体评分
  （The Guardian 8、NME 8 等）、厂牌与发行日期。

### Added
- SongBPM 输入框旁增加官网跳转链接（https://songbpm.com/）。

## [3.12.0] - 2026-08-07
## [3.12.0] - 2026-08-07

### Removed
- 删除百度指数、Google Trends、Chartmetric Score 手动字段及相关热度计算
  （无有效数据源/API 未批复，避免误导）。
- 删除 QQ 音乐“评分”手动输入（保留 QQ 评论数，作为国内热度信号）。
- Step2 不再展示 Genius 链接徽标；Genius 只保留在歌词链
  （LRCLIB → Genius 页面解析 → 网易云）与基础信息校准中。

### Fixed
- 英文总评不再截成半句：上限 90 字符、必须是完整句子，净化器优先在句号处
  截断、不补省略号；封面英文总评用更小字号保证单行放得下。
- 数据页底部内容不再被遮挡：参数网格压缩为 3×5，DOMESTIC HEAT / OVERSEAS
  HEAT 放入最后一行右侧两格；Charts / Year-end / Ratings / Credits 改用
  更紧凑的分行排版。
- 卡片所有面向读者的热度文字统一为英文（DOMESTIC / OVERSEAS），不再出现
  “国内热度 / 国外热度”。

### Changed
- 第一页：专辑封面放大（216px）、上下间距压缩；总分与热度改为上下布局，
  热度元素缩小且不再挤向左侧。
- 最后一页制作信息去重：只保留一行 `M44 SOUND ANATOMY · GENERATED 日期`。

## [3.11.0] - 2026-08-07

### Added
- RYM / AOTY 手动输入拆成“专辑 / 单曲”两套独立数值（含评分人数），不再用
  单选“对象”标记，可同时填专辑分与单曲分。
- 罗马数字和弦：网源（Hooktheory/SongBPM）优先；当本地检测与网源调式级数
  相同只是整体移调时，显示 Ⅰ-Ⅴ-Ⅵ-Ⅳ（例如 C-G-Am-F 与 G-D-Em-C），并注明
  “罗马数字（网源调性，本地同构）”。
- 国内热度按你的标准细分：单曲评论 100/600/999/5千/2万、单曲收藏 998/2千/
  1万/5万；专辑评论 10/99/999/1800/3800、专辑收藏 500/1千/9800/1.8万/4.8万；
  单曲/专辑各自取评论/收藏更高者，QQ 与网易云取更高平台。
- 国外热度优化：Last.fm/YouTube/Discogs/RYM/Genius 阈值下调并新增
  Google Trends、Chartmetric 手动字段；Discogs want/have≥0.6 热度 +1；
  新增国内“百度指数”手动字段。
- 数据页（第 2 页）大改：去掉白框重叠，英文术语（Key/Loudness/LRA/Spectral
  Centroid 等），来源写具体引擎/API（sonara / librosa / pyloudnorm /
  NetEase + Last.fm / Hooktheory）；Charts、Year-end Lists、Professional
  Ratings（聚合+媒体）、Writer(s)/Producer(s) 结构化分行展示。
- Wikipedia 整页单次抓取并按 h2 拆节（比逐节请求更稳）；自动把艺人页重定向
  到专辑页再解析。

### Fixed
- 一句话总评英文不再被从单词中间截断（“keyboa”问题），按词边界截断并加
  “…”；英文不再追加中文句号；卡片对英文总评改用英文引号。
- “808 的 subbass”幻觉根除：音频引擎不再把持续低频标成 808（只标
  sustained_sub），prompt 与净化同时禁用 808/909 字样。
- 数据页国内/国外热度无数据：兼容旧版 heatScore 结构并强制补算分拆字段；
  两个热度框改为等宽居中排版。

### Changed
- Wikipedia 解析把引注 “[26]” 等、sr-only CSS、StarStarStarStar 星级评分
  统一清洗/转换为 4/5 形式。
- 版本统一 3.11.0。

## [3.10.0] - 2026-08-07

### Fixed
- 听歌指引与主界面不一致：MIR 校准后自动重新生成指引，调性/时长与“分析音频”
  框一致（Wet & Wild 实测：BPM 128.1（多源校准）/ 调性 A minor（多源校准）/
  时长 3分02秒，不再出现 3分3秒）。
- 卡片中的歌词引用不再被单引号转换破坏（“but it's just the rain” 保持原样）；
  禁止“乐评里提到/平台评分显示/媒体评价”等元描述；歌词引用必须完整成句，
  半句截断的引用会被删除。
- Step4 厂牌/年份/流派真正接入 API 校验：非手动编辑字段一律用多源共识值
  填充/覆盖；手动编辑字段保留并显示“你填 X / API校验 Y”差异提示。
- 流派不再被 RYM 输入覆盖：Step4“流派”来自 Step2 自动搜索；卡片标签改用
  RYM 手动流派 + 网络交叉验证标签（MusicBrainz/Discogs/Last.fm）优先，AI 标签兜底。

### Changed
- 热度算法重写并拆分：国内热度用 ★（网易云评论/收藏/热度分 + QQ 评论），
  国外热度用 ●（Last.fm 听众 / YouTube 播放 / Discogs 拥有+想要 / RYM 人数 /
  Genius 浏览），阈值透明（999+ 评论才到国内 ★★★，不再出现评论不过千却满星）。
- 和弦进行改为紧凑字母标注（Am-Dm-Em），并在 MIR 面板展示来源
  （Hooktheory 原页面 + 原始文本）与本地高频和弦交叉佐证。
- 一句话总评按语言生成：中文歌曲用中文（≤18 字），英文歌曲用英文（≤60 字符）。
- 卡片新增第 2 页“VERIFIED DATA”：深色封面风格 + 顶部专辑信息/分数，
  展示经核验的客观参数（BPM/调性/时长/LUFS/True Peak/LRA/Crest/立体声/
  频谱/和弦）与国内/国外热度详情、榜单信息；封面页上下留白收紧。

### Added
- `/api/heat` 端点：返回国内★/国外●分拆的热度与阈值说明。
- 卡片数据页（`cardData.dataPage`）与热度分拆渲染。

## [3.9.0] - 2026-08-07

### Added
- 每个外源 API 在各自区域显示真实状态（✅ 可用 / ○ 无数据 / ✕ 失败 /
  △ 未配置 / ○ 已定位），与 MIR 面板“数据源”一致：
  - Step2 数据研究：Wikipedia / MusicBrainz / iTunes / Last.fm / Discogs /
    AnyDecentMusic / 网易云 / YouTube / Genius 状态行；
  - 基础信息校准：网易云 / Last.fm / Genius / YouTube / MusicBrainz /
    Discogs 各自的命中字段与状态；
  - 歌词区域：LRCLIB / Genius / 网易云每次尝试的结果；
  - 封面预览：标注“封面来源”（网易云主专辑 / 研究聚合等）。
- 评分对象拆分：Step4 新增“单曲 / 专辑”选择；单曲模式下专辑评分只作背景
  支撑，词/唱维度禁止用专辑分推断，曲/编/混也要落到单曲本身；专辑模式保持
  原锚点规则。RYM / AOTY 可单独标记“单曲级 / 专辑级”。
- 卡片文本净化模块（`services/sanitize.js`）：删除 `[混音:LUFS=-7.6]` 这类
  元数据串、编辑日志用语、错误歌词引用；单曲 rationale 长度提升到 150-220 字，
  详情页文字量约占卡片版面一半。

### Fixed
- 卡片不再出现 `[混音:subbass_stereo_width=0.1]` 等面向读者的技术元数据
  （评分、自查、卡片渲染三层都清洗）。
- 括号删除后残留“ ，”这类标点前空格。
- `/api/verify-card` 自查结果也会再过一遍净化，避免元数据回流。

### Changed
- 评分 prompt：禁止在 rationale 中出现任何 [键:值] 形式字段串，要求把证据
  转述成自然听感语言；每个维度 150-220 字。
- 版本统一 3.9.0。

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
