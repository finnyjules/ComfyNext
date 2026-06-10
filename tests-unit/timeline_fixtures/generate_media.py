"""Deterministic PLAYBACK fixtures for the engine specs.

  counter_30f.mp4 — 30 frames, 64×64, 30 fps, H.264 yuv420p, near-lossless
    (qp 1 — NOT qp 0: x264 lossless is only representable in the High 4:4:4
    Predictive profile, which Safari/AVFoundation cannot decode; qp 1 stays
    in High profile and keeps the webkit-engine specs honest), no B-frames,
    keyframe every 10 frames (so frame 13 forces a
    decode-from-keyframe-10 path). Frame i is solid gray value = 8 + i*8
    (max 240). Gray ⇒ chroma constant ⇒ 4:2:0 subsampling is harmless; the
    decoder-side index recovery is round((v - 8) / 8) with ±3 tolerance for
    range-conversion drift.
  tone_440.wav — 1.0 s, 440 Hz sine, mono 16-bit 44.1 kHz, peak 0.5.

Regenerate: .venv/bin/python tests-unit/timeline_fixtures/generate_media.py
Outputs are committed; the mp4 is the fixture of record (libx264 mux bytes are
not guaranteed reproducible) — the sanity test validates the committed file.
"""
import math
import os
import struct
import wave
from fractions import Fraction

import numpy as np

OUT = os.path.join(os.path.dirname(os.path.abspath(__file__)), "assets")
FRAMES, SIZE, FPS = 30, 64, 30


def gen_video() -> None:
    import av
    path = os.path.join(OUT, "counter_30f.mp4")
    out = av.open(path, mode="w")
    stream = out.add_stream("h264", rate=Fraction(FPS, 1))
    stream.width = SIZE
    stream.height = SIZE
    stream.pix_fmt = "yuv420p"
    stream.options = {"qp": "1", "bf": "0", "g": "10", "profile": "high"}
    for i in range(FRAMES):
        v = 8 + i * 8
        arr = np.full((SIZE, SIZE, 3), v, dtype=np.uint8)
        frame = av.VideoFrame.from_ndarray(arr, format="rgb24")
        for packet in stream.encode(frame):
            out.mux(packet)
    for packet in stream.encode():
        out.mux(packet)
    out.close()


def gen_tone() -> None:
    path = os.path.join(OUT, "tone_440.wav")
    rate, dur, freq, peak = 44100, 1.0, 440.0, 0.5
    n = int(rate * dur)
    with wave.open(path, "wb") as w:
        w.setnchannels(1)
        w.setsampwidth(2)
        w.setframerate(rate)
        samples = (
            int(peak * 32767 * math.sin(2 * math.pi * freq * t / rate))
            for t in range(n)
        )
        w.writeframes(b"".join(struct.pack("<h", s) for s in samples))


if __name__ == "__main__":
    os.makedirs(OUT, exist_ok=True)
    gen_video()
    gen_tone()
