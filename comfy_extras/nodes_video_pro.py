"""Pro video toolkit — the nodes a Premiere/AE/CapCut user reaches for daily.

Built on the same IMAGE-batch convention as the rest of the video toolkit.
Each node accepts an image batch `[T, H, W, 3]` (time-first) unless noted.
"""
from __future__ import annotations

import os
import math
import numpy as np
import torch
import torch.nn.functional as F
from PIL import Image as PILImage, ImageDraw
from typing_extensions import override

import folder_paths
from comfy_api.latest import ComfyExtension, IO
from comfy_extras._live_preview import save_live_preview


# ---------------------------------------------------------------------------
# Shared helpers
# ---------------------------------------------------------------------------


def _hex_rgb(s: str, fallback=(0.0, 0.0, 0.0)) -> tuple[float, float, float]:
    s = (s or "").strip().lstrip("#")
    if len(s) == 3:
        s = "".join(c * 2 for c in s)
    if len(s) != 6:
        return fallback
    try:
        return (int(s[0:2], 16) / 255.0, int(s[2:4], 16) / 255.0, int(s[4:6], 16) / 255.0)
    except ValueError:
        return fallback


def _ease(t: torch.Tensor, mode: str) -> torch.Tensor:
    """Apply an easing curve to a linear ramp `t` in [0,1]."""
    if mode == "linear":      return t
    if mode == "ease_in":     return t * t
    if mode == "ease_out":    return 1.0 - (1.0 - t) ** 2
    if mode == "ease_in_out": return 0.5 - 0.5 * torch.cos(t * math.pi)
    return t


def _save_preview(images: torch.Tensor, uid) -> dict | None:
    if images.shape[0] == 0:
        return None
    mid = images.shape[0] // 2
    return save_live_preview(images[mid:mid + 1], str(uid))


# ---------------------------------------------------------------------------
# 1. Speed Ramp
# ---------------------------------------------------------------------------


class SpeedRampNode(IO.ComfyNode):
    """Change playback speed, optionally ramping the rate in/out."""
    @classmethod
    def define_schema(cls):
        return IO.Schema(
            node_id="SpeedRamp",
            display_name="Speed Ramp",
            description="Speed up / slow down a clip, with optional ease-in or ease-out of the rate.",
            category="video",
            inputs=[
                IO.Image.Input("frames"),
                IO.Combo.Input("mode", options=["constant", "ramp_in", "ramp_out", "ramp_in_out"],
                              default="constant"),
                IO.Float.Input("speed", default=2.0, min=0.05, max=10.0, step=0.05,
                              tooltip="Playback rate. 1 = no change, 2 = 2× speed, 0.5 = half-speed."),
                IO.Float.Input("start_speed", default=1.0, min=0.05, max=10.0, step=0.05,
                              tooltip="Starting rate when mode = ramp_in / ramp_in_out."),
                IO.Combo.Input("interpolation", options=["nearest", "blend"], default="blend",
                              tooltip="blend = smooth slow-mo via frame interpolation; nearest = drop/dup."),
            ],
            outputs=[IO.Image.Output(display_name="frames")],
            hidden=[IO.Hidden.unique_id],
            is_output_node=True,
        )

    @classmethod
    def execute(cls, frames, mode, speed, start_speed, interpolation) -> IO.NodeOutput:
        T, H, W, C = frames.shape
        device, dtype = frames.device, frames.dtype
        if T <= 1:
            return IO.NodeOutput(frames, ui=_save_preview(frames, cls.hidden.unique_id))

        # Build a mapping: output frame i → source frame s(i) (float).
        if mode == "constant":
            r = max(0.05, float(speed))
            N = max(1, int(round(T / r)))
            src_idx = torch.linspace(0, T - 1, N, device=device, dtype=torch.float32)
        else:
            # Variable rate r(u) over output-time u ∈ [0,1].
            # Source distance covered when integrating r from 0 to 1 (in
            # output-time units) is `T_out · mean(r)`. We choose T_out so
            # source position reaches T - 1, giving N = round(T_out) frames.
            # Then each output frame's source position is the cumulative
            # integral of r up to its output-time, scaled to span [0, T-1].
            r0 = max(0.05, float(start_speed))
            r1 = max(0.05, float(speed))
            K = 4096
            u = torch.linspace(0.0, 1.0, K, device=device, dtype=torch.float32)
            if mode == "ramp_in":      ease = _ease(u, "ease_in")
            elif mode == "ramp_out":   ease = _ease(u, "ease_out")
            else:                       ease = _ease(u, "ease_in_out")
            rate = r0 + (r1 - r0) * ease  # per-probe rate (samples of output time)
            mean_rate = rate.mean().item()
            N = max(1, int(round((T - 1) / max(1e-6, mean_rate))))
            cum = torch.cumsum(rate, dim=0)
            cum = cum / cum[-1] * (T - 1)  # so cum[-1] == T-1
            # For each output frame i, sample cum at i/(N-1).
            probe_pos = torch.linspace(0.0, K - 1, N, device=device, dtype=torch.float32)
            lo = probe_pos.floor().long().clamp(0, K - 1)
            hi = (lo + 1).clamp(0, K - 1)
            f = probe_pos - lo.float()
            src_idx = (cum[lo] * (1.0 - f) + cum[hi] * f).clamp(0, T - 1)

        idx_lo = src_idx.floor().long().clamp(0, T - 1)
        idx_hi = (idx_lo + 1).clamp(0, T - 1)
        frac = (src_idx - idx_lo.float()).view(-1, 1, 1, 1).to(dtype)
        if interpolation == "nearest":
            out = frames[src_idx.round().long().clamp(0, T - 1)]
        else:
            out = frames[idx_lo] * (1.0 - frac) + frames[idx_hi] * frac
        out = out.clamp(0.0, 1.0)
        return IO.NodeOutput(out, ui=_save_preview(out, cls.hidden.unique_id))


# ---------------------------------------------------------------------------
# 2. Ken Burns / Punch-in
# ---------------------------------------------------------------------------


class KenBurnsNode(IO.ComfyNode):
    """Animated zoom + pan over a clip — the doc-edit 'punch-in' move."""
    @classmethod
    def define_schema(cls):
        return IO.Schema(
            node_id="KenBurns",
            display_name="Ken Burns",
            description="Animated zoom and drift over a clip — from start crop to end crop.",
            category="video",
            inputs=[
                IO.Image.Input("frames"),
                IO.Float.Input("start_zoom", default=1.0, min=1.0, max=4.0, step=0.05),
                IO.Float.Input("end_zoom",   default=1.4, min=1.0, max=4.0, step=0.05),
                IO.Float.Input("start_x", default=0.0, min=-0.5, max=0.5, step=0.01),
                IO.Float.Input("start_y", default=0.0, min=-0.5, max=0.5, step=0.01),
                IO.Float.Input("end_x",   default=0.0, min=-0.5, max=0.5, step=0.01),
                IO.Float.Input("end_y",   default=0.0, min=-0.5, max=0.5, step=0.01),
                IO.Combo.Input("easing", options=["linear", "ease_in", "ease_out", "ease_in_out"],
                              default="ease_in_out"),
            ],
            outputs=[IO.Image.Output(display_name="frames")],
            hidden=[IO.Hidden.unique_id],
            is_output_node=True,
        )

    @classmethod
    def execute(cls, frames, start_zoom, end_zoom, start_x, start_y, end_x, end_y, easing) -> IO.NodeOutput:
        T, H, W, _ = frames.shape
        device, dtype = frames.device, frames.dtype
        t_lin = torch.linspace(0.0, 1.0, T, device=device, dtype=torch.float32)
        t = _ease(t_lin, easing).to(dtype)
        z = start_zoom + (end_zoom - start_zoom) * t
        x = start_x + (end_x - start_x) * t
        y = start_y + (end_y - start_y) * t

        # Build a per-frame affine grid that crops a (1/z) window centered on (x, y).
        # In grid_sample coords [-1,1]: scale factor = 1/z; translate = (x, y) * 2.
        out_list = []
        src = frames.permute(0, 3, 1, 2)  # [T, 3, H, W]
        for i in range(T):
            sx = 1.0 / float(z[i])
            tx, ty = float(x[i]) * 2.0, float(y[i]) * 2.0
            theta = torch.tensor([[sx, 0.0, tx], [0.0, sx, ty]], device=device, dtype=dtype).unsqueeze(0)
            grid = F.affine_grid(theta, (1, 3, H, W), align_corners=False)
            warped = F.grid_sample(src[i:i + 1], grid, mode="bilinear", padding_mode="border", align_corners=False)
            out_list.append(warped)
        out = torch.cat(out_list, dim=0).permute(0, 2, 3, 1).clamp(0.0, 1.0)
        return IO.NodeOutput(out, ui=_save_preview(out, cls.hidden.unique_id))


# ---------------------------------------------------------------------------
# 3. Aspect Convert
# ---------------------------------------------------------------------------


class AspectConvertNode(IO.ComfyNode):
    """Convert between aspect ratios. Crop, pad, or auto-pan to keep the salient region."""
    @classmethod
    def define_schema(cls):
        return IO.Schema(
            node_id="AspectConvert",
            display_name="Aspect Convert",
            description="Reframe a clip to a different aspect ratio (16:9 → 9:16, etc.).",
            category="video",
            inputs=[
                IO.Image.Input("frames"),
                IO.Combo.Input("target", options=["9:16", "1:1", "4:5", "16:9", "21:9", "4:3", "3:4"],
                              default="9:16"),
                IO.Combo.Input("method", options=["crop_center", "pad", "auto_pan"], default="crop_center",
                              tooltip="auto_pan = pick the most salient crop per frame (luma variance)."),
                IO.String.Input("pad_color", default="#000000",
                               tooltip="Used when method = pad."),
            ],
            outputs=[IO.Image.Output(display_name="frames")],
            hidden=[IO.Hidden.unique_id],
            is_output_node=True,
        )

    @classmethod
    def execute(cls, frames, target, method, pad_color) -> IO.NodeOutput:
        T, H, W, _ = frames.shape
        device, dtype = frames.device, frames.dtype
        tw_, th_ = target.split(":")
        ar = float(tw_) / float(th_)

        if method == "pad":
            # Find the smallest enclosing canvas at target aspect that contains the source.
            if W / H > ar:
                ow, oh = W, int(round(W / ar))
            else:
                oh, ow = H, int(round(H * ar))
            pr, pg, pb = _hex_rgb(pad_color)
            bg = torch.tensor([pr, pg, pb], device=device, dtype=dtype).view(1, 1, 1, 3)
            out = bg.expand(T, oh, ow, 3).clone()
            off_y = (oh - H) // 2
            off_x = (ow - W) // 2
            out[:, off_y:off_y + H, off_x:off_x + W, :] = frames
            return IO.NodeOutput(out.clamp(0, 1), ui=_save_preview(out, cls.hidden.unique_id))

        # Crop: find target rectangle (smaller than source).
        if W / H > ar:
            ch, cw = H, int(round(H * ar))
        else:
            cw, ch = W, int(round(W / ar))

        if method == "auto_pan":
            # For each frame, find the column (or row) with highest local luma variance.
            # Simple approach: per-frame compute column-variance, pick argmax.
            lum = (0.2126 * frames[..., 0] + 0.7152 * frames[..., 1] + 0.0722 * frames[..., 2])  # [T,H,W]
            if W > cw:
                col_var = lum.var(dim=1)  # [T, W]
                # Box-filter window-sum equivalent to choose left edge of crop.
                kernel = torch.ones(cw, device=device, dtype=dtype) / cw
                col_score = F.conv1d(col_var.unsqueeze(1), kernel.view(1, 1, -1), padding=0).squeeze(1)
                # col_score has shape [T, W - cw + 1]; argmax → left x.
                left = col_score.argmax(dim=1)
                top = torch.full((T,), max(0, (H - ch) // 2), device=device, dtype=torch.long)
            else:
                row_var = lum.var(dim=2)  # [T, H]
                kernel = torch.ones(ch, device=device, dtype=dtype) / ch
                row_score = F.conv1d(row_var.unsqueeze(1), kernel.view(1, 1, -1), padding=0).squeeze(1)
                top = row_score.argmax(dim=1)
                left = torch.full((T,), max(0, (W - cw) // 2), device=device, dtype=torch.long)
            out = torch.empty((T, ch, cw, 3), device=device, dtype=dtype)
            for i in range(T):
                l, t = int(left[i]), int(top[i])
                out[i] = frames[i, t:t + ch, l:l + cw, :]
            return IO.NodeOutput(out.clamp(0, 1), ui=_save_preview(out, cls.hidden.unique_id))

        # crop_center
        l = max(0, (W - cw) // 2)
        t = max(0, (H - ch) // 2)
        out = frames[:, t:t + ch, l:l + cw, :].contiguous()
        return IO.NodeOutput(out.clamp(0, 1), ui=_save_preview(out, cls.hidden.unique_id))


# ---------------------------------------------------------------------------
# 4. Chroma Key
# ---------------------------------------------------------------------------


class ChromaKeyNode(IO.ComfyNode):
    """Knock out a key color (typically green/blue screen) into transparency.

    Outputs both the keyed RGB image (key color replaced with bg color) and a
    soft alpha mask. Plug the mask into MergeAlpha for RGBA, or use the keyed
    image directly with the Timeline's normal blending.
    """
    @classmethod
    def define_schema(cls):
        return IO.Schema(
            node_id="ChromaKey",
            display_name="Chroma Key",
            description="Knock out a key color (green/blue screen) and emit a soft mask.",
            category="video",
            inputs=[
                IO.Image.Input("frames"),
                IO.String.Input("key_color", default="#00ff00"),
                IO.Float.Input("tolerance", default=0.25, min=0.0, max=1.0, step=0.01,
                              tooltip="Hue/saturation distance considered 'keyed'."),
                IO.Float.Input("smoothness", default=0.1, min=0.0, max=0.5, step=0.01,
                              tooltip="Width of the soft falloff around the threshold."),
                IO.Float.Input("spill_suppression", default=0.5, min=0.0, max=1.0, step=0.01,
                              tooltip="Desaturate the key hue from edge pixels."),
                IO.String.Input("bg_color", default="#000000",
                               tooltip="Color to replace the key region with in the RGB output."),
            ],
            outputs=[
                IO.Image.Output(display_name="frames"),
                IO.Mask.Output(display_name="mask"),
            ],
            hidden=[IO.Hidden.unique_id],
            is_output_node=True,
        )

    @staticmethod
    def _rgb_to_hsv(rgb: torch.Tensor) -> torch.Tensor:
        # rgb: [..., 3] in [0,1]
        r, g, b = rgb[..., 0], rgb[..., 1], rgb[..., 2]
        maxc, _ = rgb.max(dim=-1)
        minc, _ = rgb.min(dim=-1)
        v = maxc
        delta = maxc - minc
        s = torch.where(maxc > 0, delta / maxc.clamp(min=1e-6), torch.zeros_like(maxc))
        # Hue
        rc = (maxc - r) / delta.clamp(min=1e-6)
        gc = (maxc - g) / delta.clamp(min=1e-6)
        bc = (maxc - b) / delta.clamp(min=1e-6)
        h = torch.where(r == maxc, bc - gc,
            torch.where(g == maxc, 2.0 + rc - bc, 4.0 + gc - rc))
        h = (h / 6.0) % 1.0
        h = torch.where(delta > 0, h, torch.zeros_like(h))
        return torch.stack([h, s, v], dim=-1)

    @classmethod
    def execute(cls, frames, key_color, tolerance, smoothness, spill_suppression, bg_color) -> IO.NodeOutput:
        T, H, W, _ = frames.shape
        device, dtype = frames.device, frames.dtype
        kr, kg, kb = _hex_rgb(key_color, (0, 1, 0))
        key = torch.tensor([kr, kg, kb], device=device, dtype=dtype)
        hsv = cls._rgb_to_hsv(frames)
        key_hsv = cls._rgb_to_hsv(key.view(1, 1, 1, 3)).view(3)
        # Distance in hue (wraparound), weighted by saturation.
        dh = (hsv[..., 0] - key_hsv[0]) % 1.0
        dh = torch.minimum(dh, 1.0 - dh) * 2.0  # 0..1
        ds = (hsv[..., 1] - key_hsv[1]).abs()
        # Combined distance: lower = closer to key.
        dist = (dh * 0.7 + ds * 0.3)
        # Mask: 0 inside key (drop), 1 outside (keep). Smoothstep around tolerance.
        lo = max(0.0, float(tolerance) - float(smoothness))
        hi = float(tolerance) + float(smoothness)
        keep = ((dist - lo) / max(hi - lo, 1e-6)).clamp(0.0, 1.0)  # 0..1 mask, 0 = drop

        # Spill suppression: desaturate the key channel near edges.
        if spill_suppression > 0.0:
            # Where keep < 1 (i.e. near key boundary), reduce the key color contribution.
            spill_amt = (1.0 - keep) * float(spill_suppression)
            # Desaturate by pulling toward the orthogonal of key.
            # Simple approach: lerp the key channel toward the mean of the other two channels.
            mean_others = (frames - key.view(1, 1, 1, 3) * 0.5).mean(dim=-1, keepdim=True)
            spilled = frames - (frames * spill_amt.unsqueeze(-1) * key.view(1, 1, 1, 3))
            frames = torch.where(spill_amt.unsqueeze(-1) > 0.01, spilled.clamp(0, 1), frames)

        # Build the keyed RGB output: blend bg through the dropped area.
        br, bg2, bb = _hex_rgb(bg_color, (0, 0, 0))
        bg_t = torch.tensor([br, bg2, bb], device=device, dtype=dtype).view(1, 1, 1, 3)
        keep3 = keep.unsqueeze(-1)
        out_rgb = frames * keep3 + bg_t * (1.0 - keep3)
        return IO.NodeOutput(out_rgb.clamp(0, 1), keep.clamp(0, 1),
                            ui=_save_preview(out_rgb, cls.hidden.unique_id))


# ---------------------------------------------------------------------------
# 5. Caption Track
# ---------------------------------------------------------------------------


class CaptionTrackNode(IO.ComfyNode):
    """Render multi-line timed captions over a clip."""
    @classmethod
    def define_schema(cls):
        return IO.Schema(
            node_id="CaptionTrack",
            display_name="Caption Track",
            description="Burn timed captions onto a clip. One line per caption: 'start end Text…'",
            category="video",
            inputs=[
                IO.Image.Input("frames"),
                IO.String.Input(
                    "captions",
                    default="0 30 Hello\n30 60 Welcome to the show\n60 90 Subscribe please",
                    multiline=True,
                    tooltip=(
                        "One caption per line. Format: `start_frame end_frame Text`.\n"
                        "Frames are timeline frames (not seconds). Lines without two leading numbers are ignored."
                    ),
                ),
                IO.Int.Input("font_size", default=44, min=8, max=256, step=1),
                IO.String.Input("color", default="#ffffff"),
                IO.String.Input("outline_color", default="#000000"),
                IO.Int.Input("outline_width", default=2, min=0, max=12, step=1),
                IO.Combo.Input("position", options=["bottom", "top", "middle"], default="bottom"),
                IO.Float.Input("y_inset", default=0.08, min=0.0, max=0.4, step=0.01),
            ],
            outputs=[IO.Image.Output(display_name="frames")],
            hidden=[IO.Hidden.unique_id],
            is_output_node=True,
        )

    @classmethod
    def execute(cls, frames, captions, font_size, color, outline_color, outline_width,
                position, y_inset) -> IO.NodeOutput:
        from comfy_extras.nodes_text import _load_font
        T, H, W, _ = frames.shape
        # Parse captions.
        segments: list[tuple[int, int, str]] = []
        for line in (captions or "").splitlines():
            parts = line.strip().split(None, 2)
            if len(parts) < 3:
                continue
            try:
                s = int(parts[0]); e = int(parts[1])
            except ValueError:
                continue
            segments.append((s, e, parts[2]))

        if not segments:
            return IO.NodeOutput(frames, ui=_save_preview(frames, cls.hidden.unique_id))

        font = _load_font(int(font_size))
        fr_, fg_, fb_ = _hex_rgb(color, (1, 1, 1))
        or_, og_, ob_ = _hex_rgb(outline_color, (0, 0, 0))
        text_fill = (int(fr_ * 255), int(fg_ * 255), int(fb_ * 255))
        outline_fill = (int(or_ * 255), int(og_ * 255), int(ob_ * 255))

        # Render each frame on CPU through PIL. Slow but bounded by clip length.
        out = frames.clone()
        out_np = (out.cpu().numpy() * 255.0).clip(0, 255).astype(np.uint8)
        for i in range(T):
            # Pick the latest caption that covers this frame.
            active = None
            for s, e, text in segments:
                if s <= i < e:
                    active = text
            if not active:
                continue
            img = PILImage.fromarray(out_np[i])
            draw = ImageDraw.Draw(img)
            bbox = draw.textbbox((0, 0), active, font=font)
            tw, th = bbox[2] - bbox[0], bbox[3] - bbox[1]
            x = (W - tw) / 2 - bbox[0]
            if position == "top":
                y = H * float(y_inset) - bbox[1]
            elif position == "middle":
                y = (H - th) / 2 - bbox[1]
            else:
                y = H - H * float(y_inset) - th - bbox[1]
            if int(outline_width) > 0:
                ow = int(outline_width)
                for dx in range(-ow, ow + 1):
                    for dy in range(-ow, ow + 1):
                        if dx * dx + dy * dy > ow * ow:
                            continue
                        draw.text((x + dx, y + dy), active, fill=outline_fill, font=font)
            draw.text((x, y), active, fill=text_fill, font=font)
            out_np[i] = np.asarray(img)

        out = torch.from_numpy(out_np).to(frames.device).to(frames.dtype) / 255.0
        return IO.NodeOutput(out, ui=_save_preview(out, cls.hidden.unique_id))


# ---------------------------------------------------------------------------
# 6. LUT (.cube)
# ---------------------------------------------------------------------------


def _load_cube_lut(path: str) -> tuple[int, np.ndarray]:
    """Parse an Adobe .cube 3D LUT. Returns (size, ndarray[size, size, size, 3])."""
    size = None
    domain_min = np.array([0.0, 0.0, 0.0])
    domain_max = np.array([1.0, 1.0, 1.0])
    values: list[list[float]] = []
    with open(path, "r") as f:
        for raw in f:
            line = raw.strip()
            if not line or line.startswith("#"):
                continue
            upper = line.upper()
            if upper.startswith("LUT_3D_SIZE"):
                size = int(line.split()[1])
                continue
            if upper.startswith("DOMAIN_MIN"):
                domain_min = np.array([float(x) for x in line.split()[1:4]])
                continue
            if upper.startswith("DOMAIN_MAX"):
                domain_max = np.array([float(x) for x in line.split()[1:4]])
                continue
            if upper.startswith("LUT_1D_SIZE") or upper.startswith("TITLE"):
                continue
            parts = line.split()
            if len(parts) == 3:
                try:
                    values.append([float(p) for p in parts])
                except ValueError:
                    continue
    if size is None or not values:
        raise ValueError("Not a valid 3D .cube LUT (missing LUT_3D_SIZE or data).")
    arr = np.array(values, dtype=np.float32)
    if arr.shape[0] != size ** 3:
        raise ValueError(f"LUT data ({arr.shape[0]}) doesn't match size {size}**3.")
    arr = arr.reshape(size, size, size, 3)  # indexing: [b, g, r] per .cube convention
    return size, arr


class LUTNode(IO.ComfyNode):
    """Apply a 3D .cube LUT for cinematic color grading."""
    @classmethod
    def define_schema(cls):
        input_dir = folder_paths.get_input_directory()
        try:
            files = [f for f in os.listdir(input_dir)
                     if f.lower().endswith(".cube") and os.path.isfile(os.path.join(input_dir, f))]
        except Exception:
            files = []
        options = ["(none)"] + sorted(files)
        return IO.Schema(
            node_id="LUT",
            display_name="LUT",
            description="Apply a 3D .cube LUT — cinematic color grading from any LUT pack.",
            category="video",
            inputs=[
                IO.Image.Input("frames"),
                IO.Combo.Input("lut_file", options=options, default="(none)",
                              tooltip="Place .cube files in input/ to see them here."),
                IO.Float.Input("strength", default=1.0, min=0.0, max=1.0, step=0.01,
                              tooltip="Blend the LUT with the original. 1 = full, 0 = bypass."),
            ],
            outputs=[IO.Image.Output(display_name="frames")],
            hidden=[IO.Hidden.unique_id],
            is_output_node=True,
        )

    @classmethod
    def execute(cls, frames, lut_file, strength) -> IO.NodeOutput:
        if lut_file in (None, "", "(none)"):
            return IO.NodeOutput(frames, ui=_save_preview(frames, cls.hidden.unique_id))
        path = folder_paths.get_annotated_filepath(lut_file)
        try:
            size, lut_np = _load_cube_lut(path)
        except Exception as e:
            print(f"[LUT] failed to load {lut_file}: {e}", flush=True)
            return IO.NodeOutput(frames, ui=_save_preview(frames, cls.hidden.unique_id))

        device, dtype = frames.device, frames.dtype
        # Use grid_sample on a 3D volume: lut is [size,size,size,3] indexed [b,g,r].
        # We need [N, C_out=3, D, H, W] for the input volume.
        lut = torch.from_numpy(lut_np).to(device=device, dtype=dtype)  # [size,size,size,3]
        # Permute to [3, D=b, H=g, W=r] then add batch: [1, 3, size, size, size]
        lut_vol = lut.permute(3, 0, 1, 2).unsqueeze(0).contiguous()

        T, H, W, _ = frames.shape
        rgb = frames.clamp(0.0, 1.0)
        # grid expects (x, y, z) in [-1, 1] corresponding to (W=r, H=g, D=b).
        gx = rgb[..., 0] * 2.0 - 1.0  # r → x
        gy = rgb[..., 1] * 2.0 - 1.0  # g → y
        gz = rgb[..., 2] * 2.0 - 1.0  # b → z
        # Shape [1, D_out, H_out, W_out, 3] — pack each frame as one Z=1 slab.
        # Easiest: process all frames as a single 4-D query (treat T*H as height).
        grid = torch.stack([gx, gy, gz], dim=-1).view(1, T, H, W, 3)
        # grid_sample 3D: input [N,C,D,H,W], grid [N,D_out,H_out,W_out,3]
        graded = F.grid_sample(lut_vol, grid, mode="bilinear",
                              padding_mode="border", align_corners=True)
        # Output shape: [1, 3, T, H, W]
        graded = graded.squeeze(0).permute(1, 2, 3, 0)  # [T, H, W, 3]

        s = float(strength)
        if s < 0.999:
            out = frames * (1.0 - s) + graded * s
        else:
            out = graded
        out = out.clamp(0.0, 1.0)
        return IO.NodeOutput(out, ui=_save_preview(out, cls.hidden.unique_id))


# ---------------------------------------------------------------------------
# 7. Three-way Color Corrector
# ---------------------------------------------------------------------------


class ThreeWayCCNode(IO.ComfyNode):
    """Lift / Gamma / Gain — the colorist's main tool."""
    @classmethod
    def define_schema(cls):
        return IO.Schema(
            node_id="ThreeWayCC",
            display_name="3-Way Color",
            description="Lift / Gamma / Gain across shadows, mids, and highlights.",
            category="image/grading",
            inputs=[
                IO.Image.Input("image"),
                IO.Float.Input("lift_r",  default=0.0, min=-0.5, max=0.5, step=0.01),
                IO.Float.Input("lift_g",  default=0.0, min=-0.5, max=0.5, step=0.01),
                IO.Float.Input("lift_b",  default=0.0, min=-0.5, max=0.5, step=0.01),
                IO.Float.Input("gamma_r", default=1.0, min=0.1, max=4.0, step=0.01),
                IO.Float.Input("gamma_g", default=1.0, min=0.1, max=4.0, step=0.01),
                IO.Float.Input("gamma_b", default=1.0, min=0.1, max=4.0, step=0.01),
                IO.Float.Input("gain_r",  default=1.0, min=0.0, max=4.0, step=0.01),
                IO.Float.Input("gain_g",  default=1.0, min=0.0, max=4.0, step=0.01),
                IO.Float.Input("gain_b",  default=1.0, min=0.0, max=4.0, step=0.01),
            ],
            outputs=[IO.Image.Output(display_name="image")],
            hidden=[IO.Hidden.unique_id],
            is_output_node=True,
        )

    @classmethod
    def execute(cls, image, lift_r, lift_g, lift_b, gamma_r, gamma_g, gamma_b,
                gain_r, gain_g, gain_b) -> IO.NodeOutput:
        device, dtype = image.device, image.dtype
        lift = torch.tensor([lift_r, lift_g, lift_b], device=device, dtype=dtype)
        gain = torch.tensor([gain_r, gain_g, gain_b], device=device, dtype=dtype)
        gamma = torch.tensor([gamma_r, gamma_g, gamma_b], device=device, dtype=dtype).clamp(min=0.05)
        # ASC CDL style: out = ((in * gain) + lift)^(1/gamma)
        out = (image * gain + lift).clamp(min=0.0)
        out = out.pow(1.0 / gamma)
        out = out.clamp(0.0, 1.0)
        return IO.NodeOutput(out, ui=_save_preview(out, cls.hidden.unique_id))


# ---------------------------------------------------------------------------
# 8. Audio Waveform
# ---------------------------------------------------------------------------


class AudioWaveformNode(IO.ComfyNode):
    """Render an audio file as a music-video-style waveform clip."""
    @classmethod
    def define_schema(cls):
        input_dir = folder_paths.get_input_directory()
        try:
            files = [f for f in os.listdir(input_dir) if os.path.isfile(os.path.join(input_dir, f))]
            files = folder_paths.filter_files_content_types(files, ["audio"])
        except Exception:
            files = []
        options = sorted(files) or ["(no audio found)"]
        return IO.Schema(
            node_id="AudioWaveform",
            display_name="Audio Waveform",
            description="Visualize an audio file as a video — pulsing bars, wave, or radial spectrum.",
            category="video",
            inputs=[
                IO.Combo.Input("audio_file", options=options, default=options[0],
                              upload=IO.UploadType.audio),
                IO.Int.Input("width", default=1280, min=64, max=4096, step=8),
                IO.Int.Input("height", default=720, min=64, max=4096, step=8),
                IO.Int.Input("fps", default=30, min=1, max=120, step=1),
                IO.Int.Input("frame_count", default=180, min=1, max=10000, step=1),
                IO.Combo.Input("style", options=["bars", "wave", "dots", "radial", "mirrored_bars"],
                              default="bars"),
                IO.Int.Input("bar_count", default=64, min=4, max=512, step=2,
                            tooltip="Bars/dots/sectors. Ignored for wave style."),
                IO.String.Input("color", default="#ffffff"),
                IO.String.Input("bg_color", default="#000000"),
                IO.Float.Input("sensitivity", default=1.5, min=0.1, max=10.0, step=0.05,
                              tooltip="How much amplitude scales visually."),
                IO.Float.Input("smoothing", default=0.6, min=0.0, max=0.95, step=0.01,
                              tooltip="Temporal smoothing — higher = more lazy bars."),
            ],
            outputs=[IO.Image.Output(display_name="frames")],
            hidden=[IO.Hidden.unique_id],
            is_output_node=True,
        )

    @classmethod
    def execute(cls, audio_file, width, height, fps, frame_count, style, bar_count,
                color, bg_color, sensitivity, smoothing) -> IO.NodeOutput:
        import av
        W, H = int(width), int(height)
        T = int(frame_count)
        path = folder_paths.get_annotated_filepath(audio_file) if audio_file and audio_file != "(no audio found)" else None
        bg = tuple(int(c * 255) for c in _hex_rgb(bg_color, (0, 0, 0)))
        fg = tuple(int(c * 255) for c in _hex_rgb(color, (1, 1, 1)))

        # Decode audio to a mono float array.
        samples = None
        sample_rate = 48000
        if path and os.path.exists(path):
            try:
                with av.open(path, mode="r") as container:
                    a_stream = container.streams.audio[0]
                    sample_rate = a_stream.sample_rate or sample_rate
                    chunks: list[np.ndarray] = []
                    for frame in container.decode(a_stream):
                        arr = frame.to_ndarray()  # shape varies by layout
                        if arr.ndim == 2:
                            mono = arr.mean(axis=0)
                        else:
                            mono = arr
                        chunks.append(mono.astype(np.float32))
                    if chunks:
                        samples = np.concatenate(chunks)
                        # If int PCM, normalize.
                        if samples.dtype != np.float32 or np.max(np.abs(samples)) > 2.0:
                            samples = samples / max(1.0, float(np.max(np.abs(samples))))
            except Exception as e:
                print(f"[AudioWaveform] decode error: {e}", flush=True)

        if samples is None:
            # Synthesize a silent track so the node still produces output.
            samples = np.zeros(int(T / max(1, fps) * sample_rate), dtype=np.float32)

        samples_per_frame = max(1, int(sample_rate / max(1, fps)))
        # For each output frame, compute per-band energy via simple stride windows.
        K = int(bar_count) if style != "wave" else max(64, int(bar_count))
        # Pre-compute smoothed energy series.
        bars_t = np.zeros((T, K), dtype=np.float32)
        prev = np.zeros(K, dtype=np.float32)
        sm = float(smoothing)
        sens = float(sensitivity)
        for f in range(T):
            s = f * samples_per_frame
            e = s + samples_per_frame
            window = samples[s:e]
            if len(window) < 8:
                bars_t[f] = prev * sm
                prev = bars_t[f]
                continue
            # FFT-based band energies.
            n = 1 << max(8, (len(window) - 1).bit_length())
            spec = np.abs(np.fft.rfft(window, n=n))
            # Aggregate FFT bins into K logarithmic bands.
            bins = len(spec)
            log_edges = np.geomspace(1, bins, K + 1).astype(int)
            energies = np.empty(K, dtype=np.float32)
            for k in range(K):
                lo = log_edges[k]; hi = max(lo + 1, log_edges[k + 1])
                energies[k] = float(spec[lo:hi].mean())
            # Normalize per frame so peaks land near 1.
            peak = energies.max() if energies.size else 1.0
            if peak > 0:
                energies = energies / peak
            energies *= sens
            # Smooth.
            cur = energies * (1.0 - sm) + prev * sm
            bars_t[f] = cur
            prev = cur

        # Render each frame.
        out = np.empty((T, H, W, 3), dtype=np.float32)
        for f in range(T):
            img = PILImage.new("RGB", (W, H), color=bg)
            draw = ImageDraw.Draw(img)
            energies = np.clip(bars_t[f], 0.0, 1.5)
            if style == "bars":
                bar_w = max(1, W // K - 2)
                gap = max(1, (W - bar_w * K) // (K + 1))
                for k in range(K):
                    h = int(energies[k] * (H * 0.85))
                    x0 = gap + k * (bar_w + gap)
                    y0 = H - h
                    draw.rectangle([x0, y0, x0 + bar_w, H], fill=fg)
            elif style == "mirrored_bars":
                bar_w = max(1, W // K - 2)
                gap = max(1, (W - bar_w * K) // (K + 1))
                mid = H // 2
                for k in range(K):
                    h = int(energies[k] * (H * 0.4))
                    x0 = gap + k * (bar_w + gap)
                    draw.rectangle([x0, mid - h, x0 + bar_w, mid + h], fill=fg)
            elif style == "wave":
                mid = H // 2
                pts = []
                for x in range(0, W, 2):
                    k = int((x / W) * K)
                    k = min(k, K - 1)
                    y = mid - int((energies[k] - 0.5) * H * 0.6)
                    pts.append((x, y))
                if len(pts) >= 2:
                    draw.line(pts, fill=fg, width=3)
            elif style == "dots":
                bar_w = max(1, W // K - 2)
                gap = max(1, (W - bar_w * K) // (K + 1))
                mid = H // 2
                for k in range(K):
                    h = int(energies[k] * (H * 0.4))
                    x0 = gap + k * (bar_w + gap)
                    r = max(2, bar_w // 2)
                    draw.ellipse([x0, mid - h, x0 + 2 * r, mid - h + 2 * r], fill=fg)
                    draw.ellipse([x0, mid + h - 2 * r, x0 + 2 * r, mid + h], fill=fg)
            elif style == "radial":
                cx, cy = W // 2, H // 2
                r0 = min(W, H) * 0.18
                r_max = min(W, H) * 0.45
                for k in range(K):
                    ang = 2.0 * math.pi * (k / K) - math.pi / 2.0
                    r1 = r0 + energies[k] * (r_max - r0)
                    x0 = cx + math.cos(ang) * r0
                    y0 = cy + math.sin(ang) * r0
                    x1 = cx + math.cos(ang) * r1
                    y1 = cy + math.sin(ang) * r1
                    draw.line([(x0, y0), (x1, y1)], fill=fg, width=3)
            out[f] = np.asarray(img, dtype=np.float32) / 255.0

        frames = torch.from_numpy(out)
        return IO.NodeOutput(frames, ui=_save_preview(frames, cls.hidden.unique_id))


# ---------------------------------------------------------------------------
# 9. Transition (meta)
# ---------------------------------------------------------------------------


class TransitionNode(IO.ComfyNode):
    """Transition between two clips. Pick the style; lengths are joined at the seam."""
    @classmethod
    def define_schema(cls):
        return IO.Schema(
            node_id="Transition",
            display_name="Transition",
            description="Join two clips with a stylized transition: dissolve, whip pan, zoom, glitch, light leak.",
            category="video",
            inputs=[
                IO.Image.Input("clip_a"),
                IO.Image.Input("clip_b"),
                IO.Combo.Input("style", options=[
                    "dissolve", "whip_pan_left", "whip_pan_right",
                    "zoom_in", "zoom_out", "glitch", "light_leak",
                ], default="dissolve"),
                IO.Int.Input("duration", default=12, min=1, max=240, step=1),
                IO.Combo.Input("curve", options=["linear", "ease_in_out", "ease_in", "ease_out"],
                              default="ease_in_out"),
            ],
            outputs=[IO.Image.Output(display_name="frames")],
            hidden=[IO.Hidden.unique_id],
            is_output_node=True,
        )

    @staticmethod
    def _alpha_ramp(d: int, curve: str, device, dtype):
        t = torch.linspace(0.0, 1.0, d, device=device, dtype=dtype)
        return _ease(t, curve)

    @classmethod
    def execute(cls, clip_a, clip_b, style, duration, curve) -> IO.NodeOutput:
        # Bring clip_b to clip_a's H×W so torch.cat/blend work.
        if clip_a.shape[1:] != clip_b.shape[1:]:
            Ha, Wa = clip_a.shape[1], clip_a.shape[2]
            clip_b = F.interpolate(
                clip_b.permute(0, 3, 1, 2),
                size=(Ha, Wa), mode="bilinear", align_corners=False,
            ).permute(0, 2, 3, 1).contiguous()
        Ta, Tb = clip_a.shape[0], clip_b.shape[0]
        d = max(1, min(int(duration), Ta, Tb))
        device, dtype = clip_a.device, clip_a.dtype
        H, W = clip_a.shape[1], clip_a.shape[2]
        a_tail = clip_a[Ta - d:]
        b_head = clip_b[:d]
        alpha = cls._alpha_ramp(d, curve, device, dtype)

        if style == "dissolve":
            trans = a_tail * (1.0 - alpha.view(-1, 1, 1, 1)) + b_head * alpha.view(-1, 1, 1, 1)

        elif style in ("whip_pan_left", "whip_pan_right"):
            direction = -1.0 if style == "whip_pan_left" else 1.0
            # Slide A out + motion blur, B in + motion blur, both per-frame.
            tx_a = (direction * alpha * 2.0)  # 0 → ±2 (full canvas)
            tx_b = (direction * (alpha - 1.0) * 2.0)  # ∓2 → 0
            trans = torch.zeros_like(a_tail)
            src_a = a_tail.permute(0, 3, 1, 2)
            src_b = b_head.permute(0, 3, 1, 2)
            for i in range(d):
                theta_a = torch.tensor([[1.0, 0.0, float(tx_a[i])], [0.0, 1.0, 0.0]], device=device, dtype=dtype).unsqueeze(0)
                grid_a = F.affine_grid(theta_a, (1, 3, H, W), align_corners=False)
                a_warp = F.grid_sample(src_a[i:i + 1], grid_a, mode="bilinear", padding_mode="zeros", align_corners=False)
                theta_b = torch.tensor([[1.0, 0.0, float(tx_b[i])], [0.0, 1.0, 0.0]], device=device, dtype=dtype).unsqueeze(0)
                grid_b = F.affine_grid(theta_b, (1, 3, H, W), align_corners=False)
                b_warp = F.grid_sample(src_b[i:i + 1], grid_b, mode="bilinear", padding_mode="zeros", align_corners=False)
                combined = (a_warp + b_warp).clamp(0, 1)
                # Cheap horizontal motion blur: 1×K convolution. Force odd K
                # so conv2d with `padding=K//2` keeps the width unchanged.
                kw = max(1, int(15 * float(alpha[i] * (1 - alpha[i])) * 4 + 1))
                if kw % 2 == 0:
                    kw += 1
                if kw > 1:
                    kernel = torch.ones(1, 1, 1, kw, device=device, dtype=dtype) / kw
                    blurred = F.conv2d(combined.view(3, 1, H, W), kernel, padding=(0, kw // 2)).view(1, 3, H, W)
                else:
                    blurred = combined
                trans[i] = blurred.squeeze(0).permute(1, 2, 0)

        elif style in ("zoom_in", "zoom_out"):
            inward = (style == "zoom_in")
            trans = torch.zeros_like(a_tail)
            src_a = a_tail.permute(0, 3, 1, 2)
            src_b = b_head.permute(0, 3, 1, 2)
            for i in range(d):
                t = float(alpha[i])
                # A zooms IN as it fades out; B starts huge and zooms TO normal.
                za = 1.0 + (1.5 if inward else -0.5) * t
                zb = (2.0 if inward else 0.5) - (1.0 if inward else -0.5) * t
                za = max(0.05, za); zb = max(0.05, zb)
                theta_a = torch.tensor([[1.0 / za, 0.0, 0.0], [0.0, 1.0 / za, 0.0]], device=device, dtype=dtype).unsqueeze(0)
                theta_b = torch.tensor([[1.0 / zb, 0.0, 0.0], [0.0, 1.0 / zb, 0.0]], device=device, dtype=dtype).unsqueeze(0)
                a_warp = F.grid_sample(src_a[i:i + 1], F.affine_grid(theta_a, (1, 3, H, W), align_corners=False), mode="bilinear", padding_mode="border", align_corners=False)
                b_warp = F.grid_sample(src_b[i:i + 1], F.affine_grid(theta_b, (1, 3, H, W), align_corners=False), mode="bilinear", padding_mode="border", align_corners=False)
                blended = a_warp * (1.0 - t) + b_warp * t
                trans[i] = blended.squeeze(0).permute(1, 2, 0)

        elif style == "glitch":
            # RGB shift + horizontal slice shuffle, intensifying then decaying.
            trans = torch.zeros_like(a_tail)
            for i in range(d):
                t = float(alpha[i])
                intensity = 1.0 - abs(2.0 * t - 1.0)  # peaks at midpoint
                src = a_tail[i] if t < 0.5 else b_head[i]
                shifted = src.clone()
                offset = int(intensity * 30)
                if offset > 0:
                    shifted[..., 0] = torch.roll(src[..., 0], shifts=offset, dims=1)
                    shifted[..., 2] = torch.roll(src[..., 2], shifts=-offset, dims=1)
                # Random horizontal slice displacement.
                n_slices = max(1, int(intensity * 12))
                slice_h = max(1, H // n_slices)
                for k in range(n_slices):
                    y0 = k * slice_h
                    y1 = min(H, y0 + slice_h)
                    dx = int((torch.rand(1).item() - 0.5) * intensity * 80)
                    shifted[y0:y1] = torch.roll(shifted[y0:y1], shifts=dx, dims=1)
                trans[i] = shifted

        elif style == "light_leak":
            trans = a_tail * (1.0 - alpha.view(-1, 1, 1, 1)) + b_head * alpha.view(-1, 1, 1, 1)
            # Add a warm gradient that peaks at the midpoint.
            yy, xx = torch.meshgrid(
                torch.linspace(-1.0, 1.0, H, device=device, dtype=dtype),
                torch.linspace(-1.0, 1.0, W, device=device, dtype=dtype),
                indexing="ij",
            )
            falloff = torch.exp(-(yy * yy + xx * xx) * 2.0)
            warm = torch.stack([
                falloff,                       # R
                falloff * 0.65,                # G
                falloff * 0.25,                # B
            ], dim=-1).unsqueeze(0)  # [1, H, W, 3]
            peak = (4.0 * alpha * (1.0 - alpha)).view(-1, 1, 1, 1)  # parabola peaking at 0.5
            trans = (trans + warm * peak * 0.6).clamp(0.0, 1.0)
        else:
            trans = a_tail * (1.0 - alpha.view(-1, 1, 1, 1)) + b_head * alpha.view(-1, 1, 1, 1)

        out = torch.cat([clip_a[:Ta - d], trans, clip_b[d:]], dim=0).clamp(0.0, 1.0)
        return IO.NodeOutput(out, ui=_save_preview(out, cls.hidden.unique_id))


# ---------------------------------------------------------------------------
# 10. Stabilize
# ---------------------------------------------------------------------------


class StabilizeNode(IO.ComfyNode):
    """Translation-based stabilization via phase correlation."""
    @classmethod
    def define_schema(cls):
        return IO.Schema(
            node_id="Stabilize",
            display_name="Stabilize",
            description="Smooth out camera shake using 2D translation tracking.",
            category="video",
            inputs=[
                IO.Image.Input("frames"),
                IO.Float.Input("smoothing", default=0.85, min=0.0, max=0.99, step=0.01,
                              tooltip="Higher = removes more shake but may drift. ~0.85 is the sweet spot."),
                IO.Combo.Input("edge_mode", options=["crop", "border"], default="crop",
                              tooltip="crop = remove black edges (zooms in slightly); border = keep full frame."),
                IO.Float.Input("crop_pad", default=0.05, min=0.0, max=0.3, step=0.01,
                              tooltip="Extra inset when edge_mode = crop."),
            ],
            outputs=[IO.Image.Output(display_name="frames")],
            hidden=[IO.Hidden.unique_id],
            is_output_node=True,
        )

    @classmethod
    def execute(cls, frames, smoothing, edge_mode, crop_pad) -> IO.NodeOutput:
        T, H, W, _ = frames.shape
        device, dtype = frames.device, frames.dtype
        if T <= 1:
            return IO.NodeOutput(frames, ui=_save_preview(frames, cls.hidden.unique_id))

        # Compute per-frame translation via FFT phase correlation against prev frame.
        # Downsize for speed.
        scale = max(1, max(H, W) // 256)
        lum = (0.2126 * frames[..., 0] + 0.7152 * frames[..., 1] + 0.0722 * frames[..., 2])
        small = F.avg_pool2d(lum.unsqueeze(1), kernel_size=scale).squeeze(1)  # [T, h, w]
        Th, Tw = small.shape[-2], small.shape[-1]
        # Hann window to reduce edge artifacts.
        wy = torch.hann_window(Th, periodic=False, device=device, dtype=dtype).view(-1, 1)
        wx = torch.hann_window(Tw, periodic=False, device=device, dtype=dtype).view(1, -1)
        win = wy * wx

        f_prev = torch.fft.fft2(small[0] * win)
        shifts = [(0.0, 0.0)]
        for i in range(1, T):
            f_cur = torch.fft.fft2(small[i] * win)
            R = f_cur * torch.conj(f_prev)
            R = R / (R.abs() + 1e-8)
            r = torch.fft.ifft2(R).real
            idx = torch.argmax(r)
            dy = int(idx // Tw)
            dx = int(idx % Tw)
            if dy > Th // 2: dy -= Th
            if dx > Tw // 2: dx -= Tw
            shifts.append((dy * scale, dx * scale))
            f_prev = f_cur

        # Accumulate to absolute camera path.
        path = np.cumsum(np.array(shifts, dtype=np.float64), axis=0)
        # Low-pass filter for "smooth camera," subtract to get correction.
        alpha = float(smoothing)
        smoothed = np.zeros_like(path)
        smoothed[0] = path[0]
        for i in range(1, T):
            smoothed[i] = alpha * smoothed[i - 1] + (1.0 - alpha) * path[i]
        correction = smoothed - path  # apply this offset to align

        # Warp each frame.
        src = frames.permute(0, 3, 1, 2)
        out = torch.empty_like(src)
        for i in range(T):
            ty, tx = correction[i]
            theta = torch.tensor([
                [1.0, 0.0, -float(tx) / (W / 2.0)],
                [0.0, 1.0, -float(ty) / (H / 2.0)],
            ], device=device, dtype=dtype).unsqueeze(0)
            grid = F.affine_grid(theta, (1, 3, H, W), align_corners=False)
            out[i] = F.grid_sample(
                src[i:i + 1], grid,
                mode="bilinear",
                padding_mode="border" if edge_mode == "border" else "zeros",
                align_corners=False,
            ).squeeze(0)
        result = out.permute(0, 2, 3, 1)

        if edge_mode == "crop":
            pad = float(crop_pad)
            ch = max(8, int(H * (1.0 - 2 * pad)))
            cw = max(8, int(W * (1.0 - 2 * pad)))
            y0 = (H - ch) // 2
            x0 = (W - cw) // 2
            cropped = result[:, y0:y0 + ch, x0:x0 + cw, :]
            # Scale back up so output dims match input.
            cropped = cropped.permute(0, 3, 1, 2)
            result = F.interpolate(cropped, size=(H, W), mode="bilinear", align_corners=False).permute(0, 2, 3, 1)

        result = result.clamp(0.0, 1.0)
        return IO.NodeOutput(result, ui=_save_preview(result, cls.hidden.unique_id))


# ---------------------------------------------------------------------------
# Registration
# ---------------------------------------------------------------------------


class VideoProExtension(ComfyExtension):
    @override
    async def get_node_list(self) -> list[type[IO.ComfyNode]]:
        return [
            SpeedRampNode, KenBurnsNode, AspectConvertNode,
            ChromaKeyNode, CaptionTrackNode,
            LUTNode, ThreeWayCCNode,
            AudioWaveformNode, TransitionNode, StabilizeNode,
        ]


async def comfy_entrypoint() -> VideoProExtension:
    return VideoProExtension()
