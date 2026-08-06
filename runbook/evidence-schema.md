# 五维评分证据包 Schema（Phase 4 草案，先评审后落盘）

`audioFeatures.evidence`：按五个评分维度组织的“描述性证据”，不直接换算分数。
AI 评分时引用证据键写 rationale；证据不足必须明说。

## 结构

```json
{
  "歌词": {
    "vocalness": 0.62,
    "sections": [{"start_sec": 0.0, "end_sec": 30.6, "energy": 0.46}],
    "lyrics_text": null,
    "note": "歌词文本在 Step2/Step4 提供；Step1 仅提供人声呈现与结构证据"
  },
  "作曲": {
    "bpm": 126.0,
    "key": "B major",
    "key_candidates": [["G# major", "4B", 0.78]],
    "key_ambiguity": false,
    "chord_change_rate": 1.42,
    "dissonance": 0.18,
    "chord_events": [],
    "structure_segments": []
  },
  "编曲": {
    "texture_tags": ["subbass (808)"],
    "subbass_has": true,
    "subbass_type": "808",
    "energy": 0.48,
    "spectral_centroid_mean": 2745.8
  },
  "演唱": {
    "vocalness": 0.62,
    "speechiness": null,
    "note": "未分轨时仅人声占比代理；Demucs 分轨后补充音高稳定度"
  },
  "混音": {
    "integrated_lufs": -8.9,
    "true_peak_dbtp": -0.2,
    "lra": 5.1,
    "crest_factor": 8.7,
    "stereo_width": 44.5,
    "phase_correlation_mean": 0.72,
    "subbass_stereo_width": 0.4,
    "bitrate_warning": null,
    "clipping_risk": false
  }
}
```

## 规则

1. 数值只描述事实，不评判好坏（如 LUFS -8.9 不说成“好/差”）
2. AI rationale 必须引用证据键（如 `[混音:LUFS=-8.9]`）
3. 证据缺失的维度必须注明“证据不足，基于平台评分/听感推断”
4. 混音维度按 ITU-R BS.1770-4 / EBU R128 / 平台响度惯例解释

## 来源

- 歌词：本步无文本；vocalness/sections 来自 sonara
- 作曲：bpm/key 来自引擎与交叉验证；chord/dissonance/segments 来自 sonara
- 编曲：texture_tags/subbass 来自 librosa 分析；energy 来自 sonara
- 演唱：vocalness 来自 sonara（未分轨）
- 混音：dynamics/stereo 来自 pyloudnorm + librosa
