#!/usr/bin/env python3
"""Regression checks for True Peak channel handling."""

import importlib.util
from pathlib import Path

import numpy as np


MODULE_PATH = Path(__file__).with_name("analyze_audio.py")
spec = importlib.util.spec_from_file_location("analyze_audio", MODULE_PATH)
analyze_audio = importlib.util.module_from_spec(spec)
spec.loader.exec_module(analyze_audio)


def assert_close(actual, expected, tolerance=0.2):
    if abs(actual - expected) > tolerance:
        raise AssertionError(f"expected {expected} +/- {tolerance}, got {actual}")


def test_true_peak_uses_loudest_channel():
    samples = 2048
    stereo = np.zeros((samples, 2), dtype=np.float64)
    stereo[100, 0] = 0.25
    stereo[100, 1] = 1.0

    sample_peak = analyze_audio._compute_true_peak(stereo, 44100)

    if sample_peak < -1.0:
        raise AssertionError(f"true peak should follow the loudest channel, got {sample_peak} dBTP")


def test_true_peak_does_not_average_opposite_channels():
    samples = 2048
    stereo = np.zeros((samples, 2), dtype=np.float64)
    stereo[100, 0] = 1.0
    stereo[100, 1] = -1.0

    sample_peak = analyze_audio._compute_true_peak(stereo, 44100)

    if sample_peak < -1.0:
        raise AssertionError(f"opposite channels were likely averaged away, got {sample_peak} dBTP")


def test_true_peak_accepts_channel_first_layout():
    samples = 2048
    stereo = np.zeros((2, samples), dtype=np.float64)
    stereo[0, 100] = 1.0
    stereo[1, 100] = -1.0

    sample_peak = analyze_audio._compute_true_peak(stereo, 44100)

    if sample_peak < -1.0:
        raise AssertionError(f"channel-first layout lost true peak, got {sample_peak} dBTP")


if __name__ == "__main__":
    test_true_peak_uses_loudest_channel()
    test_true_peak_does_not_average_opposite_channels()
    test_true_peak_accepts_channel_first_layout()
    print("true peak regression tests passed")
