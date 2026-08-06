# Phase 1 Spike 报告（2026-08-06）

位置：`C:\Users\29346\Desktop\歌掘士_work\phase1\spike1.py`（项目外，未写入项目）

## 实测结果

1. 容器魔数识别：11 个音频文件全部正确分类
   - 4 个假 MP3（Black Balloon / Camera / Wet & Wild / The Kills）→ webm/mkv
   - 3 个真 MP3（Look-at-Her-Face / Cheap And Cheerful / Sour Cherry）→ mp3
   - 2 个 MP4、1 个 WAV 正常
2. ffprobe（UTF-8 解码）：
   - Camera 假 MP3 → codec=opus, sample_rate=48000, format=matroska,webm, bit_rate=131824
   - Look-at-Her-Face 真 MP3 → codec=mp3, bit_rate=269204
   - 注意：subprocess 必须用 `encoding="utf-8", errors="replace"`，否则 JSON 解析失败（GBK 误读 UTF-8）
3. ffmpeg 转码：假 MP3 成功转为 ASCII 临时 WAV（16bit/44100），可复现
4. sonara 用 ASCII 临时 WAV 绝对路径：Camera → BPM 125.996（正确），conf 0.73；
   key=None，候选 G# major（错误，仍需 librosa + 外部交叉）
5. JSON 类型清理函数：numpy bool/int64/float32/ndarray → 原生 JSON 类型，验证通过

## 结论

- 引擎改造方案成立：魔数识别 + ffprobe + ffmpeg 归一化 + sonara(temp wav) + _clean_json_types
- 关键坑：subprocess 调 ffprobe/ffmpeg 必须显式 UTF-8；sonara 只喂 ASCII 路径

## 下一步（RED→GREEN）

- 写 `scripts/test_audio_engine.py`（容器识别 / ffprobe / JSON 类型 / Camera 与 Wet&Wild 回归）
- 测试先红，再改 analyze_audio.py
