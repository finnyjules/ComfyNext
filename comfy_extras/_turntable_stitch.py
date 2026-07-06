"""Concatenate turntable segment clips into one seamless video with PyAV.

Drops the first frame of every clip after the first: consecutive segments share
a real boundary photo (segment N's last frame == segment N+1's first frame), so
dropping the duplicate avoids a 1-frame stutter. Output dimensions/fps follow the
first clip. (PyAV is already used in comfy_extras/nodes_timeline.py.)"""
from __future__ import annotations

import io
from fractions import Fraction

import av


def stitch_clips(sources: list) -> io.BytesIO:
    if not sources:
        raise ValueError("stitch_clips: no clips to concatenate")
    out_buf = io.BytesIO()
    out_container = None
    out_stream = None
    out_fps = None
    out_frame_idx = 0
    W = H = None
    for idx, src in enumerate(sources):
        if hasattr(src, "seek"):
            src.seek(0)
        with av.open(src, mode="r") as cin:
            vin = cin.streams.video[0]
            fps = vin.average_rate or Fraction(24, 1)
            frame_no = 0
            for frame in cin.decode(vin):
                if out_container is None:
                    W, H = frame.width, frame.height
                    out_fps = fps
                    out_container = av.open(out_buf, mode="w", format="mp4")
                    out_stream = out_container.add_stream("h264", rate=out_fps)
                    out_stream.width, out_stream.height = W, H
                    out_stream.pix_fmt = "yuv420p"
                    out_stream.options = {"preset": "veryfast", "crf": "20"}
                # Drop the duplicate boundary frame at the start of joined clips.
                if idx > 0 and frame_no == 0:
                    frame_no += 1
                    continue
                frame_no += 1
                rf = frame.reformat(width=W, height=H, format="yuv420p")
                # Decoded frames carry the *input* stream's pts/time_base, which is
                # meaningless in the output stream's time_base. Rather than clearing
                # pts (which stamps every frame at t=0 and collapses the container's
                # duration), assign an explicit monotonic output-frame index in the
                # output stream's own 1/fps time_base so timestamps stay correct and
                # strictly increasing across all joined clips.
                rf.pts = out_frame_idx
                rf.time_base = Fraction(1, 1) / out_fps
                out_frame_idx += 1
                for pkt in out_stream.encode(rf):
                    out_container.mux(pkt)
    for pkt in out_stream.encode():
        out_container.mux(pkt)
    out_container.close()
    out_buf.seek(0)
    return out_buf
