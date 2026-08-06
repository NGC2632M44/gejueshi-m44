# Phase 1 报告（2026-08-06）—— 音频引擎

## Spike（已通过，记录于 phase-1-spike.md）

## 落盘改动

`scripts/analyze_audio.py`：
- 新增 `_sniff_container()`：魔数识别真实容器，标记假 MP3（WebM/MKV 伪装成 .mp3）
- 新增 `_ffprobe_audio_meta()`：ffprobe 取真实 codec/码率/采样率（显式 UTF-8 解码）
- 新增 `_make_clean_wav()`：ffmpeg 归一化为 16bit/44100 临时 WAV（ASCII 路径）
- 新增 `_clean_json_types()`：numpy 标量/数组 → 原生 JSON 类型，替代 `default=str`
- `analyze()`：先识别容器 → 转码 → sonara 用临时 WAV + bpm 窗口 70-190 + 证据特征；
  加载与全部后续计算走统一 WAV；`audio_meta` 输出真实容器/编码/码率；
  假 MP3 输出“并非标准 MP3”警告；JSON 输出类型干净；临时文件用完即删
- 批量输出同样走 `_clean_json_types`

## 过程中发现并修复的潜伏 bug

- `bpm_method = "sonara v" + provenance`：provenance 是字典，字符串拼接抛 TypeError，
  整个 sonara 分支被 except 吞掉 → 之前 sonara 从未真正生效（一直静默回退 librosa）
- 修复：改为固定方法名，provenance 原样存入 sonara.evidence

## 依赖

- 安装 pytest 9.1.1、mutagen（冒烟：真 MP3 读取 bitrate=269164 正常）
- 未安装 demucs/spleeter/essentia（按方案默认不做）

## 测试

- `pytest scripts/test_true_peak.py scripts/test_audio_engine.py` → 9 passed
- 覆盖：容器识别、ffprobe codec、JSON 类型、Camera BPM 126±2 + 假 MP3 警告、
  Wet&Wild BPM 126-130

## 待办（后续阶段）

- sonara 的 Key 候选仍不可靠（Camera 返回 G# major），调性主判定保持 librosa KS + 外部交叉验证
- 五维证据块（sonara 特征已入库，Phase 4 组装）
