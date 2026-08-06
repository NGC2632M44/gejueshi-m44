"""Audio engine regression tests: container detection, ffprobe metadata,
JSON type cleanliness, and BPM ground truth on the two hand-labeled tracks."""

import importlib.util
import json
import subprocess
import sys
from pathlib import Path

import numpy as np
import pytest

ROOT = Path(__file__).resolve().parents[1]
AUDIO = ROOT / "audio"
MODULE_PATH = ROOT / "scripts" / "analyze_audio.py"

CAMERA = AUDIO / "Charli xcx - Camera - YouTube.mp3"          # truth: 126 BPM / B major
WET_WILD = AUDIO / "Rose Gray - Wet &Wild - YouTube.mp3"       # truth: 127-128 BPM / A minor
REAL_MP3 = AUDIO / "Look-at-Her-Face-YouTube.mp3"
CAMERA_WAV = AUDIO / "_camera_test.wav"


def _load_module():
    spec = importlib.util.spec_from_file_location("analyze_audio", MODULE_PATH)
    mod = importlib.util.module_from_spec(spec)
    spec.loader.exec_module(mod)
    return mod


aa = _load_module()


def _run_cli(path: Path) -> dict:
    r = subprocess.run(
        [sys.executable, str(MODULE_PATH), str(path)],
        capture_output=True, text=True, encoding="utf-8", errors="replace",
        timeout=300, cwd=str(ROOT),
    )
    assert r.returncode == 0, r.stderr[-1200:]
    return json.loads(r.stdout)


def test_sniff_container_flags_fake_mp3():
    info = aa._sniff_container(str(CAMERA))
    assert info["container"] == "webm/mkv"
    assert info["is_fake_mp3"] is True


def test_sniff_container_accepts_real_mp3_and_wav():
    assert aa._sniff_container(str(REAL_MP3))["container"] == "mp3"
    assert aa._sniff_container(str(REAL_MP3))["is_fake_mp3"] is False
    assert aa._sniff_container(str(CAMERA_WAV))["container"] == "wav"


def test_ffprobe_meta_reports_real_codec():
    meta = aa._ffprobe_audio_meta(str(CAMERA))
    assert meta.get("codec") == "opus"
    assert "webm" in (meta.get("format_name") or "")
    assert meta.get("bit_rate") is not None


def test_clean_json_types_converts_numpy_to_native():
    sample = {
        "b": np.bool_(True),
        "i": np.int64(3),
        "f": np.float32(1.5),
        "arr": np.array([1, 2]),
    }
    cleaned = aa._clean_json_types(sample)
    dumped = json.dumps(cleaned, ensure_ascii=False)
    assert '"b": true' in dumped
    assert '"i": 3' in dumped
    assert '"arr": [1, 2]' in dumped
    assert isinstance(cleaned["b"], bool)


@pytest.mark.slow
def test_cli_camera_bpm_container_warning_and_json_types():
    result = _run_cli(CAMERA)
    assert result["success"] is True
    assert 124 <= result["bpm"] <= 128, f"Camera BPM {result['bpm']} != 126"
    assert result["audio_meta"]["container"] == "webm/mkv"
    assert result["audio_meta"]["is_fake_mp3"] is True
    assert result["audio_meta"]["codec"] == "opus"
    assert result["bitrate_warning"] and "并非标准 MP3" in result["bitrate_warning"]
    # JSON 类型干净：布尔必须是布尔，不是字符串
    has_subbass = result["arrangement"]["bass"]["has_subbass"]
    assert isinstance(has_subbass, bool), f"has_subbass 类型异常: {type(has_subbass)}"
    # 顶层 JSON 不应出现字符串布尔
    assert '"has_subbass": "True"' not in json.dumps(result, ensure_ascii=False)


@pytest.mark.slow
def test_cli_wet_wild_bpm():
    result = _run_cli(WET_WILD)
    assert result["success"] is True
    assert 126 <= result["bpm"] <= 130, f"Wet&Wild BPM {result['bpm']} != 127-128"
    assert result["audio_meta"]["is_fake_mp3"] is True
