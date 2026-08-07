# 歌掘士 M44 · 音频解析器与多源交叉核验架构（v3.27）

> 状态：verified（2026-08-07/08 本机实测）
> 原则：本地算法只能给“候选 + 置信度”，永远不能冒充外部人工/权威数据；外部来源必须先通过身份过滤，再参与共识。

## 1. 结论先行

1. **本地解析器无法达到 songbpm / hooktheory 的一致水平**，这是领域事实，不是工程偷懒：
   - BPM：librosa `beat_track` 存在经典“倍拍误差”（octave error，2× / ½×），StackOverflow / librosa issue #1263 均有大量案例；madmom、Essentia 的 tempo 估计同样需要后处理（comb filter / autocorrelation + beat interval 中位数）。
   - 调性：Krumhansl-Schmuckler / HPCP 是 MIREX 经典基线，单算法“正确率”在真实音乐上约为 70-90%，且存在 relative / parallel / chromatic 错误类型（MIREX 2019 结果页）；失真吉他、噪声铺底、密集半音装饰会造成“高相关但错误”的典型失败。
   - 和弦：自动和弦识别（ACR）在真实数据（Billboard、POP909）上的 SOTA 只有 77-80%（2025 文献），而 Hooktheory 是**人工扒谱**。本地和弦只能作为“未验证参考”。
2. **因此本项目走双轨**：
   - 本地：多算法融合 BPM、双特征调性、和弦事件，全部带置信度与“未验证”标注；
   - 外部：Hooktheory / SongBPM / MusicBrainz / Last.fm / Genius / Discogs / YouTube 等按各自能力参与 BPM、Key、时长、身份、专辑信息、热度交叉核验。

## 2. 本地解析器设计

### 2.1 BPM：三估计算法融合

- `sonara`（Rust 引擎，窗口 70-190）：主候选；
- `librosa.beat.beat_track`：次候选，但必须做倍拍检查；
- **拍间隔中位数法**：由 librosa 返回的 beat times 计算 `60 / median(diff(beats))`，以及 `60 / mean(...)`。社区经验：当 `beat_track` 的 tempo 与拍点不一致时，拍间隔中位数往往更接近真值。
- 融合规则：
  1. 所有候选先做倍拍归一（÷2 / ×2 后落入 ±3 BPM 同一簇）；
  2. 取簇内估计器数量最多者；平票时 sonara 优先；
  3. 输出 `bpm_estimators`（每个估计器的原始值与是否参与共识）、`bpm_fusion`（consensus / partial / disagree）、`bpm_octave_risk`；
  4. 本地结果只写“本地多算法共识”，不写死“置信度=真实度”。

### 2.2 调性：双特征 + 多候选

- HPCP（`chroma_cqt` + Tempered Profiles，复刻 Essentia KeyExtractor）：输出 top1 / top2 及 Pearson 相关；
- CENS（`chroma_cens` + K-S profile）：第二特征；
- 融合：
  - 两特征 top1 一致 → 提高置信；
  - 不一致 → `key_methods_disagree = true`，且若 top2 与另一特征一致，推荐 top2；
  - `parallel_mode_ambiguity`（关系大小调）、`key_ambiguity`（top1/top2 相关差 < 0.1）保留；
  - 低置信（<40）与歧义一律由前端标“低置信/需交叉验证”。

### 2.3 和弦：只做参考

- sonara `chord_events` 按段落取主导和弦 → 字母与罗马数字两种形式；
- 在 UI 固定标注“本地算法（未外部验证）”；
- 外部 Hooktheory 命中时，本地和弦仅作“同构（罗马数字一致）”佐证，不能反超。

## 3. 外部源目录（2026-08 实测）

| 源 | 提供能力 | 认证 | 实测状态 | 参与项 |
|---|---|---|---|---|
| Hooktheory 页面 | Key / Tempo / Meter / 和弦 / 风格 | 无 | ✅ `rose-gray/wet-and-wild` 返回 128 / A Minor / 4/4 / Am-Dm-Em；无 Tab 返回 404 → no_data | Key、BPM、和弦 |
| SongBPM 页面（手动 URL） | BPM / Key | 无 | ✅ `@rose-gray/wet-wild-njwcb` 返回 128 / A minor | Key、BPM |
| getsongbpm API | tempo / key_of | API Key | ❌ 2026-08 直连与代理均被 Cloudflare 403（HTML）→ 状态标 error，不伪装 no_data | Key、BPM（待恢复） |
| MusicBrainz | 录音时长 / 标题 / 艺人 / MBID | 无 | ✅ quoted 查询可定位 `Wet & Wild`，时长 182211ms 与本地一致 | 时长、身份 |
| Last.fm track.getInfo | 时长 / 听众 / 播放量 / 专辑 / 标签 | API Key | ✅ `Wet & Wild` 时长 182000ms、98K 听众 | 时长、身份、热度 |
| Genius API | 标题 / 艺人 / 专辑 / 发行日 / 歌词页 | Token | ✅ 走代理可用，`Wet & Wild` 命中；无收录歌曲返回无关结果 → no_match | 身份、专辑、歌词入口 |
| Discogs API | 专辑发行年 / 厂牌 / 风格 / have-want / 评分 | Token | ✅ `Louder, Please` master 3722568（want 697 / have 1561）；master 不直接给 rating，需 main release 的 community（样本可能很小） | 专辑信息、实体热度 |
| YouTube Data API | 官方视频播放量 / 时长 / 发布日期 | API Key | ✅ 走代理可用；视频时长 ≠ 歌曲时长（visualiser 3:36 vs 歌曲 3:02），只用于热度与身份 | 热度、身份 |
| NetEase / QQ | 评论 / 收藏 / 专辑与单曲 | 无（内部接口） | ✅ 已接线于研究管线 | 国内热度 |
| Spotify | audio-features | Premium 限制 | ⊘ 已下线（不参与） | — |

## 4. 交叉核验规则

### 4.1 身份过滤

任何外部结果在参与共识前必须通过 `_songIdentityMatches`：
- 歌曲名与艺人名做归一化（去标点、小写、去空格），双向包含即通过；
- 不通过 → `no_match`，防止上一首歌 / 同名歌污染；
- 缓存键已包含 `song` + `artist`（v3.23+）。

### 4.2 参数共识

- BPM：外部源（Hooktheory / SongBPM）与本地按 ±2 BPM 容差聚类；倍拍（0.45-0.55 / 1.9-2.1）标记 `bpm_octave_risk`；偏差 5-40% 标记 `bpm_deviation`；极差 > 8 BPM 标记 `cross_ref_disagreement`。
- Key：完全一致（同名同调式）才算共识；关系大小调、平行大小调不视为一致，但在 note 中说明。
- 时长：本地 ffprobe 与 MusicBrainz / Last.fm 对比，容差 2 秒（MB 严格），Last.fm 差异较大的在 note 里说明版本可能不同。
- 和弦：只采用外部已验证来源；本地仅作参考展示。

### 4.3 可信度报告（trust）

每个字段输出 `confidence: high / medium / low`：
- BPM / Key：外部 ≥1 源一致 → medium-high；仅本地单源 → low（即使本地算法自评很高）；
- 时长：MB 一致 → high；仅 ffprobe → medium；与外部冲突 → low；
- 和弦：外部来源 → medium；仅本地 → low；
- 前端在“数据可信度”区逐字段展示值、来源、置信度，并汇总“需人工确认”项。

## 5. 落地字段

`/api/mir-cross-ref` 返回：
- `sources[]`：`{name, status}`，status ∈ `ok / no_data / no_match / no_config / error / found / retired`；
- `recommended`：融合后的 BPM / Key / 和弦 / 置信度；
- `trust`：BPM / Key / 时长 / 和弦 的 value、sources、confidence、note；
- `local_chord_progression` / `local_chord_roman`：本地和弦（未验证）；
- `duration_check`：本地 vs 外部时长。

前端 MIR 面板逐源显示状态徽标，并展示可信度报告；不再把本地单源结果标成“network MIR 校准”。

## 6. 验证清单（每次改动必须跑）

1. `npm test` + `pytest` 全绿；
2. Wet & Wild：BPM 128±2、Key A minor（Hooktheory + SongBPM 页共识）、时长 3:02（MB + Last.fm + 本地一致）；
3. Summer Fling：BPM 127±2、Key 以外部/双特征为准、时长 4:05±2；
4. 无外部源时：所有来源显示真实状态，本地值明确标“未验证”，可信度 low。
