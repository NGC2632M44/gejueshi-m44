# Phase 27 — 解析器完善 + 多源交叉核验（v3.27.0）

日期：2026-08-07/08

## 目标

用户要求“全力完善音频解析器，达到 songbpm/hooktheory 一致水平；做不到就准确调用
API 做多信息源交叉核验并落地显示”。本阶段完成：

1. 权威调研并产出 [parser-architecture.md](../docs/parser-architecture.md)；
2. 本地解析器：BPM 多估计器融合 + 双特征调性；
3. 外部源：MIR 交叉核验新增 Last.fm / Genius，MusicBrainz 查询改进；
4. 删除听歌指引模块（用户确认无用）；
5. 可信度报告（trust）完整落地并回归。

## 已实测事实（2026-08-07 本机）

| 项 | 结果 |
|---|---|
| SongBPM API（带 Key） | 直连 200，按标题搜索 `Wet & Wild` 返回 tempo=111/key=Bm 的**同名不同歌**；艺人过滤后正确判 no_data。代理超时是常态，直连可用 |
| SongBPM 页面（手动 URL） | `@rose-gray/wet-wild-njwcb` → 128 / A minor ✅ |
| Hooktheory 页面 | `rose-gray/wet-and-wild` → 128 / A Minor / 4/4 / Am-Dm-Em ✅；`leroy/summer-fling` 404 → no_data |
| MusicBrainz quoted 查询 | `recording:"Wet & Wild" AND artist:"Rose Gray"` → 182211ms ✅ |
| Last.fm track.getInfo | Wet & Wild 182s / 98K 听众；Summer Fling 241s / 5.8K 听众 ✅ |
| Genius API（代理） | Wet & Wild 命中；Summer Fling 无收录 → no_data / 偶发超时 error |
| Discogs master | Louder, Please master 3722568（want 697 / have 1561）；master 端点无 rating，需 main release |
| YouTube Data | 官方 visualiser 播放量 354,787 / 3:36（视频时长≠歌曲时长，只用于热度） |
| Spotify | 保持 retired（需 Premium） |

## 本地解析器改动（scripts/analyze_audio.py v3.5.0）

### BPM 多估计器融合 `_fuse_bpm_estimators`

- 估计器：sonara（主）、librosa beat_track、librosa 拍间隔中位数、拍间隔均值；
- 先倍拍归一（÷2/×2 归入 70-190），再 ±3 BPM 聚类；
- sonara 与至少一个其它估计器同簇 → 采用 sonara 值（consensus）；
- sonara 孤军 / 与多数簇分歧 → 保留 sonara 并标 disagree/partial + octave_risk；
- 输出 `bpm_estimators` / `bpm_fusion` / `bpm_octave_risk`。

回归实测：
- Camera：126（sonara）✅（修复了“三票 librosa 129.2 压过 sonara 126”的回归）
- Wet & Wild：128.2 ✅（外部 128）
- Summer Fling：127.4（用户实测 127.2-127.6）✅

### 调性双特征 `_detect_key_ks`

- HPCP（chroma_cqt）+ CENS（chroma_cens）各自跑 K-S（Gómez 2006 profiles）；
- 输出 `key_methods`、`key_methods_disagree`、`key_candidates_top3`；
- 两特征一致 → 置信提升；分歧 → 前端/可信度报告标记“本地双特征分歧”。

回归实测：
- Wet & Wild：HPCP=E minor、CENS=F major（分歧）→ 外部 Hooktheory/SongBPM=A minor 覆盖，trust=medium；
- Summer Fling：HPCP=CENS=F major（一致）但 sonara=G major → 无外部源，trust=low，
  note 明确“sonara vs 本地分歧，未外部验证”。

## MIR 交叉核验改动（services/mir-cross-ref.js）

- 新增 `queryLastfmTrack`（时长/听众/播放量/专辑/标签）与 `queryGeniusSong`
  （标题/艺人/发行日/歌词页），均过身份过滤；
- MusicBrainz 改用 quoted Lucene（`recording:"..." AND artist:"..."`），
  非 200 抛出 → 状态 error（不再把超时/限流误标 no_match）；
- `sources[]` 现在覆盖 hooktheory / songbpm / musicbrainz / lastfm / genius，
  每个状态真实展示（ok / no_data / no_match / no_config / error / found）；
- 时长校验多源化：MusicBrainz（±2s）+ Last.fm（±4s），部分一致标 partial；
- `crossReference` 只统计真正提供 BPM/Key 的来源（Last.fm/Genius 不虚增源数）。

## 实测输出（真实密钥，2026-08-07）

### Wet & Wild

- sources：hooktheory ✅ / songbpm ○ 无数据（同名不同歌被艺人过滤）/ musicbrainz ○ 已定位 /
  lastfm ✅ / genius ✅
- recommended：BPM 128.1、A minor、Am-Dm-Em（Hooktheory）
- trust：bpm=medium、key=medium、duration=high（MB+Last.fm 一致）、chord=medium

### Summer Fling

- sources：hooktheory ○ / songbpm ○ / musicbrainz ○ 已定位 / lastfm ✅ / genius ○（偶发 error）
- recommended：BPM 127.4（本地）、F major（本地）——**无外部 BPM/Key 来源**
- trust：bpm=low、key=low（note 注明 sonara=G major 与本地分歧）、duration=medium（partial）、
  chord=low（本地未验证）

结论：Wet & Wild 达到“外部核验 + 落地显示”；Summer Fling 因全网无权威 BPM/Key 数据，
系统如实标注低可信并要求人工确认，不再伪装。

## 删除听歌指引

- `services/audio-analyzer.js`：删除 `generateListeningGuide` 及导出；
- `server.js`：删除 `/api/analyze/guide`；
- `public/app-v5.html`：删除 guide-box / renderGuide / 相关调用。

## 测试

- `npm test`：49 项全绿（新增 test_mir_cross_ref.js 8 项）
- `pytest`：12 项全绿（新增 BPM 融合 3 项）
- 前端 JS 语法检查通过
- HTTP 端到端：`POST /api/mir-cross-ref` 返回正确 sources/recommended/trust

## 版本

- package.json 3.26.0 → 3.27.0
- docs/parser-architecture.md 新增
