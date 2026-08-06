# Changelog

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
