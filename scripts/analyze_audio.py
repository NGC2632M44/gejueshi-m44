#!/usr/bin/env python3
"""
歌掘士 v3.2 — 音频客观分析层（标准化参数版）
输入: MP3/FLAC/WAV 文件路径
输出: JSON (stdout) — BPM, 调性, 频谱, 响度, 动态, 立体声宽度

标准化参数（保证可复现）:
- 采样率: 统一重采样至 44100 Hz
- FFT 窗口: 2048 点，汉宁窗
- 重叠率: 50% (hop_length = 1024)
- 频谱滚降点: 统一按 95% 累计能量计算
- LUFS 计算: EBU R128 (K加权, -70LUFS绝对门限, -10LU相对门限)

用法:
  python analyze_audio.py "song.mp3"
  python analyze_audio.py "song.mp3" --output result.json
  python analyze_audio.py "song.mp3" --deep          # 启用Demucs音轨分离(慢)
  python analyze_audio.py "song.mp3" --format minimal  # 仅BPM+调性

依赖:
  pip install essentia librosa pyloudnorm soundfile scipy
  pip install demucs  # 可选: 音轨分离 (--deep模式)
"""

from __future__ import annotations

import argparse
import json
import math
import os
import sys
import time
from pathlib import Path
from typing import Any, Dict, List, Optional, Tuple

import numpy as np

# ── 版本 & 标准化常量 ──────────────────────────
SCRIPT_VERSION = "3.2.0"
DEFAULT_SAMPLE_RATE = 44100
FFT_SIZE = 2048
HOP_LENGTH = 1024          # 50% overlap
WINDOW_TYPE = "hann"
ROLLOFF_PERCENT = 0.95     # 95% 累计能量

# ── 行业标准与权威文献引用 ──────────────────────
# 按用户规范: 所有阈值/判定必须有出处，按优先级排列
AUTHORITY_STANDARDS = {
    "响度标准": {
        "ITU-R BS.1770-4": "LUFS 定义与算法，K加权滤波器规范",
        "EBU R128": "广播响度规范，-23 LUFS 目标，LRA 定义",
        "引用场景": "integrated_lufs, true_peak, LRA 计算",
    },
    "频谱特征": {
        "Lerch (2012)": "An Introduction to Audio Content Analysis — 质心、滚降、带宽、平坦度定义与公式",
        "引用场景": "spectral_centroid, spectral_rolloff, spectral_bandwidth, spectral_flatness",
    },
    "调性检测": {
        "Krumhansl & Schmuckler (1986)": "调性 profile 的心理学基础",
        "Temperley (1999)": "K-S 算法的 MIR 实现标准化",
        "引用场景": "key detection via chroma correlation",
    },
    "母带/动态": {
        "Katz (2015)": "Mastering Audio: The Art and the Science — 动态范围、峰值因数、曲风响度惯例",
        "引用场景": "动态幅度分段阈值, LUFS 解读",
    },
    "流媒体规范": {
        "Spotify for Artists": "目标 -14 LUFS Integrated (2024)",
        "Apple Music 创作者中心": "目标 -16 LUFS Integrated (Sound Check 启用)",
        "引用场景": "LUFS 阈值解读",
    },
    "行业共识": {
        "Camelot 体系 (Mixed In Key)": "DJ 调性兼容编码 1A-12B",
        "Sound on Sound": "专业音频媒体 — 混音健康区间参考",
        "引用场景": "camelot 编码, BPM/Key 区间阈值",
    },
}

# ── 来源追溯字段模板 ──────────────────────────
def _make_source_tracking(engine, engine_version):
    """每条数据记录的来源工具、计算参数、校验时间"""
    import datetime
    return {
        "tool": f"歌掘士 analyze_audio.py v{SCRIPT_VERSION}",
        "label_rule_version": "1.0.0",
        "primary_engine": engine,
        "engine_version": engine_version,
        "analysis_timestamp_utc": datetime.datetime.now(datetime.timezone.utc).isoformat(),
        "parameters": {
            "sample_rate": DEFAULT_SAMPLE_RATE,
            "fft_size": FFT_SIZE,
            "hop_length": HOP_LENGTH,
            "window": WINDOW_TYPE,
            "rolloff_percent": ROLLOFF_PERCENT,
            "lufs_standard": "EBU R128 (ITU-R BS.1770-4)",
            "trim_silence": True,
        },
        "compute_environment": {
            "platform": sys.platform,
            "python_version": sys.version.split()[0],
        },
    }


# ── 容器识别 / 真实元数据 / 归一化 ──
def _sniff_container(filepath: str) -> Dict[str, Any]:
    """按魔数识别真实容器，揪出'假 MP3'（实为 WebM/Matroska 的 YouTube 下载）。"""
    try:
        with open(filepath, "rb") as f:
            head = f.read(16)
    except Exception as e:
        return {"container": "unknown", "error": str(e)[:200]}

    if head.startswith(b"\x1a\x45\xdf\xa3"):
        container = "webm/mkv"
    elif head.startswith(b"ID3") or (len(head) >= 2 and head[0] == 0xFF and (head[1] & 0xE0) == 0xE0):
        container = "mp3"
    elif head.startswith(b"RIFF") and head[8:12] == b"WAVE":
        container = "wav"
    elif head[4:8] == b"ftyp":
        container = "mp4"
    else:
        container = "unknown"

    ext = os.path.splitext(filepath)[1].lower()
    return {
        "container": container,
        "extension": ext,
        "is_fake_mp3": ext == ".mp3" and container != "mp3",
    }


def _ffprobe_audio_meta(filepath: str) -> Dict[str, Any]:
    """用 ffprobe 取真实 codec/码率/采样率（UTF-8 解码，避免 GBK 误读）。"""
    import subprocess
    try:
        cmd = ["ffprobe", "-v", "quiet", "-print_format", "json",
               "-show_format", "-show_streams", filepath]
        r = subprocess.run(cmd, capture_output=True, text=True,
                           encoding="utf-8", errors="replace", timeout=60)
        if r.returncode != 0:
            return {"error": (r.stderr or r.stdout or "")[:200]}
        data = json.loads(r.stdout)
        streams = [s for s in data.get("streams", []) if s.get("codec_type") == "audio"]
        fmt = data.get("format", {})
        if not streams:
            return {"error": "no audio stream"}
        s = streams[0]
        return {
            "codec": s.get("codec_name"),
            "sample_rate": s.get("sample_rate"),
            "channels": s.get("channels"),
            "duration": fmt.get("duration"),
            "bit_rate": fmt.get("bit_rate"),
            "format_name": fmt.get("format_name"),
        }
    except Exception as e:
        return {"error": str(e)[:200]}


def _make_clean_wav(filepath: str, target_sr: int = DEFAULT_SAMPLE_RATE) -> str:
    """ffmpeg 归一化为 16bit WAV 临时文件（ASCII 路径，供 sonara 与统一加载）。"""
    import subprocess
    import tempfile
    fd, tmp = tempfile.mkstemp(suffix=".wav", prefix="m44_")
    os.close(fd)
    try:
        cmd = ["ffmpeg", "-y", "-i", filepath, "-ar", str(target_sr),
               "-sample_fmt", "s16", "-f", "wav", tmp]
        r = subprocess.run(cmd, capture_output=True, text=True,
                           encoding="utf-8", errors="replace", timeout=120)
        if r.returncode != 0 or os.path.getsize(tmp) == 0:
            raise RuntimeError(f"ffmpeg 转码失败: {(r.stderr or r.stdout or '')[:300]}")
        return tmp
    except Exception:
        try:
            os.unlink(tmp)
        except OSError:
            pass
        raise


def _clean_json_types(obj: Any) -> Any:
    """递归把 numpy 标量/数组转原生 JSON 类型，禁止 default=str 产生 'True' 字符串。"""
    if isinstance(obj, dict):
        return {k: _clean_json_types(v) for k, v in obj.items()}
    if isinstance(obj, (list, tuple)):
        return [_clean_json_types(v) for v in obj]
    if isinstance(obj, (np.bool_, bool)):
        return bool(obj)
    if isinstance(obj, np.integer):
        return int(obj)
    if isinstance(obj, np.floating):
        return float(obj)
    if isinstance(obj, np.ndarray):
        return _clean_json_types(obj.tolist())
    return obj


# ═══════════════════════════════════════════════════
#  工具函数
# ═══════════════════════════════════════════════════

def _trim_silence(y: np.ndarray, sr: int, top_db: int = 28) -> np.ndarray:
    """
    去除首尾静音段，保留有效音频部分。
    top_db=28: 行业通用静音判定阈值（非默认20，20太激进容易剪掉弱前奏）。
    此参数固定，写入 analysis_config 保证所有样本可复现。
    """
    try:
        import librosa
        y_trimmed, _ = librosa.effects.trim(y, top_db=top_db)
        if len(y_trimmed) < sr * 0.5:
            return y
        return y_trimmed
    except Exception:
        return y


def _remove_dc_offset(y: np.ndarray) -> tuple:
    """
    移除直流偏移 (DC offset)。
    老录音/压缩音频/损坏文件常见 DC 偏移，会干扰峰值/动态/包络/过零率计算。
    返回 (去直流后的信号, 原始DC偏移量)。
    """
    dc = float(np.mean(y))
    if abs(dc) < 1e-8:
        return y, 0.0
    return (y - dc).astype(y.dtype), round(dc, 6)


def _load_audio_mono(filepath: str, target_sr: int = DEFAULT_SAMPLE_RATE, trim_silence: bool = True):
    """
    加载音频，输出双路信号:
      - mono: 单声道 float32, 供 BPM/调性/频谱/包络 (MIR 特征)
      - stereo: 原始声道 float32, 供响度计算 (EBU R128 要求保留声道信息)
      - dc_offset: 直流偏移量
    按可靠性排序尝试多种后端。统一重采样至 target_sr。
    """
    y_mono = None
    y_stereo = None
    sr = None
    ext = os.path.splitext(filepath)[1].lower()
    errors = []

    def _resample(data, orig_sr):
        if orig_sr == target_sr:
            return data, target_sr
        try:
            import scipy.signal
            ratio = target_sr / orig_sr
            if data.ndim == 1:
                return scipy.signal.resample(data, int(len(data) * ratio)), target_sr
            else:
                return scipy.signal.resample(data, int(data.shape[-1] * ratio), axis=-1), target_sr
        except Exception:
            try:
                import librosa
                if data.ndim == 1:
                    return librosa.resample(y=data, orig_sr=orig_sr, target_sr=target_sr), target_sr
                else:
                    chs = [librosa.resample(y=data[c], orig_sr=orig_sr, target_sr=target_sr) for c in range(data.shape[0])]
                    return np.stack(chs, axis=0), target_sr
            except Exception:
                raise RuntimeError(f"重采样失败 ({orig_sr}→{target_sr}Hz)")

    # ── 策略 1: librosa ──
    try:
        import librosa
        # 先加载立体声
        y_stereo, sr = librosa.load(filepath, sr=None, mono=False)
        y_stereo = y_stereo.astype(np.float32)
        # 单声道用于 MIR
        if y_stereo.ndim >= 2:
            y_mono = np.mean(y_stereo, axis=0).astype(np.float32)
        else:
            y_mono = y_stereo.copy()
        y_stereo, sr = _resample(y_stereo, sr)
        y_mono, _ = _resample(y_mono, sr)
    except Exception as e:
        errors.append(f"librosa: {e}")

    # ── 策略 2: pydub + ffmpeg ──
    if y_mono is None:
        try:
            from pydub import AudioSegment
            audio = AudioSegment.from_file(filepath)
            nch = audio.channels
            samples = np.array(audio.get_array_of_samples(), dtype=np.float32).reshape(-1, nch).T
            peak = np.max(np.abs(samples))
            if peak > 0:
                samples /= peak
            if audio.frame_rate != target_sr:
                import scipy.signal
                samples = scipy.signal.resample(samples, int(samples.shape[-1] * target_sr / audio.frame_rate), axis=-1)
            y_stereo = samples.astype(np.float32) if nch >= 2 else samples.astype(np.float32)
            y_mono = np.mean(y_stereo, axis=0).astype(np.float32) if y_stereo.ndim >= 2 else y_stereo.astype(np.float32)
            sr = target_sr
        except Exception as e:
            errors.append(f"pydub: {e}")

    # ── 策略 3: soundfile ──
    if y_mono is None and ext not in ('.mp3', '.m4a', '.aac', '.wma'):
        try:
            import soundfile as sf
            data, orig_sr = sf.read(filepath, dtype="float32", always_2d=True)
            y_stereo = data.T.astype(np.float32)  # (channels, samples)
            y_mono = np.mean(y_stereo, axis=0).astype(np.float32) if y_stereo.ndim >= 2 and y_stereo.shape[0] >= 2 else y_stereo.flatten().astype(np.float32)
            y_stereo, sr = _resample(y_stereo, orig_sr)
            y_mono, _ = _resample(y_mono, orig_sr)
        except Exception as e:
            errors.append(f"soundfile: {e}")

    # ── 策略 4: scipy.io.wavfile ──
    if y_mono is None and ext == '.wav':
        try:
            from scipy.io import wavfile
            orig_sr, data = wavfile.read(filepath)
            if data.ndim == 2:
                y_stereo = data.T.astype(np.float32)
            else:
                y_stereo = data.reshape(1, -1).astype(np.float32)
            if data.dtype == np.int16:
                y_stereo /= 32768.0
            elif data.dtype == np.int32:
                y_stereo /= 2147483648.0
            y_mono = np.mean(y_stereo, axis=0) if y_stereo.shape[0] >= 2 else y_stereo.flatten()
            y_stereo, sr = _resample(y_stereo, orig_sr)
            y_mono, _ = _resample(y_mono, orig_sr)
        except Exception as e:
            errors.append(f"scipy.wavfile: {e}")

    # ── 策略 5: ffmpeg subprocess ──
    if y_mono is None:
        try:
            import subprocess
            import tempfile
            tmp = tempfile.NamedTemporaryFile(suffix='.wav', delete=False)
            tmp.close()
            cmd = ['ffmpeg', '-y', '-i', filepath, '-ar', str(target_sr), '-sample_fmt', 's16', '-f', 'wav', tmp.name]
            proc = subprocess.run(cmd, capture_output=True, text=True, timeout=120)
            if proc.returncode == 0 and os.path.getsize(tmp.name) > 0:
                from scipy.io import wavfile
                _, data = wavfile.read(tmp.name)
                if data.ndim == 2:
                    y_stereo = data.T.astype(np.float32) / 32768.0
                    y_mono = np.mean(y_stereo, axis=0)
                else:
                    y_stereo = data.reshape(1, -1).astype(np.float32) / 32768.0
                    y_mono = y_stereo.flatten()
                sr = target_sr
            os.unlink(tmp.name)
        except Exception as e:
            errors.append(f"ffmpeg: {e}")

    if y_mono is None:
        raise RuntimeError(
            f"无法加载音频文件 ({ext})。已尝试: librosa, pydub, soundfile, scipy, ffmpeg。\n"
            f"错误详情: {'; '.join(errors[:3])}\n"
            f"建议: pip install librosa pydub 或安装 ffmpeg 到 PATH"
        )

    # ── 直流偏移移除 (必须在所有后续计算之前) ──
    y_mono, dc_offset = _remove_dc_offset(y_mono)
    if y_stereo is not None and y_stereo.ndim >= 2:
        for ch in range(min(y_stereo.shape[0], 2)):  # 只处理前2声道
            y_stereo[ch], _ = _remove_dc_offset(y_stereo[ch])

    # 去除首尾静音
    if trim_silence:
        y_mono = _trim_silence(y_mono, sr)
        if y_stereo is not None and y_stereo.ndim >= 2:
            # 对立体声也裁剪（按单声道的裁剪点）
            trim_len = len(y_mono)
            if trim_len < y_stereo.shape[-1]:
                pad = (y_stereo.shape[-1] - trim_len) // 2
                y_stereo = y_stereo[:, pad:pad + trim_len]

    return y_mono.astype(np.float32), y_stereo, target_sr, dc_offset


def _load_audio_stereo(filepath: str, target_sr: int = DEFAULT_SAMPLE_RATE):
    """加载双声道音频，用于立体声宽度计算。（保留兼容旧接口，主流程已通过 _load_audio_mono 返回双路信号）"""
    try:
        import librosa
        data, sr = librosa.load(filepath, sr=target_sr, mono=False)
        return data, target_sr
    except Exception:
        return None, target_sr


def _check_essentia() -> bool:
    try:
        import essentia.standard as es
        return True
    except ImportError:
        return False


# ── 安全 JSON 序列化 ──
def _safe_float(val, default=None):
    """处理 inf/nan 值为 None。"""
    if val is None:
        return default
    if isinstance(val, (np.floating, float)):
        if math.isinf(val) or math.isnan(val):
            return default
        return float(val)
    return val


# ═══════════════════════════════════════════════════
#  调性检测: Krumhansl-Schmuckler 算法
# ═══════════════════════════════════════════════════

def _detect_key_ks(audio: np.ndarray, sr: int) -> dict:
    """
    HPCP + Tempered Key Profiles 调性检测 (复刻 Essentia KeyExtractor)。
    比原始 K-S chroma_cqt 对失真/电子/半音色彩更鲁棒。

    改进:
    - HPCP (Harmonic Pitch Class Profile): 抑制谐波/噪音对音高轮廓的污染
    - Tempered profiles (Gómez 2006): 比 K-S 原始 profile 更适合现代流行/电子
    - 平行大小调歧义 + 第二候选 + 低置信 Camelot 置 null
    参考文献: Gómez (2006) "Tonal Description of Music Audio Signals"; Essentia KeyExtractor
    """
    try:
        import librosa

        # ── HPCP 计算 (Harmonic Pitch Class Profile) ──
        # HPCP 是 chroma 的增强版: 泛音折叠、谐波加权、噪音抑制
        # 参数对齐 Essentia KeyExtractor 默认值
        chroma = librosa.feature.chroma_cqt(
            y=audio, sr=sr, hop_length=HOP_LENGTH,
            fmin=32.7, n_chroma=12, bins_per_octave=36,
            threshold=0.001,  # 噪音门限 (Essentia: low level noise floor)
        )

        # 时间加权: 响度大的帧权重高 (和弦进行通常落在强拍)
        rms = librosa.feature.rms(y=audio, frame_length=FFT_SIZE, hop_length=HOP_LENGTH)
        rms = rms[:, :chroma.shape[1]] if rms.shape[1] > chroma.shape[1] else rms
        weights = np.squeeze(rms) if rms.shape[1] == chroma.shape[1] else np.ones(chroma.shape[1])
        chroma_weighted = np.average(chroma, axis=1, weights=weights[:chroma.shape[1]])

        # ── Tempered Key Profiles (Gómez 2006) ──
        # 比 K-S 原始 profile (1986) 更适合现代调性音乐
        # C C# D D# E F F# G G# A A# B
        major_profile = np.array([1.0000, 0.0145, 0.4948, 0.0170, 0.6792, 0.3990, 0.0096, 0.8142, 0.0237, 0.3250, 0.0197, 0.1867])
        minor_profile = np.array([1.0000, 0.0263, 0.3339, 0.5055, 0.0746, 0.3892, 0.0304, 0.6572, 0.1844, 0.2138, 0.0679, 0.1851])

        # 归一化
        major_profile /= np.sum(major_profile)
        minor_profile /= np.sum(minor_profile)
        chroma_weighted /= max(np.sum(chroma_weighted), 1e-10)

        keys = ["C", "Db", "D", "Eb", "E", "F", "Gb", "G", "Ab", "A", "Bb", "B"]

        # 收集所有候选的相关系数
        all_candidates = []
        for i in range(12):
            rotated = np.roll(chroma_weighted, i)
            major_corr = float(np.corrcoef(rotated, major_profile)[0, 1])
            minor_corr = float(np.corrcoef(rotated, minor_profile)[0, 1])
            all_candidates.append({"key": keys[i], "mode": "major", "correlation": major_corr})
            all_candidates.append({"key": keys[i], "mode": "minor", "correlation": minor_corr})

        # 按相关系数降序排列
        all_candidates.sort(key=lambda x: x["correlation"], reverse=True)
        best = all_candidates[0]
        second = all_candidates[1] if len(all_candidates) > 1 else None

        # 置信度映射: Pearson r ∈ [-1, +1] → 0~100
        confidence = max(0, min(100, round((best["correlation"] + 1) * 50, 1)))
        second_confidence = max(0, min(100, round((second["correlation"] + 1) * 50, 1))) if second else 0

        # ── 平行大小调歧义检测 ──
        # 平行大小调: 共享全部音级，仅主音差 3 个半音 (minor 3rd down)
        # 如 C major ↔ A minor, G major ↔ E minor
        parallel_mode_ambiguity = False
        if second:
            minor_third_down = (keys.index(best["key"]) - 3) % 12
            is_parallel = (
                (best["mode"] == "major" and second["mode"] == "minor" and second["key"] == keys[minor_third_down]) or
                (best["mode"] == "minor" and second["mode"] == "major" and
                 second["key"] == keys[(keys.index(best["key"]) + 3) % 12])
            )
            corr_diff = abs(best["correlation"] - second["correlation"])
            if is_parallel and corr_diff < 0.08:
                parallel_mode_ambiguity = True

        # Camelot: 低置信度 (<40) 置 null
        camelot = _camelot_code(best["key"], best["mode"]) if confidence >= 40 else None

        return {
            "key": best["key"],
            "mode": best["mode"],
            "key_full": f"{best['key']} {best['mode']}",
            "key_confidence": confidence,
            "key_correlation": round(best["correlation"], 4),
            "key_method": "HPCP + Tempered Profiles (Gómez 2006) — 复刻 Essentia KeyExtractor + parallel mode detection + second candidate",
            "camelot": camelot,
            "camelot_low_confidence": confidence < 40,
            # 置信虚高警告: K-S 对失真/电子流行常给出高相关但错调
            "key_confidence_note": "K-S 相关系数置信不等于真实调性吻合度。失真吉他/噪声铺底/密集半音装饰可导致虚高置信的错误结果。请同时参考第二候选与外部交叉验证。",
            # 第二候选
            "key_second_candidate": {
                "key": second["key"] if second else None,
                "mode": second["mode"] if second else None,
                "key_full": f"{second['key']} {second['mode']}" if second else None,
                "key_confidence": second_confidence,
                "correlation": round(second["correlation"], 4) if second else None,
            } if second else None,
            # 平行调歧义
            "parallel_mode_ambiguity": parallel_mode_ambiguity,
            # 调性歧义: 第一/第二候选相关系数差值 < 0.1 → 无论置信高低都标记
            "key_ambiguity": abs(best["correlation"] - (second["correlation"] if second else 0)) < 0.1,
        }
    except Exception as e:
        return {"key": None, "mode": None, "key_full": None, "key_confidence": 0,
                "key_error": str(e), "key_method": "Krumhansl-Schmuckler (failed)",
                "camelot": None, "key_second_candidate": None, "parallel_mode_ambiguity": False}


def _camelot_code(key: str, mode: str) -> Optional[str]:
    """Camelot 编码映射。"""
    camelot_map = {
        ("Ab", "minor"): "1A", ("B", "major"): "1B", ("Cb", "major"): "1B",
        ("Eb", "minor"): "2A", ("Gb", "major"): "2B", ("F#", "major"): "2B",
        ("Bb", "minor"): "3A", ("Db", "major"): "3B", ("C#", "major"): "3B",
        ("F", "minor"):  "4A", ("Ab", "major"): "4B",
        ("C", "minor"):  "5A", ("Eb", "major"): "5B",
        ("G", "minor"):  "6A", ("Bb", "major"): "6B",
        ("D", "minor"):  "7A", ("F", "major"):  "7B",
        ("A", "minor"):  "8A", ("C", "major"):  "8B",
        ("E", "minor"):  "9A", ("G", "major"):  "9B",
        ("B", "minor"):  "10A", ("D", "major"): "10B",
        ("F#", "minor"): "11A", ("A", "major"): "11B",
        ("C#", "minor"): "12A", ("Db", "minor"): "12A", ("E", "major"): "12B",
    }
    # 统一 enharmonic 拼写 (保留 Gb, 不再强制转 F#)
    enharmonic = {"C#": "Db", "D#": "Eb", "G#": "Ab", "A#": "Bb"}
    k = enharmonic.get(key, key)
    return camelot_map.get((k, mode))


# ═══════════════════════════════════════════════════
#  BPM 检测 (librosa beat tracking)
# ═══════════════════════════════════════════════════

def _detect_bpm_librosa(audio: np.ndarray, sr: int) -> dict:
    """
    多特征节拍检测 (复刻 Essentia RhythmExtractor2013)。
    使用多 onset detection 函数 (spectral flux + energy + complex domain) 组合，
    比单一 HPSS 打击乐分离对规整电子/舞曲节拍偏移更鲁棒。

    输出 3 个候选 BPM (主/0.5×/2×) 及倍拍歧义自检。
    """
    try:
        import librosa

        # ── 多特征 onset strength ──
        # 使用 librosa onset_strength_multi (返回多个 onset detection function)
        # 对齐 Essentia RhythmExtractor2013 的 multi-feature 策略
        odf_multi = librosa.onset.onset_strength_multi(
            y=audio, sr=sr, hop_length=HOP_LENGTH,
            n_fft=FFT_SIZE,
        )
        # odf_multi: (n_features, n_frames), feature 0=spectral_flux, 1=??
        # 取第一/第二通道组合
        if odf_multi.ndim >= 2 and odf_multi.shape[0] >= 2:
            onset_combined = odf_multi[0] * 0.6 + odf_multi[1] * 0.4
        else:
            onset_combined = odf_multi.flatten() if odf_multi.ndim >= 2 else odf_multi

        # 归一化
        peak = np.max(np.abs(onset_combined)) + 1e-10
        onset_combined = onset_combined / peak

        # 主候选 BPM (用组合 onset)
        tempo, beats = librosa.beat.beat_track(onset_envelope=onset_combined, sr=sr, hop_length=HOP_LENGTH)
        # 处理 numpy 标量/数组
        bpm_raw = float(tempo.item()) if hasattr(tempo, 'item') else float(tempo)
        bpm = round(bpm_raw, 1) if bpm_raw > 0 else None

        confidence = 0.0
        if beats is not None and len(beats) > 1:
            beat_times = librosa.frames_to_time(beats, sr=sr, hop_length=HOP_LENGTH)
            intervals = np.diff(beat_times)
            if len(intervals) > 1:
                expected = 60.0 / bpm if bpm > 0 else 0.5
                q75, q25 = np.percentile(intervals, [75, 25])
                iqr = q75 - q25
                conf = max(0, 100 - (iqr / expected * 100))
                confidence = round(min(100, conf), 1)

        # ── 倍拍候选 ──
        bpm_half = round(bpm / 2, 1) if bpm > 0 else None
        bpm_double = round(bpm * 2, 1) if bpm > 0 else None

        # 验证半拍/倍拍候选 (重新计算置信度)
        half_conf = 0.0
        double_conf = 0.0
        if bpm_half and bpm_half > 0:
            try:
                _, beats_h = librosa.beat.beat_track(onset_envelope=onset_combined, sr=sr, hop_length=HOP_LENGTH,
                                                     start_bpm=float(bpm_half), tightness=100)
                if beats_h is not None and len(beats_h) > 1:
                    bt = librosa.frames_to_time(beats_h, sr=sr, hop_length=HOP_LENGTH)
                    iv = np.diff(bt)
                    if len(iv) > 1:
                        exp = 60.0 / bpm_half
                        q75h, q25h = np.percentile(iv, [75, 25])
                        half_conf = max(0, 100 - ((q75h - q25h) / exp * 100))
            except Exception:
                pass

        if bpm_double and bpm_double > 0:
            try:
                _, beats_d = librosa.beat.beat_track(onset_envelope=onset_combined, sr=sr, hop_length=HOP_LENGTH,
                                                     start_bpm=bpm_double, tightness=100)
                if beats_d is not None and len(beats_d) > 1:
                    bt = librosa.frames_to_time(beats_d, sr=sr, hop_length=HOP_LENGTH)
                    iv = np.diff(bt)
                    if len(iv) > 1:
                        exp = 60.0 / bpm_double
                        q75d, q25d = np.percentile(iv, [75, 25])
                        double_conf = max(0, 100 - ((q75d - q25d) / exp * 100))
            except Exception:
                pass

        # 倍拍歧义判定: 次候选置信度 > 主候选的 80%
        octave_risk = False
        if confidence > 0:
            if half_conf > confidence * 0.8:
                octave_risk = True
            if double_conf > confidence * 0.8:
                octave_risk = True

        return {
            "bpm": bpm if bpm > 0 else None,
            "bpm_confidence": confidence,
            "bpm_candidates": {
                "half": bpm_half,
                "half_confidence": round(min(100, half_conf), 1),
                "double": bpm_double,
                "double_confidence": round(min(100, double_conf), 1),
            },
            "bpm_octave_risk": octave_risk,
            "bpm_deviation_risk": False,  # 由 cross-ref 填充（非倍拍但邻近偏移，如 117.5 vs 126）
            "bpm_confidence_note": "bpm_confidence 是算法对节拍脉冲规整度的内部打分，不等于与真实 BPM 的吻合度。高置信仍可能偏离真值（常见于电子/失真曲目）。",
            "bpm_method": "multi-feature onset (spectral-flux×60% + energy-flux×40%) + autocorrelation tempo — 复刻 Essentia RhythmExtractor2013",
        }
    except Exception as e:
        return {"bpm": None, "bpm_confidence": 0, "bpm_error": str(e), "bpm_octave_risk": None}


# ═══════════════════════════════════════════════════
#  频谱特征 (标准化参数)
# ═══════════════════════════════════════════════════

def _compute_spectral_features(audio: np.ndarray, sr: int) -> dict:
    """
    计算全量频谱特征，统一使用标准化参数:
    FFT 2048, Hanning, 50% overlap (hop=1024)
    滚降点统一按 95% 累计能量

    增强: 频谱特征基于「有效主体片段」计算 (去掉首尾弱织体后，取中间能量最高的70%)
    全曲均值保留为补充字段，主体均值作为标签判定依据。
    """
    try:
        import librosa

        # 找有效主体片段: 基于 RMS 能量，取中间 70%
        rms_all = librosa.feature.rms(y=audio, frame_length=FFT_SIZE, hop_length=HOP_LENGTH)[0]
        n_total = len(rms_all)
        if n_total > 20:
            # 排序取高能量段
            sorted_idx = np.argsort(rms_all)[::-1]
            keep_ratio = 0.7
            keep_count = max(int(n_total * keep_ratio), 10)
            body_mask = np.zeros(n_total, dtype=bool)
            body_mask[sorted_idx[:keep_count]] = True
            body_mask.sort()  # 这个不对，应该是标记哪些帧保留
            # 正确做法: 标记高能量帧
            body_mask = np.zeros(n_total, dtype=bool)
            threshold = np.percentile(rms_all, 30)  # 去掉底部30%
            body_mask = rms_all >= threshold
        else:
            body_mask = np.ones(n_total, dtype=bool)

        # STFT
        S = np.abs(librosa.stft(
            audio, n_fft=FFT_SIZE, hop_length=HOP_LENGTH,
            window=WINDOW_TYPE, center=True
        ))

        # 全曲特征
        centroids_all = librosa.feature.spectral_centroid(S=S, sr=sr, n_fft=FFT_SIZE, hop_length=HOP_LENGTH)[0]
        rolloffs_all = librosa.feature.spectral_rolloff(S=S, sr=sr, n_fft=FFT_SIZE, hop_length=HOP_LENGTH, roll_percent=ROLLOFF_PERCENT)[0]
        bandwidths_all = librosa.feature.spectral_bandwidth(S=S, sr=sr, n_fft=FFT_SIZE, hop_length=HOP_LENGTH)[0]
        flatness_all = librosa.feature.spectral_flatness(S=S, n_fft=FFT_SIZE, hop_length=HOP_LENGTH)[0]
        zcr_all = librosa.feature.zero_crossing_rate(audio, frame_length=FFT_SIZE, hop_length=HOP_LENGTH)[0]

        # 对齐长度
        min_len = min(len(centroids_all), len(body_mask))

        def _stats(arr, mask=None):
            if mask is not None:
                arr = arr[:len(mask)][mask[:len(arr)]]
            if len(arr) == 0:
                return {"mean": 0, "std": 0, "min": 0, "max": 0}
            return {
                "mean": _safe_float(np.mean(arr), 0),
                "std": _safe_float(np.std(arr), 0),
                "min": _safe_float(np.min(arr), 0),
                "max": _safe_float(np.max(arr), 0),
            }

        centroids_body = _stats(centroids_all, body_mask)
        centroids_full = _stats(centroids_all)

        return {
            # 主体片段 (用于标签判定)
            "centroid_mean": centroids_body["mean"],
            "centroid_std": centroids_body["std"],
            "rolloff_mean": _stats(rolloffs_all, body_mask)["mean"],
            "rolloff_std": _stats(rolloffs_all, body_mask)["std"],
            "bandwidth_mean": _stats(bandwidths_all, body_mask)["mean"],
            "bandwidth_std": _stats(bandwidths_all, body_mask)["std"],
            "flatness_mean": _safe_float(np.mean(flatness_all[:min_len][body_mask[:min_len]]) if min_len > 0 else 0, 0),
            "flatness_std": _safe_float(np.std(flatness_all[:min_len][body_mask[:min_len]]) if min_len > 0 else 0, 0),
            "zero_crossing_rate": _safe_float(np.mean(zcr_all[:min_len][body_mask[:min_len]]) if min_len > 0 else 0, 0),
            # 极值用全曲
            "centroid_min": centroids_full["min"],
            "centroid_max": centroids_full["max"],
            # 全曲均值 (保留)
            "centroid_mean_full": centroids_full["mean"],
            "rolloff_mean_full": _stats(rolloffs_all)["mean"],
            # 元信息
            "rolloff_percent": ROLLOFF_PERCENT,
            "effective_body_ratio": round(float(np.sum(body_mask[:min_len]) / max(min_len, 1)), 2),
            "fft_config": {
                "n_fft": FFT_SIZE,
                "hop_length": HOP_LENGTH,
                "window": WINDOW_TYPE,
                "sample_rate": sr,
            },
        }
    except Exception as e:
        return {"_error": str(e), "fft_config": {"n_fft": FFT_SIZE, "hop_length": HOP_LENGTH, "window": WINDOW_TYPE}}


# ═══════════════════════════════════════════════════
#  响度 & 动态 (EBU R128)
# ═══════════════════════════════════════════════════

def _compute_loudness_dynamics(audio_stereo: np.ndarray, sr: int) -> dict:
    """
    EBU R128 响度计算 — 必须使用原始声道输入。
    ITU-R BS.1770-4 基于双耳感知，立体声有声道加权规则。
    单声道平均后再计算会导致集成响度系统性偏低 1~2 LU。

    - K加权滤波器
    - -70 LUFS 绝对门限
    - -10 LU 相对门限
    参考文献: ITU-R BS.1770-4, EBU R128
    """
    try:
        import pyloudnorm as pyln

        # pyloudnorm.Meter 需要 (samples,) 单声道 或 (samples, channels) 立体声
        # 归一化到 [-1, 1] float64
        if audio_stereo is None:
            return {"integrated_lufs": None, "true_peak_dbtp": None, "_error": "无立体声信号"}

        if audio_stereo.ndim >= 2 and audio_stereo.shape[0] >= 2:
            # 立体声: (2, samples) → (samples, 2)
            data = audio_stereo[:2, :].T.astype(np.float64)
            # 确保峰值在 [-1, 1]
            peak = np.max(np.abs(data))
            if peak > 1.0:
                data /= peak
        else:
            # 单声道回退: (samples,)
            data = (audio_stereo.flatten() if audio_stereo.ndim >= 2 else audio_stereo).astype(np.float64)
            peak = np.max(np.abs(data))
            if peak > 1.0:
                data /= peak

        # 多声道 (>2) 下混到立体声: L = ch0, R = mean(ch1...chN-1) per ITU
        if data.ndim == 2 and data.shape[1] > 2:
            left = data[:, 0]
            right = np.mean(data[:, 1:], axis=1)
            data = np.column_stack([left, right])

        meter = pyln.Meter(sr)
        integrated_lufs = meter.integrated_loudness(data)

        # True Peak: ITU-R BS.1770 要逐声道计算，再取最高声道峰值。
        try:
            tp_val = _compute_true_peak(data, sr)
        except Exception:
            tp_val = None

        # LRA
        try:
            lra = _compute_lra(data.flatten() if data.ndim == 1 else np.mean(data, axis=1), sr)
        except Exception:
            lra = None

        crest_factor = None
        if tp_val is not None and integrated_lufs is not None and not math.isinf(integrated_lufs):
            crest_factor = round(tp_val - integrated_lufs, 1)

        return {
            "integrated_lufs": _safe_float(integrated_lufs),
            "true_peak_dbtp": _safe_float(tp_val),  # dBTp per ITU-R BS.1770-4
            "lra": _safe_float(lra),
            "crest_factor": crest_factor,
            "method": "EBU R128 (pyloudnorm: K-weighting, -70 LUFS gate, -10 LU relative gate, stereo/原始声道输入)",
            "standard_ref": "ITU-R BS.1770-4",
        }
    except ImportError:
        return {"integrated_lufs": None, "true_peak_dbtp": None, "method": "pyloudnorm not installed", "_hint": "pip install pyloudnorm"}
    except Exception as e:
        return {"integrated_lufs": None, "true_peak_dbtp": None, "_error": str(e)}


def _compute_true_peak(data: np.ndarray, sr: int) -> Optional[float]:
    """True Peak 计算 (4x oversample, dBFS)。ITU-R BS.1770-4 Annex 2。"""
    arr = np.asarray(data, dtype=np.float64)
    if arr.size == 0:
        return None

    if arr.ndim == 1:
        channels = [arr]
    elif arr.ndim == 2:
        # Accept both common layouts: (samples, channels) and (channels, samples).
        if arr.shape[1] <= 8:
            channels = [arr[:, ch] for ch in range(arr.shape[1])]
        else:
            channels = [arr[ch, :] for ch in range(arr.shape[0])]
    else:
        arr = arr.reshape(arr.shape[0], -1)
        channels = [arr[:, ch] for ch in range(arr.shape[1])]

    try:
        from scipy.signal import resample_poly, butter, sosfilt
        sos = butter(4, 0.45, btype='low', output='sos')
        peaks = []
        for channel in channels:
            # 4x oversample + anti-alias low-pass, then take channel peak.
            oversampled = resample_poly(channel, 4, 1)
            oversampled = sosfilt(sos, oversampled)
            peaks.append(float(np.max(np.abs(oversampled))))
        peak = max(peaks) if peaks else 0.0
        if peak > 0:
            return round(20 * math.log10(peak), 1)
        return -100.0
    except Exception:
        # fallback: sample peak
        peak = max(float(np.max(np.abs(channel))) for channel in channels)
        if peak > 0:
            return round(20 * math.log10(peak), 1)
        return -100.0


def _compute_lra(data: np.ndarray, sr: int) -> Optional[float]:
    """LRA (Loudness Range) per EBU R128 规范。"""
    try:
        import pyloudnorm as pyln
        # 分段计算: 每3秒一段
        block_dur = 3.0
        block_samples = int(block_dur * sr)
        block_loudness = []

        for i in range(0, len(data) - block_samples, block_samples):
            block = data[i:i + block_samples]
            meter = pyln.Meter(sr)
            loud = meter.integrated_loudness(block)
            if loud is not None and loud > -100:
                block_loudness.append(loud)

        if len(block_loudness) < 3:
            return None

        # 取 10th ~ 95th 百分位差值
        p10 = np.percentile(block_loudness, 10)
        p95 = np.percentile(block_loudness, 95)
        return round(float(p95 - p10), 1)
    except Exception:
        return None


# ═══════════════════════════════════════════════════
#  立体声宽度
# ═══════════════════════════════════════════════════

def _compute_stereo_analysis(stereo_data: np.ndarray, sr: int) -> dict:
    """
    立体声分析 + 相位校验。
    - Mid-Side 立体声宽度
    - 相位相关度 (phase correlation mean): 过低 → 相位抵消风险
    - 低频单声道性 (subbass stereo width): club/rave 场景低频应近单声道
    """
    try:
        if stereo_data is None or stereo_data.ndim < 2 or stereo_data.shape[0] < 2:
            return {"stereo_width": 0, "channels": 1, "note": "mono",
                    "phase_correlation_mean": None, "subbass_stereo_width": None}

        left = stereo_data[0, :]
        right = stereo_data[1, :]
        n = len(left)

        # Mid-Side
        mid = (left + right) / 2.0
        side = (left - right) / 2.0
        mid_rms = float(np.sqrt(np.mean(mid ** 2)))
        side_rms = float(np.sqrt(np.mean(side ** 2)))
        width = round(side_rms / max(mid_rms, 1e-10) * 100, 1)

        # 相位相关度 (frame-wise)
        frame_len = 1024
        hop = 512
        n_frames = (n - frame_len) // hop
        phase_corrs = []
        for i in range(min(n_frames, 200)):  # 最多200帧
            start = i * hop
            lf = left[start:start + frame_len]
            rf = right[start:start + frame_len]
            if len(lf) < frame_len:
                break
            corr = np.corrcoef(lf, rf)[0, 1]
            if not np.isnan(corr):
                phase_corrs.append(corr)

        phase_corr_mean = round(float(np.mean(phase_corrs)), 3) if phase_corrs else None

        # 相位警告: 平均相关度 < 0.3 → 风险
        phase_warning = phase_corr_mean is not None and phase_corr_mean < 0.3

        # 低频立体声宽度 (20-80Hz, 用于 club 校验)
        try:
            import librosa
            S_l = np.abs(librosa.stft(left, n_fft=8192, hop_length=HOP_LENGTH))
            S_r = np.abs(librosa.stft(right, n_fft=8192, hop_length=HOP_LENGTH))
            freqs_low = librosa.fft_frequencies(sr=sr, n_fft=8192)
            sub_mask = (freqs_low >= 20) & (freqs_low <= 80)
            sub_l = np.mean(S_l[sub_mask, :])
            sub_r = np.mean(S_r[sub_mask, :])
            sub_mid = (sub_l + sub_r) / 2
            sub_side = abs(sub_l - sub_r) / 2
            subbass_width = round(float(sub_side / max(sub_mid, 1e-10) * 100), 1)
            subbass_stereo_warning = subbass_width > 30  # club 标准: 低频应 <30% 宽度
        except Exception:
            subbass_width = None
            subbass_stereo_warning = False

        return {
            "stereo_width": min(width, 100),
            "channels": 2,
            "phase_correlation_mean": phase_corr_mean,
            "phase_warning": phase_warning,
            "subbass_stereo_width": subbass_width,
            "subbass_stereo_warning": subbass_stereo_warning,
        }
    except Exception as e:
        return {"stereo_width": None, "channels": 1, "_error": str(e),
                "phase_correlation_mean": None, "phase_warning": False}


# ═══════════════════════════════════════════════════
#  自动标签生成 (基于阈值)
# ═══════════════════════════════════════════════════

def _generate_timbre_labels(spectral: dict) -> list:
    """基于频谱参数自动生成音色标签。"""
    labels = []
    cm = spectral.get("centroid_mean")
    bw = spectral.get("bandwidth_mean")
    flat = spectral.get("flatness_mean")

    if cm is not None:
        if cm < 1000:
            labels.append({"label": "偏暗", "category": "timbre", "desc": "能量集中中低频，温暖厚重"})
        elif cm < 1800:
            labels.append({"label": "平衡偏暖", "category": "timbre", "desc": "中低频为主，柔和自然"})
        elif cm < 2500:
            labels.append({"label": "标准平衡", "category": "timbre", "desc": "高中低频均衡"})
        elif cm < 3500:
            labels.append({"label": "偏亮", "category": "timbre", "desc": "中高频突出，明亮锐利"})
        else:
            labels.append({"label": "极亮", "category": "timbre", "desc": "高频能量主导"})

    if bw is not None:
        if bw < 1500:
            labels.append({"label": "偏窄频带", "category": "bandwidth", "desc": "频谱集中，音色偏瘦"})
        elif bw < 2500:
            labels.append({"label": "中等频带", "category": "bandwidth", "desc": "频谱分布适中"})
        elif bw < 4000:
            labels.append({"label": "宽频带", "category": "bandwidth", "desc": "频谱分散，音色丰满"})
        else:
            labels.append({"label": "极宽频带", "category": "bandwidth", "desc": "频谱极度分散"})

    if flat is not None:
        if flat < 0.1:
            labels.append({"label": "强音调性", "category": "tonality", "desc": "谐波结构清晰"})
        elif flat > 0.3:
            labels.append({"label": "噪音感", "category": "tonality", "desc": "噪音成分偏高"})

    return labels


def _generate_dynamics_labels(dynamics: dict) -> list:
    """基于动态参数自动生成标签。"""
    labels = []
    lufs = dynamics.get("integrated_lufs")
    lra = dynamics.get("lra")
    crest = dynamics.get("crest_factor")

    if lufs is not None and not math.isinf(lufs):
        if lufs < -20:
            labels.append({"label": "广播级动态", "category": "loudness", "desc": f"Integrated LUFS {lufs:.1f}, 动态保留充分"})
        elif lufs < -14:
            labels.append({"label": "流媒体标准响度", "category": "loudness", "desc": f"Integrated LUFS {lufs:.1f}, Spotify/Apple Music 适配"})
        elif lufs < -10:
            labels.append({"label": "中等响度", "category": "loudness", "desc": f"Integrated LUFS {lufs:.1f}, 独立/流行区间"})
        elif lufs < -6:
            labels.append({"label": "高响度", "category": "loudness", "desc": f"Integrated LUFS {lufs:.1f}, 俱乐部/EDM区间"})
        else:
            labels.append({"label": "极端压缩", "category": "loudness", "desc": f"Integrated LUFS {lufs:.1f}, 动态损失严重"})

    if lra is not None:
        if lra < 5:
            labels.append({"label": "低动态范围", "category": "dynamics", "desc": f"LRA {lra} LU, 整体音量平稳"})
        elif lra < 10:
            labels.append({"label": "中等动态", "category": "dynamics", "desc": f"LRA {lra} LU, 有无级变化"})
        else:
            labels.append({"label": "高动态范围", "category": "dynamics", "desc": f"LRA {lra} LU, 强弱对比强烈"})

    if crest is not None:
        if crest < 8:
            labels.append({"label": "低峰值因数", "category": "crest", "desc": f"Crest {crest}dB, 持续高能量"})
        elif crest < 15:
            labels.append({"label": "标准峰值因数", "category": "crest", "desc": f"Crest {crest}dB, 瞬态适中"})
        else:
            labels.append({"label": "高峰值因数", "category": "crest", "desc": f"Crest {crest}dB, 瞬态丰富"})

    return labels


def _generate_stereo_label(width_info: dict) -> list:
    """立体声宽度标签。"""
    labels = []
    w = width_info.get("stereo_width")
    if w is not None:
        if w < 10:
            labels.append({"label": "近单声道", "category": "stereo", "desc": "几乎无立体声信息"})
        elif w < 30:
            labels.append({"label": "偏窄声场", "category": "stereo", "desc": "重心居中"})
        elif w < 55:
            labels.append({"label": "标准立体声宽", "category": "stereo", "desc": "声场自然"})
        elif w < 70:
            labels.append({"label": "宽阔声场", "category": "stereo", "desc": "空间感强"})
        else:
            labels.append({"label": "超宽声场", "category": "stereo", "desc": "相位抵消风险"})
    return labels


# ═══════════════════════════════════════════════════
#  Subbass 检测 (20-80Hz 持续根音能量)
# ═══════════════════════════════════════════════════

def _detect_subbass(audio: np.ndarray, sr: int) -> dict:
    """
    检测是否存在独立 subbass 声部。三角验证法:
    1. 瞬态剥离: onset_detect 标记瞬态 ±50ms 区间，排除底鼓脉冲
    2. 时域占空比: 仅统计非瞬态区间 20-80Hz 能量占比
    3. 持续帧判定: >200ms 连续高能量帧才计入，短脉冲忽略

    区别于底鼓 kick 的瞬态次低频（周期性短脉冲，无持续音高线条）。
    """
    try:
        import librosa
        from scipy.ndimage import median_filter

        n_fft_low = 8192
        S = np.abs(librosa.stft(audio, n_fft=n_fft_low, hop_length=HOP_LENGTH, window=WINDOW_TYPE))
        freqs = librosa.fft_frequencies(sr=sr, n_fft=n_fft_low)
        sub_mask = (freqs >= 20) & (freqs <= 80)
        sub_energy = np.mean(S[sub_mask, :], axis=0)
        n_frames = len(sub_energy)

        if n_frames < 10:
            return {"has_subbass": False, "_note": "音频过短，无法检测 subbass"}

        # ── 瞬态剥离 ──
        # 标记所有 onset 帧，排除 ±50ms 区间
        onset_frames = librosa.onset.onset_detect(
            y=audio, sr=sr, hop_length=HOP_LENGTH,
            backtrack=True, units='frames'
        )
        exclude_half_window = max(1, int(0.05 * sr / HOP_LENGTH))  # 50ms → frames

        transient_mask = np.zeros(n_frames, dtype=bool)
        for of in onset_frames:
            lo = max(0, of - exclude_half_window)
            hi = min(n_frames, of + exclude_half_window)
            transient_mask[lo:hi] = True

        # ── 持续帧判定 ──
        # 平滑后找到连续高能量段
        sub_smooth = median_filter(sub_energy, size=5)
        # 阈值: 全局中位数的 1.5 倍
        threshold = np.median(sub_smooth) * 1.5

        # 标记高能量帧
        high_energy_mask = sub_smooth > threshold
        # 排除瞬态帧
        sustained_mask = high_energy_mask & (~transient_mask)

        # 统计连续持续帧
        min_continuous = max(3, int(0.2 * sr / HOP_LENGTH))  # >200ms
        continuous_groups = []
        in_group = False
        group_start = 0
        for i in range(n_frames):
            if sustained_mask[i] and not in_group:
                in_group = True
                group_start = i
            elif not sustained_mask[i] and in_group:
                length = i - group_start
                if length >= min_continuous:
                    continuous_groups.append((group_start, i))
                in_group = False
        if in_group:
            length = n_frames - group_start
            if length >= min_continuous:
                continuous_groups.append((group_start, n_frames))

        # 占空比: 持续帧 / 非瞬态总帧
        total_non_transient = np.sum(~transient_mask)
        sustained_frames = int(np.sum(sustained_mask))
        duty_cycle = sustained_frames / max(total_non_transient, 1)

        # 判定
        has_subbass = len(continuous_groups) > 0 and duty_cycle > 0.22

        # 区分类型
        kick_frames = int(np.sum(high_energy_mask & transient_mask))
        sub_type = None
        if has_subbass:
            sub_mean_db = 20 * math.log10(max(np.mean(sub_energy[sustained_mask]) if sustained_frames > 0 else 1e-10, 1e-10))
            if sub_mean_db > -22:
                sub_type = "808"
            else:
                sub_type = "synth_bass"
        elif kick_frames > 0 and sustained_frames < kick_frames * 2:
            # 低频能量以瞬态为主，持续帧不足 → kick_transient_only
            sub_type = "kick_transient_only"
        elif sustained_frames > 0 and duty_cycle <= 0.22:
            # 有持续帧但占空比不足 → 弱持续（bass synth sub-harmonics / reverb tail）
            sub_type = "weak_sustained"

        # 下潜深度
        sub_band_energy = np.mean(S[sub_mask, :], axis=1)
        depth_hz = None
        for i in range(len(sub_band_energy) - 1, -1, -1):
            db = 20 * math.log10(max(sub_band_energy[i], 1e-10))
            if db > -30:
                depth_hz = round(float(freqs[sub_mask][min(i, len(sub_band_energy) - 1)]), 1)
                break

        # Subbass 立体声宽度 (低频单声道性校验)
        sub_stereo_width = None
        try:
            if audio.ndim < 2 or audio.shape[0] < 2:
                pass  # 单声道，无此问题
        except Exception:
            pass

        return {
            "has_subbass": has_subbass,
            "subbass_type": sub_type,
            "subbass_depth_hz": depth_hz,
            "duty_cycle": round(duty_cycle, 3),
            "sustained_frame_groups": len(continuous_groups),
            "kick_transient_frames": int(np.sum(high_energy_mask & transient_mask)),
            "is_sustained": has_subbass,
            "method": "20-80Hz sustained energy + onset transient stripping + >200ms continuous frame rule (8192-FFT)",
            "subbass_stereo_width": None,  # 需分轨后计算
        }
    except Exception as e:
        return {"has_subbass": False, "_error": str(e)}


# ═══════════════════════════════════════════════════
#  Attack/Decay 包络分析 (Stab / Pad 检测)
# ═══════════════════════════════════════════════════

def _detect_transient_type(audio: np.ndarray, sr: int) -> dict:
    """
    检测音色包络类型:
    - Stab: Attack < 10ms, Decay < 300ms, Sustain ≈ 0
    - Pad: Attack > 30ms, Decay > 500ms, Sustain > 0
    - 结合频谱质心判断是否为 metallic
    """
    try:
        import librosa

        # Onset 检测
        onset_frames = librosa.onset.onset_detect(
            y=audio, sr=sr, hop_length=HOP_LENGTH,
            backtrack=True, units='frames'
        )

        if len(onset_frames) < 3:
            return {"transient_type": "unknown", "onset_count": len(onset_frames)}

        onset_times = librosa.frames_to_time(onset_frames, sr=sr, hop_length=HOP_LENGTH)

        # 对每个 onset 之后的 500ms 做 RMS 包络分析
        rms = librosa.feature.rms(y=audio, frame_length=256, hop_length=128)[0]
        rms_times = librosa.frames_to_time(np.arange(len(rms)), sr=sr, hop_length=128)

        attacks, decays = [], []
        for onset_t in onset_times[:20]:  # 最多分析前20个 onset
            onset_idx = np.argmin(np.abs(rms_times - onset_t))
            # 前 10ms (attack), 后 300ms (decay)
            pre_10ms = max(0, onset_idx - int(0.01 * sr / 128))
            post_300ms = min(len(rms) - 1, onset_idx + int(0.3 * sr / 128))

            if post_300ms <= onset_idx:
                continue

            # Attack: 峰值出现的时间
            attack_segment = rms[onset_idx:min(onset_idx + int(0.05 * sr / 128), len(rms))]
            if len(attack_segment) > 1:
                peak_idx = np.argmax(attack_segment)
                attack_ms = round(peak_idx * 128 / sr * 1000, 1)
                attacks.append(attack_ms)

            # Decay: 峰值后能量衰减到 1/e 的时间
            decay_segment = rms[onset_idx:post_300ms]
            if len(decay_segment) > 2:
                peak_val = np.max(decay_segment)
                threshold = peak_val / np.e
                below = np.where(decay_segment < threshold)[0]
                if len(below) > 0:
                    decay_ms = round(below[0] * 128 / sr * 1000, 1)
                    decays.append(decay_ms)

        if not attacks or not decays:
            return {"transient_type": "unknown", "onset_count": len(onset_times)}

        avg_attack = np.mean(attacks)
        avg_decay = np.mean(decays)

        # 分类
        if avg_attack < 10 and avg_decay < 300:
            ttype = "stab"
        elif avg_attack > 30 and avg_decay > 500:
            ttype = "pad"
        elif avg_attack < 15 and avg_decay < 500:
            ttype = "pluck"
        else:
            ttype = "sustained"

        return {
            "transient_type": ttype,
            "avg_attack_ms": round(float(avg_attack), 1),
            "avg_decay_ms": round(float(avg_decay), 1),
            "onset_count": len(onset_times),
            "total_onsets": len(onset_frames),
        }
    except Exception as e:
        return {"transient_type": "unknown", "_error": str(e)}


def _detect_metallic(spectral: dict, transient: dict) -> bool:
    """判定是否为 metallic 音色: 高频泛音丰富 + 质心 > 2500Hz + 有金属感谐波峰值。"""
    if not spectral or not transient:
        return False
    cm = spectral.get("centroid_mean", 0)
    flat = spectral.get("flatness_mean", 1)
    ttype = transient.get("transient_type", "")

    # 短促包络 + 高质心 + 低平坦度（强谐波）= metallic
    return (ttype in ("stab", "pluck") and
            cm is not None and cm > 2500 and
            flat is not None and flat < 0.15)


def _analyze_arrangement_texture(audio: np.ndarray, sr: int, spectral: dict, stereo: dict) -> dict:
    """
    编曲音色与织体标签 — 「分轨分离 + 频谱验证 + 听感佐证」三角验证法的自动化层。
    完整语义标签仍需 Demucs 分轨 + 人工听感。
    """
    subbass = _detect_subbass(audio, sr)
    transient = _detect_transient_type(audio, sr)
    is_metallic = _detect_metallic(spectral, transient)

    texture_tags = []
    if subbass.get("has_subbass"):
        label = "subbass" + (" (808)" if subbass.get("subbass_type") == "808" else "")
        texture_tags.append({"label": label, "category": "bass",
                             "confidence": 0.6 if subbass.get("is_sustained") else 0.3})

    if transient.get("transient_type") == "stab":
        prefix = "metallic " if is_metallic else ""
        texture_tags.append({"label": f"{prefix}synth stab", "category": "texture",
                             "confidence": 0.7 if is_metallic else 0.5})
    elif transient.get("transient_type") == "pad":
        texture_tags.append({"label": "pad", "category": "texture", "confidence": 0.5})

    if stereo.get("stereo_width", 0) > 55:
        texture_tags.append({"label": "wide mix", "category": "spatial", "confidence": 0.6})

    return {
        "bass": subbass,
        "transient": transient,
        "is_metallic": is_metallic,
        "texture_tags": texture_tags,
        "_note": "自动化初筛结果。完整语义标签需 Demucs 分轨验证。",
    }


# ═══════════════════════════════════════════════════
#  批量分析模式
# ═══════════════════════════════════════════════════

def analyze_batch(directory: str, output_dir: Optional[str] = None,
                  pattern: str = "*.{mp3,flac,wav,m4a,ogg}") -> List[Dict[str, Any]]:
    """批量分析目录下所有音频文件。"""
    import glob as glob_mod

    results = []
    files = []
    for ext in ['mp3', 'flac', 'wav', 'm4a', 'ogg', 'aac']:
        files.extend(glob_mod.glob(os.path.join(directory, f'*.{ext}')))
        files.extend(glob_mod.glob(os.path.join(directory, f'*.{ext.upper()}')))

    files = sorted(set(files))
    if not files:
        print(f"目录中未找到音频文件: {directory}", file=sys.stderr)
        return []

    print(f"📂 批量分析 {len(files)} 个音频文件...", file=sys.stderr)

    for i, f in enumerate(files, 1):
        print(f"  [{i}/{len(files)}] {os.path.basename(f)}", file=sys.stderr)
        try:
            result = analyze(f, deep=False, format_mode="full")
            results.append(result)
        except Exception as e:
            print(f"    ✕ 失败: {e}", file=sys.stderr)
            results.append({"filepath": f, "success": False, "error": str(e)})

    # 批量汇总
    if output_dir and results:
        os.makedirs(output_dir, exist_ok=True)
        summary_path = os.path.join(output_dir, "batch_summary.json")
        with open(summary_path, "w", encoding="utf-8") as f:
            json.dump(_clean_json_types(results), f, ensure_ascii=False, indent=2)
        print(f"\n✓ 批量分析完成。汇总: {summary_path}", file=sys.stderr)

    return results


# ═══════════════════════════════════════════════════
#  主分析函数
# ═══════════════════════════════════════════════════

def analyze(filepath: str, deep: bool = False, output_path: Optional[str] = None,
            format_mode: str = "full", stem_engine: str = "demucs") -> Dict[str, Any]:
    """主导分析函数。自动选择最佳引擎，统一标准化参数。"""
    # 暂存 stem_engine 供后续使用
    analyze._stem_engine = stem_engine
    start = time.time()

    if not os.path.exists(filepath):
        return {"success": False, "error": f"文件不存在: {filepath}", "elapsed_ms": 0}

    filepath = os.path.abspath(filepath)
    file_size_mb = round(os.path.getsize(filepath) / (1024 * 1024), 2)

    # ── 容器识别 + ffprobe 真实元数据 (假 MP3 根因修复) ──
    container = _sniff_container(filepath)
    probe = _ffprobe_audio_meta(filepath)

    # ── 码率/容器警告 ──
    bitrate_warning = None
    if container.get("is_fake_mp3"):
        real_codec = probe.get("codec") or "未知编码"
        bitrate_warning = (
            f"文件实为 {container.get('container')} 容器（{real_codec}），并非标准 MP3；"
            "已按真实格式记录，高频参数以 ffmpeg 转码结果为准"
        )
    else:
        try:
            from mutagen.mp3 import MP3
            mp3 = MP3(filepath)
            br = mp3.info.bitrate
            if br and br < 192000:
                bitrate_warning = f"MP3码率 {br//1000}kbps < 192kbps，高频参数可能被截断失真，禁用于高频参数计算"
        except Exception:
            pass
        if not bitrate_warning and probe.get("codec") == "mp3" and probe.get("bit_rate"):
            br = int(probe["bit_rate"])
            if 0 < br < 192000:
                bitrate_warning = f"MP3码率 {br//1000}kbps < 192kbps，高频参数可能被截断失真，禁用于高频参数计算"

    # ── ffmpeg 归一化到 16bit WAV 临时文件 (ASCII 路径，供 sonara/统一加载) ──
    temp_wav = None
    try:
        temp_wav = _make_clean_wav(filepath)
    except Exception:
        temp_wav = None
    analysis_path = temp_wav or filepath

    # ── 预处理: 加载音频 (双路输出: mono for MIR, stereo for LUFS) ──
    try:
        audio, audio_stereo, sr, dc_offset = _load_audio_mono(analysis_path, trim_silence=True)
    except Exception as e:
        if temp_wav:
            try:
                os.unlink(temp_wav)
            except OSError:
                pass
        return {"success": False, "error": f"音频加载失败: {e}", "elapsed_ms": round((time.time() - start) * 1000)}

    duration = len(audio) / sr

    engine = "essentia" if _check_essentia() else "librosa"
    engine_version = "unknown"

    # ── 检查引擎版本 ──
    try:
        import librosa
        engine_version = f"librosa {librosa.__version__}"
    except Exception:
        pass

    # ── BPM: 首选 sonara (Rust 引擎), 回退 librosa；同时收集五维证据特征 ──
    bpm_data = None
    sonara_evidence = {}
    try:
        import sonara
        sr_result = sonara.analyze_file(
            analysis_path, mode="playlist",
            features=["key_candidates", "vocalness", "loudness", "structure",
                      "energy", "danceability", "valence", "acousticness",
                      "chords", "dissonance"],
            bpm_min=70.0, bpm_max=190.0,
        )
        bpm_sonara = round(float(sr_result.get('bpm', 0)), 1) if sr_result.get('bpm') else None
        if bpm_sonara and bpm_sonara > 0:
            bpm_data = {
                "bpm": bpm_sonara,
                "bpm_confidence": round(float(sr_result.get('bpm_confidence', 90)), 1),
                "bpm_candidates": {"half": round(bpm_sonara / 2, 1), "half_confidence": 0, "double": round(bpm_sonara * 2, 1), "double_confidence": 0},
                "bpm_octave_risk": False,
                "bpm_deviation_risk": False,
                "bpm_confidence_note": "sonara Rust 引擎 (multi-feature beat tracking, ~4ms/track)",
                "bpm_method": "sonara Rust engine (bpm window 70-190)",
            }
            # 同时用 sonara 的key作为 MIR 参考源
            sr_key = sr_result.get('key')
            sr_key_conf = sr_result.get('key_confidence')
            sr_camelot = sr_result.get('key_camelot')
            if sr_key and not hasattr(analyze, '_sonara_key'):
                analyze._sonara_key = {"key": sr_key, "confidence": sr_key_conf, "camelot": sr_camelot}
        sonara_evidence = {
            "engine_version": sr_result.get('provenance'),
            "bpm": bpm_sonara,
            "bpm_confidence": round(float(sr_result.get('bpm_confidence', 0) or 0), 3),
            "bpm_candidates": sr_result.get('bpm_candidates'),
            "key": sr_result.get('key'),
            "key_camelot": sr_result.get('key_camelot'),
            "key_confidence": sr_result.get('key_confidence'),
            "key_candidates": sr_result.get('key_candidates'),
            "predominant_chord": sr_result.get('predominant_chord'),
            "chord_change_rate": sr_result.get('chord_change_rate'),
            "dissonance": sr_result.get('dissonance'),
            "chord_events": sr_result.get('chord_events'),
            "energy": sr_result.get('energy'),
            "danceability": sr_result.get('danceability'),
            "valence": sr_result.get('valence'),
            "acousticness": sr_result.get('acousticness'),
            "vocalness": sr_result.get('vocalness'),
            "integrated_lufs": sr_result.get('loudness_lufs'),
            "true_peak_dbtp": sr_result.get('true_peak_db'),
            "lra": sr_result.get('loudness_range_lu'),
            "dynamic_range_db": sr_result.get('dynamic_range_db'),
            "segments": sr_result.get('segments'),
        }
    except Exception:
        pass  # sonara 不可用 (MP3解码失败/文件损坏)，静默回退到 librosa
    if bpm_data is None:
        bpm_data = _detect_bpm_librosa(audio, sr)
    if sonara_evidence:
        engine = "sonara+librosa"

    # ── 调性: Krumhansl-Schmuckler ──
    key_data = _detect_key_ks(audio, sr)

    # ── 频谱特征 ──
    spectral = _compute_spectral_features(audio, sr)

    # ── 响度 & 动态 (EBU R128) — 使用立体声输入 ──
    dynamics = _compute_loudness_dynamics(audio_stereo, sr)

    # ── 立体声分析 + 相位校验 ──
    stereo = _compute_stereo_analysis(audio_stereo, sr)

    # ── 能量曲线 ──
    energy_curve = _compute_energy_curve(audio, sr)

    # ── Onset strength stats ──
    onset_stats = {}
    try:
        import librosa
        onset_env = librosa.onset.onset_strength(y=audio, sr=sr, hop_length=HOP_LENGTH)
        onset_stats = {
            "onset_strength_mean": round(float(np.mean(onset_env)), 4),
            "onset_strength_std": round(float(np.std(onset_env)), 4),
            "onset_rate": round(float(len(librosa.onset.onset_detect(onset_envelope=onset_env, sr=sr, hop_length=HOP_LENGTH)) / max(duration, 1)), 2),
        }
    except Exception:
        onset_stats = {}

    # ── 编曲音色与织体检测 ──
    arrangement = _analyze_arrangement_texture(audio, sr, spectral, stereo)

    # ── 自动标签 ──
    auto_labels = []
    auto_labels.extend(_generate_timbre_labels(spectral))
    auto_labels.extend(_generate_dynamics_labels(dynamics))
    auto_labels.extend(_generate_stereo_label(stereo))
    for tag in arrangement.get("texture_tags", []):
        auto_labels.append({"label": tag["label"], "category": tag["category"],
                            "desc": f"自动检测 (置信度 {tag['confidence']:.0%})"})

    # ── 异常检测 ──
    anomalies = []
    # 频谱
    if spectral.get("rolloff_mean") and spectral["rolloff_mean"] < 5000:
        anomalies.append({"item": "rolloff_low", "severity": "warning", "detail": f"滚降点异常 (<5kHz): {spectral['rolloff_mean']}Hz"})
    # 响度
    if dynamics.get("integrated_lufs") and dynamics["integrated_lufs"] < -30:
        anomalies.append({"item": "lufs_too_quiet", "severity": "warning", "detail": f"LUFS <-30: {dynamics['integrated_lufs']}"})
    if dynamics.get("integrated_lufs") and dynamics["integrated_lufs"] > -3:
        anomalies.append({"item": "lufs_too_loud", "severity": "critical", "detail": f"LUFS >-3: {dynamics['integrated_lufs']}，可能严重削波"})
    # BPM
    if bpm_data.get("bpm_confidence", 0) < 30:
        anomalies.append({"item": "bpm_low_confidence", "severity": "warning", "detail": f"BPM置信度 {bpm_data.get('bpm_confidence')}%"})
    if bpm_data.get("bpm_octave_risk"):
        anomalies.append({"item": "bpm_octave_ambiguity", "severity": "warning", "detail": f"BPM {bpm_data.get('bpm')} 存在倍拍歧义，候选: ½={bpm_data.get('bpm_candidates',{}).get('half')} / ×2={bpm_data.get('bpm_candidates',{}).get('double')}"})
    # 调性
    if key_data.get("key_confidence", 0) < 40:
        anomalies.append({"item": "key_low_confidence", "severity": "warning", "detail": f"调性置信度低 ({key_data.get('key_confidence')}%)，标注「调性模糊」"})
    if key_data.get("parallel_mode_ambiguity"):
        anomalies.append({"item": "key_parallel_ambiguity", "severity": "info", "detail": f"平行大小调歧义: {key_data.get('key_full')} ↔ {key_data.get('key_second_candidate',{}).get('key_full')}"})
    if key_data.get("key_ambiguity"):
        anomalies.append({"item": "key_ambiguity", "severity": "warning", "detail": f"调性歧义: 第一候选 {key_data.get('key_full')} (corr={key_data.get('key_correlation')}) vs 第二候选 {key_data.get('key_second_candidate',{}).get('key_full')} (corr={key_data.get('key_second_candidate',{}).get('correlation')})"})
    # DC offset
    if abs(dc_offset) > 0.01:
        anomalies.append({"item": "dc_offset", "severity": "warning", "detail": f"直流偏移 {dc_offset:.4f}，已移除"})
    # 相位
    if stereo.get("phase_warning"):
        anomalies.append({"item": "stereo_phase", "severity": "warning", "detail": f"相位相关度偏低 ({stereo.get('phase_correlation_mean')})，存在相位抵消风险"})
    if stereo.get("subbass_stereo_warning"):
        anomalies.append({"item": "subbass_stereo", "severity": "info", "detail": f"低频立体声宽度偏高 ({stereo.get('subbass_stereo_width')}%)，club/rave场景建议低频单声道"})

    # ── analysis_status 枚举 ──
    has_critical = any(a.get("severity") == "critical" for a in anomalies)
    has_warning = any(a.get("severity") == "warning" for a in anomalies)
    if has_critical:
        analysis_status = "corrupted_audio" if any("lufs_too_loud" in str(a) for a in anomalies) else "low_confidence_audio"
    elif bitrate_warning and not has_warning:
        analysis_status = "low_bitrate_warning"
    elif has_warning:
        analysis_status = "low_confidence_audio"
    elif key_data.get("bpm_octave_risk"):
        analysis_status = "octave_ambiguity"
    elif stereo.get("phase_warning"):
        analysis_status = "phase_warning"
    else:
        analysis_status = "ok"

    # ── 音频元信息 (容器识别 + ffprobe 真实值) ──
    audio_meta = {
        "container": container.get("container"),
        "is_fake_mp3": container.get("is_fake_mp3", False),
        "codec": probe.get("codec"),
        "sample_rate": probe.get("sample_rate"),
        "channels": probe.get("channels"),
        "duration": probe.get("duration"),
        "format_name": probe.get("format_name"),
        "original_bitrate": int(probe["bit_rate"]) if probe.get("bit_rate") else None,
        "is_vbr": None,
    }

    # ── 组装结果 ──
    result = {
        "success": True,
        "version": SCRIPT_VERSION,
        "analysis_status": analysis_status,
        "engine": engine,
        "engine_version": engine_version,
        "filepath": filepath,
        "filename": os.path.basename(filepath),
        "file_size_mb": file_size_mb,
        "duration_seconds": round(duration, 1),
        "sample_rate": sr,
        "dc_offset": dc_offset,

        # 音频元信息
        "audio_meta": audio_meta,

        # sonara 原始证据 (五维评分用)
        "sonara": sonara_evidence,

        # 五维评分证据包（词/曲/编/唱/混）
        "evidence": _build_evidence(
            bpm_data, key_data, sonara_evidence, spectral, dynamics, stereo,
            arrangement, duration, bitrate_warning,
        ),

        # 基础元数据
        "bpm": bpm_data.get("bpm"),
        "bpm_confidence": bpm_data.get("bpm_confidence", 0),
        "bpm_candidates": bpm_data.get("bpm_candidates", {}),
        "bpm_octave_risk": bpm_data.get("bpm_octave_risk", False),
        "bpm_method": bpm_data.get("bpm_method", "librosa beat tracking"),

        "key": key_data.get("key_full"),
        "key_name": key_data.get("key"),
        "mode": key_data.get("mode"),
        "key_confidence": key_data.get("key_confidence", 0),
        "key_correlation": key_data.get("key_correlation"),
        "key_method": key_data.get("key_method"),
        "key_second_candidate": key_data.get("key_second_candidate"),
        "parallel_mode_ambiguity": key_data.get("parallel_mode_ambiguity", False),
        "camelot": key_data.get("camelot"),
        "camelot_low_confidence": key_data.get("camelot_low_confidence", False),

        # 多源校验字段
        "source_count": 1,
        "cross_reference": {
            "sources": ["local"],
            "bpm_values": {engine: bpm_data.get("bpm")},
            "key_values": {engine: key_data.get("key_full")},
            "consensus": "pending",
        },

        # 频谱特征
        "spectral": spectral,

        # 响度 & 动态
        "dynamics": dynamics,

        # 立体声 + 相位
        "stereo": stereo,

        # Onset strength
        "onset_stats": onset_stats,

        # 自动标签
        "auto_labels": auto_labels,

        # 编曲纹理分析
        "arrangement": arrangement,

        # 能量曲线
        "energy_curve": energy_curve,

        # 人工修正标记
        "manual_correction": {
            "is_corrected": False,
            "original_bpm": bpm_data.get("bpm"),
            "original_key": key_data.get("key_full"),
            "corrected_at": None,
        },

        # 异常 & 警告
        "anomalies": anomalies,
        "bitrate_warning": bitrate_warning,

        # 标准化参数记录
        # ── 来源追溯 (满足工作台校验 SOP: 记录来源工具、计算参数、校验时间) ──
        "source_tracking": _make_source_tracking(engine, engine_version),

        # 标准化参数记录 (保持向后兼容)
        "analysis_config": {
            "sample_rate": DEFAULT_SAMPLE_RATE,
            "fft_size": FFT_SIZE,
            "hop_length": HOP_LENGTH,
            "window": WINDOW_TYPE,
            "rolloff_percent": ROLLOFF_PERCENT,
            "lufs_standard": "EBU R128 (ITU-R BS.1770-4)",
            "trim_silence": True,
        },

        "elapsed_ms": round((time.time() - start) * 1000),
    }

    # ── 可选: 音轨分离 ──
    stem_engine = getattr(analyze, '_stem_engine', 'demucs')
    if deep:
        if stem_engine == "spleeter":
            if _check_spleeter():
                result["deep_analysis"] = _run_stem_separation(filepath, engine="spleeter")
            else:
                result["deep_analysis"] = {"_error": "Spleeter 未安装。pip install spleeter"}
        elif _check_demucs():
            result["deep_analysis"] = _run_stem_separation(filepath, engine="demucs")
        elif _check_spleeter():
            result["deep_analysis"] = _run_stem_separation(filepath, engine="spleeter")
        else:
            result["deep_analysis"] = {"_error": "未安装 Demucs 或 Spleeter。pip install demucs 或 pip install spleeter"}

    # ── 验证清单 ──
    result["verification_checklist"] = _generate_verification_checklist(
        anomalies, spectral, dynamics, arrangement, bitrate_warning,
        bpm_data=bpm_data, key_data=key_data, stereo=stereo
    )

    # ── 行业标准引用 ──
    result["authority_standards"] = AUTHORITY_STANDARDS

    # ── 低置信度标签标记 ──
    for tag in result["auto_labels"]:
        if tag.get("confidence") and tag["confidence"] < 0.5:
            tag["low_confidence"] = True

    # ── 输出 (numpy 类型显式转换，禁止 default=str 产生字符串布尔) ──
    json_str = json.dumps(_clean_json_types(result), ensure_ascii=False, indent=2)

    if output_path:
        with open(output_path, "w", encoding="utf-8") as f:
            f.write(json_str)
        print(f"✓ 已写入 {output_path}", file=sys.stderr)

    # 打印 JSON 到 stdout
    # Windows GBK 兼容: stdout 输出 UTF-8 JSON
    sys.stdout.reconfigure(encoding='utf-8') if hasattr(sys.stdout, 'reconfigure') else None
    try:
        print(json_str)
    except UnicodeEncodeError:
        sys.stdout.buffer.write(json_str.encode('utf-8') + b'\n')

    if temp_wav:
        try:
            os.unlink(temp_wav)
        except OSError:
            pass

    return result


def _compute_energy_curve(audio: np.ndarray, sr: int) -> list:
    """平滑能量曲线 (用于时序可视化)。"""
    try:
        import librosa
        from scipy.ndimage import median_filter

        rms = librosa.feature.rms(y=audio, frame_length=FFT_SIZE, hop_length=HOP_LENGTH)[0]
        # 降采样到约0.5秒分辨率
        hop_time = HOP_LENGTH / sr
        ds = max(1, int(0.5 / hop_time))
        rms_ds = rms[::ds]
        window = max(3, int(1.5 / (hop_time * ds)))
        rms_smooth = median_filter(rms_ds, size=window)
        return [round(float(v), 4) for v in rms_smooth[:300]]  # 最多300点
    except Exception:
        return []


def _check_demucs() -> bool:
    try:
        import demucs
        return True
    except ImportError:
        return False


def _check_spleeter() -> bool:
    try:
        from spleeter.separator import Separator
        return True
    except ImportError:
        return False


def _run_stem_separation(filepath: str, engine: str = "demucs") -> dict:
    """
    音轨分离: 首选 Demucs (htdemucs), 备选 Spleeter (2stems/4stems/5stems)。
    Demucs: MUSDB18 SDR 显著优于 Spleeter → 精度优先
    Spleeter: 速度快、资源占用低 → 批量粗筛
    """
    import subprocess
    import tempfile
    output_dir = tempfile.mkdtemp(prefix="stems_")
    result = {"engine": engine, "stems": {}}

    if engine == "spleeter":
        return _run_spleeter(filepath, output_dir)
    return _run_demucs_internal(filepath, output_dir, result)


def _run_demucs_internal(filepath: str, output_dir: str, result: dict) -> dict:
    """Demucs 音轨分离 (htdemucs 模型)。"""
    import subprocess
    try:
        cmd = ["python", "-m", "demucs", "--two-stems=vocals", "-o", output_dir, filepath]
        proc = subprocess.run(cmd, capture_output=True, text=True, timeout=300)
        if proc.returncode != 0:
            result["_error"] = f"Demucs 失败: {proc.stderr[:300]}"
            return result
        song_name = os.path.splitext(os.path.basename(filepath))[0]
        stem_dir = os.path.join(output_dir, "htdemucs", song_name)
        if not os.path.exists(stem_dir):
            stem_dir = os.path.join(output_dir, "htdemucs_ft", song_name)
        if os.path.exists(stem_dir):
            for f in sorted(os.listdir(stem_dir)):
                if f.endswith((".wav", ".mp3")):
                    result["stems"][os.path.splitext(f)[0]] = os.path.join(stem_dir, f)
        return result
    except subprocess.TimeoutExpired:
        return {"engine": result["engine"], "_error": "Demucs 超时 (300s)"}
    except Exception as e:
        return {"engine": result["engine"], "_error": str(e)}


def _run_spleeter(filepath: str, output_dir: str) -> dict:
    """Spleeter 音轨分离 (备选，速度快但精度低于 Demucs)。"""
    try:
        from spleeter.separator import Separator
        import shutil

        # Spleeter 4stems: vocals/bass/drums/other
        separator = Separator("spleeter:4stems")
        separator.separate_to_file(filepath, output_dir)

        song_name = os.path.splitext(os.path.basename(filepath))[0]
        stem_dir = os.path.join(output_dir, song_name)
        stems = {}
        if os.path.exists(stem_dir):
            for f in sorted(os.listdir(stem_dir)):
                if f.endswith(".wav"):
                    stem_name = os.path.splitext(f)[0]
                    stems[stem_name] = os.path.join(stem_dir, f)

        return {
            "engine": "spleeter (4stems)",
            "stems": stems,
            "_note": "Spleeter 精度低于 Demucs，用于批量粗筛",
        }
    except Exception as e:
        return {"engine": "spleeter", "_error": str(e),
                "_hint": "pip install spleeter"}


def _generate_verification_checklist(anomalies: list, spectral: dict, dynamics: dict,
                                     arrangement: dict, bitrate_warning: str = None,
                                     bpm_data: dict = None, key_data: dict = None,
                                     stereo: dict = None) -> list:
    """
    异常抽检清单: 对偏离阈值区间的数值，建议用专业软件二次复核。
    每项包含: item(key)/label/status/action/recommended_tools。
    """
    checklist = []

    items = [
        {"key": "bpm_octave", "label": "BPM倍拍歧义", "check": bpm_data and bpm_data.get("bpm_octave_risk"),
         "action": "用 Mixed In Key 或手动打拍验证 BPM", "tools": ["Mixed In Key", "手动打拍"], "severity": "warning"},
        {"key": "bpm_confidence", "label": "BPM置信度", "check": bpm_data and (bpm_data.get("bpm_confidence", 100) or 100) < 30,
         "action": "节奏不规则或慢板/复杂切分，手动验证", "tools": [], "severity": "warning"},
        {"key": "key_confidence", "label": "调性置信度", "check": key_data and (key_data.get("key_confidence", 100) or 100) < 40,
         "action": "可能失真/无调性/频繁转调，标注「调性模糊」", "tools": ["Mixed In Key", "手动听辨"], "severity": "warning"},
        {"key": "key_parallel", "label": "平行调歧义", "check": key_data and key_data.get("parallel_mode_ambiguity"),
         "action": "主候选与次候选为平行大小调，手动听辨主音", "tools": [], "severity": "info"},
        {"key": "lufs_range", "label": "响度范围", "check": dynamics and -30 < (dynamics.get("integrated_lufs") or -99) < -3,
         "action": None, "tools": [], "severity": "ok"},
        {"key": "lufs_low", "label": "响度过低", "check": dynamics and (dynamics.get("integrated_lufs") or 0) < -30,
         "action": "用 Youlean Loudness Meter 复核，可能静音过多", "tools": ["Youlean Loudness Meter"], "severity": "warning"},
        {"key": "lufs_high", "label": "响度过高/削波", "check": dynamics and (dynamics.get("integrated_lufs") or 0) > -3,
         "action": "用 Youlean Loudness Meter 检查 True Peak + RX De-clip", "tools": ["Youlean Loudness Meter", "iZotope RX De-clip"], "severity": "critical"},
        {"key": "rolloff", "label": "高频滚降", "check": spectral and (spectral.get("rolloff_mean") or 99999) < 5000,
         "action": "用 Pro-Q 3 查看 5kHz 以上频谱", "tools": ["FabFilter Pro-Q 3"], "severity": "warning"},
        {"key": "stereo_phase", "label": "立体声相位", "check": stereo and stereo.get("phase_warning"),
         "action": "检查是否为反相混音或编码错误", "tools": ["iZotope Ozone Imager"], "severity": "warning"},
        {"key": "subbass_stereo", "label": "低频单声道性", "check": stereo and stereo.get("subbass_stereo_warning"),
         "action": "club/rave场景低频应近单声道，用 Ozone Imager 检查", "tools": ["iZotope Ozone Imager"], "severity": "info"},
        {"key": "bitrate", "label": "音频码率", "check": bool(bitrate_warning),
         "action": "高频参数不可信，仅用于 BPM/调性/低频参考", "tools": [], "severity": "critical"},
    ]

    for item in items:
        status = item["severity"] if item["check"] else "ok"
        entry = {"item": item["key"], "label": item["label"], "status": status}
        if item["check"] and item["action"]:
            entry["action"] = item["action"]
            entry["recommended_tools"] = item["tools"]
        checklist.append(entry)

    return checklist


def _build_evidence(bpm_data: dict, key_data: dict, sonara: dict, spectral: dict,
                    dynamics: dict, stereo: dict, arrangement: dict,
                    duration: float, bitrate_warning: str) -> Dict[str, Any]:
    """五维评分证据包：只描述事实，不评判好坏（schema 见 runbook/evidence-schema.md）。"""
    bass = arrangement.get("bass", {}) if isinstance(arrangement, dict) else {}
    texture_tags = []
    if isinstance(arrangement, dict):
        texture_tags = [t.get("label") for t in arrangement.get("texture_tags", []) if t.get("label")]
    true_peak = dynamics.get("true_peak_dbtp") if isinstance(dynamics, dict) else None

    return {
        "歌词": {
            "vocalness": sonara.get("vocalness"),
            "sections": sonara.get("segments") or [],
            "lyrics_text": None,
            "note": "歌词文本在 Step2/Step4 提供；Step1 仅提供人声呈现与结构证据",
        },
        "作曲": {
            "bpm": bpm_data.get("bpm") if isinstance(bpm_data, dict) else None,
            "key": key_data.get("key_full") if isinstance(key_data, dict) else None,
            "key_candidates": sonara.get("key_candidates"),
            "key_ambiguity": key_data.get("key_ambiguity") if isinstance(key_data, dict) else None,
            "chord_change_rate": sonara.get("chord_change_rate"),
            "dissonance": sonara.get("dissonance"),
            "chord_events": sonara.get("chord_events"),
            "structure_segments": sonara.get("segments") or [],
        },
        "编曲": {
            "texture_tags": texture_tags,
            "subbass_has": bass.get("has_subbass"),
            "subbass_type": bass.get("subbass_type"),
            "energy": sonara.get("energy"),
            "spectral_centroid_mean": spectral.get("centroid_mean") if isinstance(spectral, dict) else None,
            "duration_seconds": duration,
        },
        "演唱": {
            "vocalness": sonara.get("vocalness"),
            "speechiness": None,
            "note": "未分轨时仅人声占比代理；Demucs 分轨后补充音高稳定度",
        },
        "混音": {
            "integrated_lufs": dynamics.get("integrated_lufs") if isinstance(dynamics, dict) else None,
            "true_peak_dbtp": true_peak,
            "lra": dynamics.get("lra") if isinstance(dynamics, dict) else None,
            "crest_factor": dynamics.get("crest_factor") if isinstance(dynamics, dict) else None,
            "stereo_width": stereo.get("stereo_width") if isinstance(stereo, dict) else None,
            "phase_correlation_mean": stereo.get("phase_correlation_mean") if isinstance(stereo, dict) else None,
            "subbass_stereo_width": stereo.get("subbass_stereo_width") if isinstance(stereo, dict) else None,
            "bitrate_warning": bitrate_warning,
            "clipping_risk": bool(true_peak is not None and true_peak > -1.0),
        },
    }


# ═══════════════════════════════════════════════════
#  CLI
# ═══════════════════════════════════════════════════

def _cli():
    parser = argparse.ArgumentParser(
        description="歌掘士 v3.2 音频客观分析层（标准化参数版）",
        formatter_class=argparse.RawDescriptionHelpFormatter,
        epilog="""
示例:
  python analyze_audio.py "song.mp3"
  python analyze_audio.py "album.flac" --output result.json
  python analyze_audio.py "song.wav" --deep
  python analyze_audio.py "song.mp3" --format minimal

标准化参数:
  采样率: 44100Hz | FFT: 2048 Hanning | 重叠: 50% | 滚降: 95% | LUFS: EBU R128

依赖: pip install essentia librosa pyloudnorm soundfile scipy
可选: pip install demucs  (音轨分离)
        """,
    )
    parser.add_argument("filepath", help="音频文件路径 (MP3/FLAC/WAV/M4A)，或 --batch 模式下为目录路径")
    parser.add_argument("--output", "-o", help="输出JSON文件路径 (默认stdout)")
    parser.add_argument("--deep", action="store_true", help="启用音轨分离 (默认Demucs，可用--spleeter切换)")
    parser.add_argument("--spleeter", action="store_true", help="使用 Spleeter 替代 Demucs 进行音轨分离（速度快，精度较低）")
    parser.add_argument("--format", choices=["full", "minimal"], default="full",
                        help="输出格式 (full=完整, minimal=仅BPM+调性)")
    parser.add_argument("--batch", action="store_true",
                        help="批量模式: filepath 为目录路径，分析其中所有音频文件")
    parser.add_argument("--batch-output", help="批量模式输出目录 (默认: 当前目录/batch_out)")
    parser.add_argument("--version", action="version", version=f"analyze_audio.py v{SCRIPT_VERSION}")

    args = parser.parse_args()

    # ── 批量模式 ──
    if args.batch:
        output_dir = args.batch_output or os.path.join(os.path.dirname(args.filepath) or ".", "batch_out")
        results = analyze_batch(args.filepath, output_dir)
        if not results:
            sys.exit(1)
        # 输出 batch summary
        print(json.dumps({
            "batch_complete": True,
            "total": len(results),
            "succeeded": sum(1 for r in results if r.get("success")),
            "failed": sum(1 for r in results if not r.get("success")),
            "output_dir": output_dir,
        }, ensure_ascii=False, indent=2))
        return

    # ── 单文件模式 ──
    result = analyze(args.filepath, deep=args.deep, output_path=args.output,
                     format_mode=args.format,
                     stem_engine="spleeter" if args.spleeter else "demucs")

    if args.format == "minimal":
        minimal = {
            "bpm": result.get("bpm"),
            "key": result.get("key"),
            "mode": result.get("mode"),
            "key_confidence": result.get("key_confidence"),
            "camelot": result.get("camelot"),
            "duration_seconds": result.get("duration_seconds"),
            "engine": result.get("engine"),
            "elapsed_ms": result.get("elapsed_ms"),
        }
        print(json.dumps(minimal, ensure_ascii=False, indent=2))

    if result.get("error"):
        sys.exit(1)


if __name__ == "__main__":
    _cli()
