"""Video / temporal effects.

Comfy passes video around as Image batches with shape [T, H, W, 3] where the
batch dim is time. Every node in this file accepts and returns that shape.
Hooking up: LoadVideo → GetVideoComponents → <effect> → CreateVideo → SaveVideo.

Live preview shows the middle frame of the resulting batch so users get a
visual without scrubbing.
"""
from __future__ import annotations

import os
from math import cos, pi, sin

import numpy as np
import torch
import torch.nn.functional as F
from typing_extensions import override

import folder_paths
from comfy_api.latest import ComfyExtension, IO, InputImpl
from comfy_extras._live_preview import save_live_preview


# ---------------------------------------------------------------------------
# Helpers
# ---------------------------------------------------------------------------


def _preview(images: torch.Tensor, uid) -> dict | None:
    """Save the middle frame to the live-preview slot."""
    if images.shape[0] == 0:
        return None
    mid = images.shape[0] // 2
    return save_live_preview(images[mid:mid + 1], str(uid))


def _value_noise_2d(
    h: int,
    w: int,
    scale: float,
    seed: int,
    device,
    dtype,
) -> torch.Tensor:
    """[H,W] smooth noise in [0,1] — same shape as nodes_glsl_unicorn helper."""
    g = torch.Generator(device="cpu").manual_seed(int(seed) & 0x7FFFFFFF)
    low_h = max(2, int(h / max(1.0, scale)))
    low_w = max(2, int(w / max(1.0, scale)))
    low = torch.rand((1, 1, low_h, low_w), generator=g).to(device=device, dtype=dtype)
    return F.interpolate(
        low, size=(h, w), mode="bilinear", align_corners=False,
    ).squeeze(0).squeeze(0)


# ---------------------------------------------------------------------------
# 1. Frame Trail
# ---------------------------------------------------------------------------


class FrameTrailNode(IO.ComfyNode):
    """Decay previous frames into the current one to create motion trails."""
    @classmethod
    def define_schema(cls):
        return IO.Schema(
            node_id="FrameTrail",
            display_name="Frame Trail",
            description="Blend previous frames with decaying intensity to create motion trails.",
            category="video",
            inputs=[
                IO.Image.Input("frames"),
                IO.Float.Input("decay", default=0.85, min=0.0, max=0.99, step=0.01,
                              tooltip="Trail persistence per frame. 0 = no trail, 0.99 = long tail."),
                IO.Combo.Input("blend_mode", options=["screen", "add", "max"], default="screen",
                              tooltip="How the trail combines with each new frame."),
                IO.Float.Input("intensity", default=1.0, min=0.0, max=2.0, step=0.05),
                IO.Float.Input("threshold", default=0.0, min=0.0, max=1.0, step=0.01,
                              tooltip="Only pixels brighter than this trail. 0 = trail everything."),
            ],
            outputs=[IO.Image.Output(display_name="frames")],
            hidden=[IO.Hidden.unique_id],
            is_output_node=True,
        )

    @classmethod
    def execute(cls, frames, decay, blend_mode, intensity, threshold) -> IO.NodeOutput:
        T = frames.shape[0]
        if T <= 1:
            return IO.NodeOutput(frames, ui=_preview(frames, cls.hidden.unique_id))

        out = torch.empty_like(frames)
        out[0] = frames[0]
        acc = frames[0].clone()
        d = float(decay)
        thresh = float(threshold)

        for t in range(1, T):
            # Decay the trail buffer, then refresh it with bright parts of the new frame.
            acc = acc * d
            if thresh > 0.0:
                lum = 0.2126 * frames[t][..., 0] + 0.7152 * frames[t][..., 1] + 0.0722 * frames[t][..., 2]
                mask = (lum > thresh).unsqueeze(-1).to(frames.dtype)
                acc = torch.maximum(acc, frames[t] * mask)
            else:
                acc = torch.maximum(acc, frames[t])

            trail = acc * float(intensity)
            cur = frames[t]
            if blend_mode == "screen":
                blended = 1.0 - (1.0 - cur) * (1.0 - trail)
            elif blend_mode == "add":
                blended = cur + trail
            else:  # max
                blended = torch.maximum(cur, trail)
            out[t] = blended.clamp(0.0, 1.0)

        return IO.NodeOutput(out, ui=_preview(out, cls.hidden.unique_id))


# ---------------------------------------------------------------------------
# 2. Temporal Motion Blur
# ---------------------------------------------------------------------------


class TemporalMotionBlurNode(IO.ComfyNode):
    """Average frames in a sliding window — real motion blur."""
    @classmethod
    def define_schema(cls):
        return IO.Schema(
            node_id="TemporalMotionBlur",
            display_name="Motion Blur (Time)",
            description="Average adjacent frames in a sliding window — real motion blur from real motion.",
            category="video",
            inputs=[
                IO.Image.Input("frames"),
                IO.Int.Input("radius", default=2, min=1, max=12, step=1,
                            tooltip="Window radius (frames on each side). Larger = more blur."),
                IO.Combo.Input("falloff", options=["uniform", "linear", "gaussian"],
                              default="gaussian",
                              tooltip="Weight curve across the window. Gaussian feels most natural."),
            ],
            outputs=[IO.Image.Output(display_name="frames")],
            hidden=[IO.Hidden.unique_id],
            is_output_node=True,
        )

    @classmethod
    def execute(cls, frames, radius, falloff) -> IO.NodeOutput:
        r = int(radius)
        T = frames.shape[0]
        if T <= 1 or r <= 0:
            return IO.NodeOutput(frames, ui=_preview(frames, cls.hidden.unique_id))

        window = 2 * r + 1
        device, dtype = frames.device, frames.dtype
        # Compute weights for the window.
        if falloff == "uniform":
            w = torch.ones(window, device=device, dtype=dtype)
        elif falloff == "linear":
            w = 1.0 - (torch.arange(window, device=device, dtype=dtype) - r).abs() / r
            w = w.clamp(min=0.0)
        else:  # gaussian
            x = torch.arange(window, device=device, dtype=dtype) - r
            sigma = max(1.0, r / 2.0)
            w = torch.exp(-(x * x) / (2 * sigma * sigma))
        w = w / w.sum()

        # Pad time axis with replicate, unfold, weighted-sum, restore shape.
        fr = frames.permute(1, 2, 3, 0)  # [H,W,C,T]
        fr_pad = F.pad(fr, (r, r), mode="replicate")  # [H,W,C,T+2r]
        unfolded = fr_pad.unfold(-1, window, 1)  # [H,W,C,T,window]
        out = (unfolded * w.view(1, 1, 1, 1, -1)).sum(-1)
        out = out.permute(3, 0, 1, 2).contiguous().clamp(0.0, 1.0)
        return IO.NodeOutput(out, ui=_preview(out, cls.hidden.unique_id))


# ---------------------------------------------------------------------------
# 3. Slit Scan
# ---------------------------------------------------------------------------


class SlitScanNode(IO.ComfyNode):
    """Each column reads from a different point in time."""
    @classmethod
    def define_schema(cls):
        return IO.Schema(
            node_id="SlitScan",
            display_name="Slit Scan",
            description="Each column (or row) shows a different time offset — fast subjects smear.",
            category="video",
            inputs=[
                IO.Image.Input("frames"),
                IO.Float.Input("delay", default=1.0, min=0.0, max=4.0, step=0.05,
                              tooltip="How much time stretches across the image. 1 = full sweep."),
                IO.Combo.Input("axis", options=["horizontal", "vertical"], default="horizontal"),
                IO.Boolean.Input("wrap", default=False,
                                tooltip="Wrap time on overflow instead of clamping."),
            ],
            outputs=[IO.Image.Output(display_name="frames")],
            hidden=[IO.Hidden.unique_id],
            is_output_node=True,
        )

    @classmethod
    def execute(cls, frames, delay, axis, wrap) -> IO.NodeOutput:
        T, H, W, _ = frames.shape
        if T <= 1:
            return IO.NodeOutput(frames, ui=_preview(frames, cls.hidden.unique_id))
        device = frames.device

        if axis == "horizontal":
            # src_t[t,h,w] = t + w * (delay * T / W)
            delay_per_step = float(delay) * T / W
            steps = torch.arange(W, device=device).view(1, 1, W).float()
        else:
            delay_per_step = float(delay) * T / H
            steps = torch.arange(H, device=device).view(1, H, 1).float()

        ts = torch.arange(T, device=device).view(T, 1, 1).float()
        src = ts + steps * delay_per_step
        if wrap:
            src_t = (src.long()) % T
        else:
            src_t = src.long().clamp(0, T - 1)
        src_t = src_t.expand(T, H, W)
        ys = torch.arange(H, device=device).view(1, H, 1).expand(T, H, W)
        xs = torch.arange(W, device=device).view(1, 1, W).expand(T, H, W)
        out = frames[src_t, ys, xs]
        return IO.NodeOutput(out, ui=_preview(out, cls.hidden.unique_id))


# ---------------------------------------------------------------------------
# 4. Time Displacement
# ---------------------------------------------------------------------------


class TimeDisplacementNode(IO.ComfyNode):
    """Per-pixel time offset driven by a noise pattern."""
    @classmethod
    def define_schema(cls):
        return IO.Schema(
            node_id="TimeDisplacement",
            display_name="Time Displacement",
            description="Different regions sample from different points in time, driven by noise.",
            category="video",
            inputs=[
                IO.Image.Input("frames"),
                IO.Float.Input("strength", default=4.0, min=0.0, max=30.0, step=0.5,
                              tooltip="Maximum time offset in frames."),
                IO.Float.Input("noise_scale", default=120.0, min=8.0, max=400.0, step=2.0,
                              tooltip="Spatial scale of the noise — bigger = larger coherent regions."),
                IO.Boolean.Input("wrap", default=True,
                                tooltip="Wrap time at clip ends instead of clamping."),
                IO.Int.Input("seed", default=0, min=0, max=2**31 - 1, step=1),
            ],
            outputs=[IO.Image.Output(display_name="frames")],
            hidden=[IO.Hidden.unique_id],
            is_output_node=True,
        )

    @classmethod
    def execute(cls, frames, strength, noise_scale, wrap, seed) -> IO.NodeOutput:
        T, H, W, _ = frames.shape
        if T <= 1 or float(strength) <= 0.0:
            return IO.NodeOutput(frames, ui=_preview(frames, cls.hidden.unique_id))
        device, dtype = frames.device, frames.dtype
        n = _value_noise_2d(H, W, float(noise_scale), int(seed), device, dtype)
        offset = (n * 2.0 - 1.0) * float(strength)  # [-strength, +strength]
        ts = torch.arange(T, device=device).view(T, 1, 1).float()
        src = ts + offset.unsqueeze(0)
        if wrap:
            src_t = (src.round().long()) % T
        else:
            src_t = src.round().long().clamp(0, T - 1)
        src_t = src_t.expand(T, H, W)
        ys = torch.arange(H, device=device).view(1, H, 1).expand(T, H, W)
        xs = torch.arange(W, device=device).view(1, 1, W).expand(T, H, W)
        out = frames[src_t, ys, xs]
        return IO.NodeOutput(out, ui=_preview(out, cls.hidden.unique_id))


# ---------------------------------------------------------------------------
# 5. Reverse / Ping-Pong
# ---------------------------------------------------------------------------


class VideoReverseNode(IO.ComfyNode):
    @classmethod
    def define_schema(cls):
        return IO.Schema(
            node_id="VideoReverse",
            display_name="Reverse / Ping-Pong",
            description="Reverse the clip, or play forward then backward for a seamless loop.",
            category="video",
            inputs=[
                IO.Image.Input("frames"),
                IO.Combo.Input("mode", options=["reverse", "ping_pong"], default="reverse"),
            ],
            outputs=[IO.Image.Output(display_name="frames")],
            hidden=[IO.Hidden.unique_id],
            is_output_node=True,
        )

    @classmethod
    def execute(cls, frames, mode) -> IO.NodeOutput:
        T = frames.shape[0]
        if mode == "reverse":
            out = torch.flip(frames, dims=[0])
        else:  # ping_pong
            if T <= 2:
                out = torch.cat([frames, torch.flip(frames, dims=[0])], dim=0)
            else:
                # Drop the duplicate end frames for a seamless loop.
                out = torch.cat([frames, torch.flip(frames[1:-1], dims=[0])], dim=0)
        return IO.NodeOutput(out, ui=_preview(out, cls.hidden.unique_id))


# ---------------------------------------------------------------------------
# 6. Trim
# ---------------------------------------------------------------------------


class VideoTrimNode(IO.ComfyNode):
    @classmethod
    def define_schema(cls):
        return IO.Schema(
            node_id="VideoTrim",
            display_name="Trim",
            description="Keep only frames in the range [start, end).",
            category="video",
            inputs=[
                IO.Image.Input("frames"),
                IO.Int.Input("start", default=0, min=0, max=10000, step=1),
                IO.Int.Input("end", default=-1, min=-1, max=10000, step=1,
                            tooltip="End frame, exclusive. -1 = until end of clip."),
            ],
            outputs=[IO.Image.Output(display_name="frames")],
            hidden=[IO.Hidden.unique_id],
            is_output_node=True,
        )

    @classmethod
    def execute(cls, frames, start, end) -> IO.NodeOutput:
        T = frames.shape[0]
        s = max(0, min(T, int(start)))
        e = T if int(end) < 0 else max(s, min(T, int(end)))
        out = frames[s:e] if e > s else frames[:1]
        return IO.NodeOutput(out, ui=_preview(out, cls.hidden.unique_id))


# ---------------------------------------------------------------------------
# 7. Crossfade
# ---------------------------------------------------------------------------


class VideoCrossfadeNode(IO.ComfyNode):
    @classmethod
    def define_schema(cls):
        return IO.Schema(
            node_id="VideoCrossfade",
            display_name="Crossfade",
            description="Join two clips with a crossfade. Trim each clip and set the overlap window.",
            category="video",
            inputs=[
                IO.Image.Input("clip_a"),
                IO.Image.Input("clip_b"),
                IO.Int.Input("duration", default=12, min=1, max=2400, step=1,
                            tooltip="Number of frames the two clips overlap = crossfade length."),
                IO.Combo.Input("curve",
                              options=["linear", "ease_in_out", "ease_in", "ease_out"],
                              default="ease_in_out"),
                IO.Int.Input("trim_in_a",  default=0,  min=0, max=100000, step=1,
                            tooltip="Skip this many frames at the start of clip A."),
                IO.Int.Input("trim_out_a", default=-1, min=-1, max=100000, step=1,
                            tooltip="Last frame of clip A to use (exclusive). -1 = end of clip."),
                IO.Int.Input("trim_in_b",  default=0,  min=0, max=100000, step=1),
                IO.Int.Input("trim_out_b", default=-1, min=-1, max=100000, step=1),
            ],
            outputs=[IO.Image.Output(display_name="frames")],
            hidden=[IO.Hidden.unique_id],
            is_output_node=True,
        )

    @classmethod
    def execute(cls, clip_a, clip_b, duration, curve,
                trim_in_a, trim_out_a, trim_in_b, trim_out_b) -> IO.NodeOutput:
        # Apply trims first. -1 means "use the rest of the clip."
        Ta_full, Tb_full = clip_a.shape[0], clip_b.shape[0]
        ia = max(0, min(int(trim_in_a), Ta_full - 1))
        oa = Ta_full if int(trim_out_a) < 0 else max(ia + 1, min(int(trim_out_a), Ta_full))
        ib = max(0, min(int(trim_in_b), Tb_full - 1))
        ob = Tb_full if int(trim_out_b) < 0 else max(ib + 1, min(int(trim_out_b), Tb_full))
        a = clip_a[ia:oa]
        b = clip_b[ib:ob]

        # If shapes still mismatch, conform clip_b to clip_a's H×W.
        if a.shape[1:] != b.shape[1:]:
            Ha, Wa = a.shape[1], a.shape[2]
            b = F.interpolate(
                b.permute(0, 3, 1, 2),
                size=(Ha, Wa), mode="bilinear", align_corners=False,
            ).permute(0, 2, 3, 1).contiguous()

        Ta, Tb = a.shape[0], b.shape[0]
        d = max(1, min(int(duration), Ta, Tb))
        device, dtype = a.device, a.dtype

        alpha = torch.linspace(0.0, 1.0, d, device=device, dtype=dtype)
        if curve == "ease_in_out":
            alpha = 0.5 - 0.5 * torch.cos(alpha * pi)
        elif curve == "ease_in":
            alpha = alpha * alpha
        elif curve == "ease_out":
            alpha = 1.0 - (1.0 - alpha) ** 2
        alpha = alpha.view(-1, 1, 1, 1)

        a_tail = a[Ta - d:]
        b_head = b[:d]
        trans = a_tail * (1.0 - alpha) + b_head * alpha
        out = torch.cat([a[:Ta - d], trans, b[d:]], dim=0).clamp(0.0, 1.0)
        return IO.NodeOutput(out, ui=_preview(out, cls.hidden.unique_id))


# ---------------------------------------------------------------------------
# 8. Animated Noise
# ---------------------------------------------------------------------------


class AnimatedNoiseNode(IO.ComfyNode):
    """Generate a clip of evolving value noise."""
    @classmethod
    def define_schema(cls):
        return IO.Schema(
            node_id="AnimatedNoise",
            display_name="Animated Noise",
            description="Generate a clip of evolving value noise — pans, breathes, or swirls.",
            category="video",
            inputs=[
                IO.Int.Input("width", default=512, min=64, max=2048, step=8),
                IO.Int.Input("height", default=512, min=64, max=2048, step=8),
                IO.Int.Input("frame_count", default=48, min=2, max=600, step=1),
                IO.Float.Input("noise_scale", default=80.0, min=4.0, max=400.0, step=2.0,
                              tooltip="Spatial size of noise features."),
                IO.Float.Input("speed", default=2.0, min=0.0, max=20.0, step=0.1,
                              tooltip="How fast the noise evolves per frame."),
                IO.Combo.Input("motion",
                              options=["pan_x", "pan_y", "diagonal", "breathe", "swirl"],
                              default="diagonal"),
                IO.String.Input("dark_color", default="#000000"),
                IO.String.Input("light_color", default="#ffffff"),
                IO.Int.Input("seed", default=0, min=0, max=2**31 - 1, step=1),
            ],
            outputs=[IO.Image.Output(display_name="frames")],
            hidden=[IO.Hidden.unique_id],
            is_output_node=True,
        )

    @classmethod
    def execute(cls, width, height, frame_count, noise_scale, speed, motion,
                dark_color, light_color, seed) -> IO.NodeOutput:
        T, H, W = int(frame_count), int(height), int(width)
        device = torch.device("cpu")
        dtype = torch.float32

        # Generate one large noise texture and pan a window through it.
        max_pan = max(1, int(T * float(speed)) + 1)
        big_h = H + max_pan
        big_w = W + max_pan
        big = _value_noise_2d(big_h, big_w, float(noise_scale), int(seed), device, dtype)

        def parse_hex(h, fallback):
            s = h.strip().lstrip("#")
            if len(s) == 3:
                s = "".join(c * 2 for c in s)
            if len(s) != 6:
                return fallback
            try:
                return (int(s[0:2], 16) / 255.0, int(s[2:4], 16) / 255.0, int(s[4:6], 16) / 255.0)
            except ValueError:
                return fallback

        dark = torch.tensor(parse_hex(dark_color, (0, 0, 0)), device=device, dtype=dtype)
        light = torch.tensor(parse_hex(light_color, (1, 1, 1)), device=device, dtype=dtype)

        frames = torch.empty((T, H, W, 3), device=device, dtype=dtype)
        for t in range(T):
            if motion == "pan_x":
                ox, oy = int(t * speed) % max_pan, 0
            elif motion == "pan_y":
                ox, oy = 0, int(t * speed) % max_pan
            elif motion == "diagonal":
                ox = int(t * speed * 0.7) % max_pan
                oy = int(t * speed * 0.7) % max_pan
            elif motion == "breathe":
                ox = int((sin(t * 0.1 * speed) * 0.5 + 0.5) * (max_pan - 1))
                oy = int((cos(t * 0.1 * speed) * 0.5 + 0.5) * (max_pan - 1))
            else:  # swirl
                angle = t * speed * 0.05
                radius = min(t * speed * 0.5, max_pan / 2.0)
                ox = int(cos(angle) * radius + max_pan / 2.0)
                oy = int(sin(angle) * radius + max_pan / 2.0)
            ox = max(0, min(big_w - W, ox))
            oy = max(0, min(big_h - H, oy))
            window = big[oy:oy + H, ox:ox + W].unsqueeze(-1)  # [H,W,1]
            frames[t] = dark * (1.0 - window) + light * window

        frames = frames.clamp(0.0, 1.0)
        return IO.NodeOutput(frames, ui=_preview(frames, cls.hidden.unique_id))


# ---------------------------------------------------------------------------
# 9. Load Video Frames (convenience: LoadVideo + GetVideoComponents)
# ---------------------------------------------------------------------------


class LoadVideoFramesNode(IO.ComfyNode):
    """Load a video file and output its frames directly as an image batch.

    Uses PyAV directly so we can cap the frame count and resolution while
    decoding — Comfy's stock `VideoFromFile.get_components()` decodes the
    whole video to full-res float tensors, which OOMs on 4K + many frames.
    Defaults are tuned for preview compositing (60 frames, 720px long-edge).
    """
    @classmethod
    def define_schema(cls):
        input_dir = folder_paths.get_input_directory()
        files = [f for f in os.listdir(input_dir) if os.path.isfile(os.path.join(input_dir, f))]
        files = folder_paths.filter_files_content_types(files, ["video"])
        return IO.Schema(
            node_id="LoadVideoFrames",
            display_name="Load Video Frames",
            description="Load a video file and output its frames directly as an image batch.",
            category="video",
            inputs=[
                IO.Combo.Input("file", options=sorted(files), upload=IO.UploadType.video),
                IO.Float.Input("max_seconds", default=10.0, min=0.0, max=600.0, step=0.5,
                              tooltip="Cap on seconds to load. 0 = no time limit (still bounded by max_frames)."),
                IO.Int.Input("max_frames", default=600, min=1, max=10000, step=1,
                            tooltip="Hard ceiling on frame count regardless of seconds."),
                IO.Int.Input("max_size", default=720, min=64, max=4096, step=16,
                            tooltip="Cap on the long edge in pixels. Frames are downscaled to fit. Keeps memory bounded."),
                IO.Int.Input("start_frame", default=0, min=0, max=1000000, step=1,
                            tooltip="First frame to read from the video."),
                IO.Int.Input("stride", default=1, min=1, max=60, step=1,
                            tooltip="Keep every Nth frame. >1 effectively reduces fps."),
            ],
            outputs=[
                IO.Image.Output(display_name="frames"),
                IO.Float.Output(display_name="fps"),
            ],
        )

    @classmethod
    def execute(cls, file, max_seconds, max_frames, max_size, start_frame, stride) -> IO.NodeOutput:
        import av
        from PIL import Image as PILImage

        video_path = folder_paths.get_annotated_filepath(file)

        kept: list[torch.Tensor] = []
        fps = 30.0
        with av.open(video_path, mode='r') as container:
            vs = container.streams.video[0]
            w, h = vs.width, vs.height
            scale = min(1.0, float(max_size) / max(w, h))
            tw, th = max(1, int(round(w * scale))), max(1, int(round(h * scale)))
            avg_rate = vs.average_rate
            fps = float(avg_rate) if avg_rate else 30.0

            # Translate max_seconds into a frame ceiling (after stride). 0 = no time cap.
            eff_stride = max(1, int(stride))
            time_cap = int(float(max_seconds) * fps / eff_stride) if float(max_seconds) > 0 else 10**9
            hard_cap = max(1, int(max_frames))
            cap = min(time_cap, hard_cap)

            decoded_idx = 0
            for frame in container.decode(vs):
                if decoded_idx < int(start_frame):
                    decoded_idx += 1
                    continue
                if (decoded_idx - int(start_frame)) % eff_stride != 0:
                    decoded_idx += 1
                    continue
                arr = frame.to_ndarray(format='rgb24')
                if (tw, th) != (w, h):
                    pil = PILImage.fromarray(arr)
                    pil = pil.resize((tw, th), PILImage.BILINEAR)
                    arr = np.asarray(pil)
                t = torch.from_numpy(arr.copy()).to(torch.float32) / 255.0
                kept.append(t)
                decoded_idx += 1
                if len(kept) >= cap:
                    break

        if not kept:
            kept.append(torch.zeros(64, 64, 3))
        images = torch.stack(kept, dim=0)
        effective_fps = fps / max(1, int(stride))
        return IO.NodeOutput(images, float(effective_fps))

    @classmethod
    def fingerprint_inputs(cls, file, **kwargs):
        video_path = folder_paths.get_annotated_filepath(file)
        # Include the decode-shaping widgets in the fingerprint so the cache
        # invalidates when the user changes max_frames, max_size, etc.
        extras = "|".join(f"{k}={kwargs.get(k)}" for k in ("max_seconds", "max_frames", "max_size", "start_frame", "stride"))
        return f"{os.path.getmtime(video_path)}|{extras}"

    @classmethod
    def validate_inputs(cls, file, **kwargs):
        if not folder_paths.exists_annotated_filepath(file):
            return f"Invalid video file: {file}"
        return True


# ---------------------------------------------------------------------------
# Registration
# ---------------------------------------------------------------------------


class SaveVideoFramesNode(IO.ComfyNode):
    """Encode an IMAGE batch directly to an .mp4 file, with optional audio.

    Symmetric with LoadVideoFrames — saves users from the CreateVideo +
    SaveVideo dance for the common "I just want my edited frames as a file"
    case. Uses PyAV (same encoder Comfy already depends on).
    """
    @classmethod
    def define_schema(cls):
        # Audio picker (so users can mux a soundtrack without external tools).
        input_dir = folder_paths.get_input_directory()
        try:
            audio_files = [f for f in os.listdir(input_dir) if os.path.isfile(os.path.join(input_dir, f))]
            audio_files = folder_paths.filter_files_content_types(audio_files, ["audio"])
        except Exception:
            audio_files = []
        audio_options = ["(none)"] + sorted(audio_files)
        return IO.Schema(
            node_id="SaveVideoFrames",
            display_name="Save Video Frames",
            description="Encode an IMAGE batch to an .mp4 file (+ optional audio). No CreateVideo needed.",
            category="video",
            inputs=[
                IO.Image.Input("frames"),
                IO.Float.Input("fps", default=30.0, min=1.0, max=120.0, step=1.0),
                IO.String.Input("filename_prefix", default="video"),
                IO.Combo.Input("audio_file", options=audio_options, default="(none)",
                              upload=IO.UploadType.audio,
                              tooltip="Optional soundtrack mixed in. Cut to match the video duration."),
                IO.Combo.Input("preset", options=["veryfast", "fast", "medium", "slow"],
                              default="veryfast"),
                IO.Int.Input("crf", default=20, min=10, max=32, step=1,
                            tooltip="Quality (lower = better, larger file). 18–23 is typical."),
            ],
            outputs=[],
            hidden=[IO.Hidden.unique_id],
            is_output_node=True,
        )

    @classmethod
    def execute(cls, frames, fps, filename_prefix, audio_file, preset, crf) -> IO.NodeOutput:
        import av
        import time as _time
        from fractions import Fraction as _Fraction

        T, H, W, _C = frames.shape
        if T == 0:
            return IO.NodeOutput()

        output_dir = folder_paths.get_output_directory()
        os.makedirs(output_dir, exist_ok=True)
        stamp = _time.strftime("%Y%m%d_%H%M%S")
        out_name = f"{(filename_prefix or 'video').rstrip('_')}_{stamp}.mp4"
        out_path = os.path.join(output_dir, out_name)

        # Encoder setup — H.264 + yuv420p for max browser/player compatibility.
        # (Even widths/heights required by yuv420p — pad if odd.)
        even_w = W + (W % 2)
        even_h = H + (H % 2)
        out = av.open(out_path, mode="w")
        out_stream = out.add_stream("h264", rate=_Fraction(int(round(fps * 1000)), 1000))
        out_stream.width = even_w
        out_stream.height = even_h
        out_stream.pix_fmt = "yuv420p"
        out_stream.options = {"preset": str(preset), "crf": str(int(crf))}

        # Audio passthrough/transcode.
        audio_in_container = audio_in_stream = audio_out_stream = None
        if audio_file and audio_file != "(none)":
            audio_path = folder_paths.get_annotated_filepath(audio_file)
            if os.path.exists(audio_path):
                try:
                    audio_in_container = av.open(audio_path, mode="r")
                    audio_in_stream = audio_in_container.streams.audio[0]
                    audio_out_stream = out.add_stream("aac", rate=audio_in_stream.rate or 48000)
                    audio_out_stream.layout = "stereo"
                except Exception as e:
                    print(f"[SaveVideoFrames] audio open failed: {e}", flush=True)
                    audio_in_container = audio_in_stream = audio_out_stream = None

        # Encode frames.
        frames_np = (frames.clamp(0, 1).cpu().numpy() * 255.0).astype(np.uint8)
        for i in range(T):
            arr = frames_np[i]
            if even_w != W or even_h != H:
                # Pad to even dims (yuv420p requirement).
                padded = np.zeros((even_h, even_w, 3), dtype=np.uint8)
                padded[:H, :W] = arr
                arr = padded
            av_frame = av.VideoFrame.from_ndarray(arr, format="rgb24")
            for packet in out_stream.encode(av_frame):
                out.mux(packet)
        for packet in out_stream.encode():
            out.mux(packet)

        # Mux audio cut to video duration.
        if audio_in_container is not None and audio_out_stream is not None:
            try:
                target_dur = T / float(fps)
                for frame in audio_in_container.decode(audio_in_stream):
                    if frame.time is not None and frame.time > target_dur:
                        break
                    frame.pts = None
                    for packet in audio_out_stream.encode(frame):
                        out.mux(packet)
                for packet in audio_out_stream.encode():
                    out.mux(packet)
            except Exception as e:
                print(f"[SaveVideoFrames] audio mux failed: {e}", flush=True)

        if audio_in_container is not None:
            try: audio_in_container.close()
            except Exception: pass
        out.close()

        # Surface the file in the UI via the standard preview channel.
        return IO.NodeOutput(ui={
            "images": [{"filename": out_name, "subfolder": "", "type": "output"}],
            "animated": (True,),
        })


class VideoEffectsExtension(ComfyExtension):
    @override
    async def get_node_list(self) -> list[type[IO.ComfyNode]]:
        return [
            LoadVideoFramesNode, SaveVideoFramesNode,
            FrameTrailNode, TemporalMotionBlurNode, SlitScanNode, TimeDisplacementNode,
            VideoReverseNode, VideoTrimNode, VideoCrossfadeNode, AnimatedNoiseNode,
        ]


async def comfy_entrypoint() -> VideoEffectsExtension:
    return VideoEffectsExtension()
