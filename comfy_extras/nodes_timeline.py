"""Timeline node — like the Compositor, but each input is a video clip with
its own start frame, length, fade in/out, and transform. Output is a single
composite video on a fixed-size canvas.

Wiring:  LoadVideo → GetVideoComponents → Timeline → CreateVideo → SaveVideo

Frames-of-a-clip are batches `[T, H, W, 3]`. The first connected clip sets
the canvas size (matching the Compositor convention).
"""
from __future__ import annotations

import json
import os
import time
import uuid
from fractions import Fraction

import numpy as np
import torch
from PIL import Image as PILImage
from typing_extensions import override

import folder_paths
from comfy_api.latest import ComfyExtension, IO, InputImpl, Types
from comfy_extras._live_preview import save_live_preview
from comfy_extras.nodes_compositor import _BLEND_MODES, _blend, _fit_to_canvas, _transform


# Maximum clip ports preallocated on the Timeline node. The frontend's
# dynamic-grow logic only renders "connected + 1 trailing empty" so the user
# sees a clean node until they wire more clips.
_MAX_CLIPS = 16


def _coerce_video_clips(kwargs: dict) -> None:
    """Modern video nodes output VIDEO objects; the Timeline composites frame
    batches. Decode each VIDEO clip input to its frame tensor once, in place —
    both the legacy widget path and the edit-state path then see tensors.
    (Audio inside wired videos is dropped here — node-run audio is a later
    phase; the editor's audio tracks are unaffected.)"""
    for i in range(1, _MAX_CLIPS + 1):
        v = kwargs.get(f"clip{i}")
        if v is not None and not isinstance(v, torch.Tensor) and hasattr(v, "get_components"):
            kwargs[f"clip{i}"] = v.get_components().images


def _frames_to_video(frames, fps) -> "InputImpl.VideoFromComponents":
    """Wrap rendered frames as a VIDEO object so SaveVideo/CreateVideo-style
    consumers connect directly (mirrors CreateVideo in nodes_video.py)."""
    return InputImpl.VideoFromComponents(
        Types.VideoComponents(images=frames, audio=None, frame_rate=Fraction(fps)))


def _ease(t: float, ease) -> float:
    # Mirror of shared/timeline/interpolate.ts applyEase: smoothstep for
    # easeInOut, linear otherwise.
    return t * t * (3.0 - 2.0 * t) if ease == "easeInOut" else t


def _interp_transform(static: dict, keyframes, local_frame: float) -> dict:
    """Python mirror of shared/timeline/interpolate.ts `interpolateClipAt`.

    `static` supplies x/y/rotation/scale/opacity fallbacks (the clip's static
    scalars). `keyframes` is an optional list of
    {frame, x, y, rotation, scale, opacity, ease}. With no keyframes we return
    the static transform; otherwise we lerp between the bracketing keyframes so
    the editor preview, FFmpeg export, and node run all agree.
    """
    base = {
        "x":        float(static.get("x", 0.0)),
        "y":        float(static.get("y", 0.0)),
        "rotation": float(static.get("rotation", 0.0)),
        "scale":    float(static.get("scale", 1.0)),
        "opacity":  float(static.get("opacity", 1.0)),
    }
    if not keyframes:
        return base

    def _snap(k: dict) -> dict:
        return {
            "x":        float(k.get("x", base["x"])),
            "y":        float(k.get("y", base["y"])),
            "rotation": float(k.get("rotation", base["rotation"])),
            "scale":    float(k.get("scale", base["scale"])),
            "opacity":  float(k.get("opacity", base["opacity"])),
        }

    kfs = sorted(keyframes, key=lambda k: k.get("frame", 0))
    if local_frame <= kfs[0].get("frame", 0):
        return _snap(kfs[0])
    last = kfs[-1]
    if local_frame >= last.get("frame", 0):
        return _snap(last)
    for i in range(len(kfs) - 1):
        a, b = kfs[i], kfs[i + 1]
        fa = a.get("frame", 0)
        fb = b.get("frame", 0)
        if fa <= local_frame <= fb:
            span = fb - fa
            t = _ease((local_frame - fa) / span, a.get("ease")) if span > 0 else 0.0
            sa, sb = _snap(a), _snap(b)
            return {k: sa[k] + (sb[k] - sa[k]) * t for k in sa}
    return _snap(last)


def _hex_rgb(s: str, fallback=(0.0, 0.0, 0.0)) -> tuple[float, float, float]:
    s = s.strip().lstrip("#")
    if len(s) == 3:
        s = "".join(c * 2 for c in s)
    if len(s) != 6:
        return fallback
    try:
        return (int(s[0:2], 16) / 255.0, int(s[2:4], 16) / 255.0, int(s[4:6], 16) / 255.0)
    except ValueError:
        return fallback


def _load_pil_image(path):
    """Open an image clip's source as RGB PIL. Resolves bare filenames under
    input/. Returns None if missing/unreadable."""
    if not path:
        return None
    if not os.path.isabs(path):
        path = os.path.join(folder_paths.get_input_directory(), path)
    if not os.path.exists(path):
        return None
    try:
        return PILImage.open(path).convert("RGB")
    except Exception:
        return None


def _pil_to_tensor(pil: "PILImage.Image", device, dtype) -> "torch.Tensor":
    """RGB PIL → [1, H, W, 3] float tensor in [0,1] on the target device/dtype."""
    arr = np.asarray(pil.convert("RGB"), dtype=np.float32) / 255.0  # [H, W, 3]
    return torch.from_numpy(arr).unsqueeze(0).to(device=device, dtype=dtype)


def _render_text_clip_pil(clip: dict, W: int, H: int):
    """Render a text clip's nested config to a PIL image (mirrors the FFmpeg
    export path). Returns None if the text renderer is unavailable."""
    try:
        from comfy_extras.nodes_text import render_text_to_pil
    except Exception:
        return None
    t = clip.get("text") or {}
    try:
        return render_text_to_pil(
            text=str(t.get("text", "")),
            width=int(t.get("width", W)),
            height=int(t.get("height", H)),
            font_size=int(t.get("font_size", 72)),
            color=str(t.get("color", "#ffffff")),
            bg_color=str(t.get("bg_color", "#000000")),
            align=str(t.get("align", "center")),
            v_align=str(t.get("v_align", "middle")),
            padding=float(t.get("padding", 0.06)),
            line_spacing=float(t.get("line_spacing", 1.2)),
        )
    except Exception:
        return None


def _clip_inputs(idx: int, optional: bool):
    """Per-clip input declarations. clip1 is required (defines canvas size)."""
    start_default = (idx - 1) * 12   # stagger clips by default so they don't overlap fully
    return [
        IO.MultiType.Input(
            IO.Image.Input(f"clip{idx}", optional=optional,
                           tooltip=f"Clip {idx}" + (" (sets canvas size)" if idx == 1 else "")),
            [IO.Video],
        ),
        IO.Int.Input(f"clip{idx}_start",    default=start_default, min=-1000, max=10000, step=1,
                    tooltip="When this clip begins on the global timeline, in frames."),
        IO.Int.Input(f"clip{idx}_length",   default=30, min=1, max=10000, step=1,
                    tooltip="How many frames of the timeline this clip occupies. Loops if longer than the source."),
        IO.Float.Input(f"clip{idx}_x",      default=0.0, min=-1.5, max=1.5, step=0.01),
        IO.Float.Input(f"clip{idx}_y",      default=0.0, min=-1.5, max=1.5, step=0.01),
        IO.Float.Input(f"clip{idx}_rotation", default=0.0, min=-180.0, max=180.0, step=1.0),
        IO.Float.Input(f"clip{idx}_scale",  default=1.0, min=0.1, max=3.0, step=0.05),
        IO.Float.Input(f"clip{idx}_opacity", default=1.0, min=0.0, max=1.0, step=0.01),
        IO.Combo.Input(f"clip{idx}_blend",  options=_BLEND_MODES, default="normal"),
        IO.Int.Input(f"clip{idx}_fade_in",  default=0, min=0, max=1000, step=1,
                    tooltip="Frames over which opacity ramps up at this clip's start."),
        IO.Int.Input(f"clip{idx}_fade_out", default=0, min=0, max=1000, step=1,
                    tooltip="Frames over which opacity ramps down at this clip's end."),
    ]


class TimelineNode(IO.ComfyNode):
    @classmethod
    def define_schema(cls):
        inputs = []
        for i in range(1, _MAX_CLIPS + 1):
            inputs.extend(_clip_inputs(i, optional=(i > 1)))
        # Audio file picker — lists audio files in input/ plus a blank entry
        # so the user can opt out. Used only by the FFmpeg-direct renderer.
        input_dir = folder_paths.get_input_directory()
        try:
            audio_files = [f for f in os.listdir(input_dir) if os.path.isfile(os.path.join(input_dir, f))]
            audio_files = folder_paths.filter_files_content_types(audio_files, ["audio"])
        except Exception:
            audio_files = []
        audio_options = ["(none)"] + sorted(audio_files)

        inputs.extend([
            IO.Int.Input("total_duration", default=0, min=0, max=10000, step=1,
                        tooltip="Output length in frames. 0 = auto (max end across all clips)."),
            IO.Int.Input("output_fps", default=30, min=1, max=120, step=1,
                        tooltip="Frame rate used for time math (s ↔ frames) and rendering."),
            IO.String.Input("bg_color", default="#000000",
                           tooltip="Background color shown when no clip covers a frame."),
            IO.Combo.Input("audio_file", options=audio_options, default="(none)",
                          upload=IO.UploadType.audio,
                          tooltip="Optional soundtrack mixed in on Render."),
            IO.Int.Input("preview_frame", default=-1, min=-1, max=10000, step=1,
                        tooltip="Which frame to save for live preview. -1 = middle of timeline."),
            # Editor state (tracks, clips, keyframes) as a JSON string. The Vue
            # editor stores this on the node and the frontend injects it at
            # submit. When present it DRIVES the render (keyframed transforms,
            # multi-track order); when absent we fall back to the legacy flat
            # clip{i}_* widgets. Never shown on the node — the Timeline body
            # renders the editor button + preview, not the raw widget list.
            IO.String.Input("edit_state", default="", optional=True, multiline=True,
                           tooltip="Editor timeline state (auto-populated at submit)."),
        ])
        return IO.Schema(
            node_id="Timeline",
            display_name="Timeline",
            description="Composite multiple clips on a timeline with per-clip start, transform, opacity, blend, and fades.",
            category="video",
            inputs=inputs,
            outputs=[IO.Image.Output(display_name="frames"), IO.Video.Output(display_name="video")],
            hidden=[IO.Hidden.unique_id],
            is_output_node=True,
        )

    @classmethod
    def execute(cls, **kwargs) -> IO.NodeOutput:
        _coerce_video_clips(kwargs)
        # Prefer the editor's rich edit_state (tracks, clips, keyframes) when
        # the frontend injected it at submit. This is what makes node-run agree
        # with the editor preview and the FFmpeg export. Absent/blank → fall
        # back to the legacy flat clip{i}_* widget path below (back-compat for
        # graphs wired without the editor).
        raw_state = kwargs.get("edit_state")
        if raw_state:
            try:
                state = json.loads(raw_state) if isinstance(raw_state, str) else raw_state
            except Exception:
                state = None
            if _is_edit_state(state):
                return cls._execute_edit_state(kwargs, state)

        # Gather connected layers.
        layers = []
        for i in range(1, _MAX_CLIPS + 1):
            clip = kwargs.get(f"clip{i}")
            if clip is None:
                continue
            layers.append({
                "slot":      i,
                "clip":      clip,
                "start":     int(kwargs.get(f"clip{i}_start", 0)),
                "length":    int(kwargs.get(f"clip{i}_length", 30)),
                "x":         float(kwargs.get(f"clip{i}_x", 0.0)),
                "y":         float(kwargs.get(f"clip{i}_y", 0.0)),
                "rot":       float(kwargs.get(f"clip{i}_rotation", 0.0)),
                "scl":       float(kwargs.get(f"clip{i}_scale", 1.0)),
                "op":        float(kwargs.get(f"clip{i}_opacity", 1.0)),
                "blend":     str(kwargs.get(f"clip{i}_blend", "normal")),
                "fade_in":   int(kwargs.get(f"clip{i}_fade_in", 0)),
                "fade_out":  int(kwargs.get(f"clip{i}_fade_out", 0)),
            })

        if not layers:
            blank = torch.zeros(1, 16, 16, 3)
            return IO.NodeOutput(blank, _frames_to_video(blank, 30),
                                 ui=save_live_preview(blank, str(cls.hidden.unique_id)))

        # Canvas size = first connected clip's frame size.
        first = layers[0]["clip"]
        _, ch, cw, _ = first.shape
        device, dtype = first.device, first.dtype

        # Total duration.
        total = int(kwargs.get("total_duration", 0))
        if total <= 0:
            total = max(L["start"] + L["length"] for L in layers)
        total = max(1, total)

        # Initialize output canvas with background color.
        bg_rgb = _hex_rgb(str(kwargs.get("bg_color", "#000000")))
        bg = torch.tensor(bg_rgb, device=device, dtype=dtype).view(1, 1, 1, 3)
        output = bg.expand(total, ch, cw, 3).clone()  # [T, H, W, 3]

        # Per-layer × per-frame composition. Frame-by-frame keeps each
        # grid_sample call to a single image — avoids the MPS batched-grid
        # stall and keeps peak memory bounded.
        for L in layers:
            clip = L["clip"]
            clip_T = clip.shape[0]
            layer_T = max(1, L["length"])
            start = L["start"]
            gt_start = max(0, start)
            gt_end = min(total, start + layer_T)
            if gt_end <= gt_start:
                continue

            fi, fo = L["fade_in"], L["fade_out"]
            for gt in range(gt_start, gt_end):
                local_t = gt - start
                ct = local_t % clip_T

                src = clip[ct:ct + 1].permute(0, 3, 1, 2)
                src = _fit_to_canvas(src, ch, cw)
                rgb, alpha = _transform(src, L["x"], L["y"], L["rot"], L["scl"])

                fade_alpha = 1.0
                if fi > 0 and local_t < fi:
                    fade_alpha *= (local_t + 1) / fi
                if fo > 0 and local_t >= layer_T - fo:
                    fade_alpha *= max(0.0, (layer_T - local_t) / fo)

                a = (alpha * L["op"] * fade_alpha).clamp(0.0, 1.0)
                base = output[gt:gt + 1].permute(0, 3, 1, 2)
                blended = _blend(base, rgb, L["blend"])
                result = base * (1.0 - a) + blended * a
                output[gt] = result.permute(0, 2, 3, 1).squeeze(0)

        output = output.clamp(0.0, 1.0)

        # Save a single preview frame for the canvas in the modal / on the node.
        pf = int(kwargs.get("preview_frame", -1))
        if pf < 0 or pf >= total:
            pf = total // 2
        preview = output[pf:pf + 1]
        # legacy widget path has no fps; 30 matches the editor default
        return IO.NodeOutput(output, _frames_to_video(output, 30),
                             ui=save_live_preview(preview, str(cls.hidden.unique_id)))

    @classmethod
    def _execute_edit_state(cls, kwargs: dict, state: dict) -> IO.NodeOutput:
        """Render from the editor's EditState (any supported version, see `_is_edit_state`). Resolves each clip
        to a source tensor and composites frame-by-frame with keyframed
        transforms — the same math as the editor preview and FFmpeg export.

        Pixel sources by clip kind:
          • workflow → wired tensor at clip{port_index}
          • image    → file on disk (input/ or absolute path)
          • text     → rendered via nodes_text.render_text_to_pil
        Video/audio asset clips are export-path content (decode-from-disk),
        so they're skipped here; wire them through LoadVideo → port to use
        them on node-run.
        """
        canvas = state.get("canvas", {})
        fps = max(1, int(canvas.get("fps", 30)))
        cw = max(1, int(canvas.get("width", 1280)))
        ch = max(1, int(canvas.get("height", 720)))
        bg_rgb = _hex_rgb(str(canvas.get("bg_color", "#000000")))

        # Composite where the wired data lives (first wired clip's device/dtype);
        # disk/text sources get moved there. Default CPU float32.
        device, dtype = torch.device("cpu"), torch.float32
        for i in range(1, _MAX_CLIPS + 1):
            t = kwargs.get(f"clip{i}")
            if t is not None:
                device, dtype = t.device, t.dtype
                break

        # Resolve renderable clips to source tensors. Track order = paint order
        # (later tracks on top), matching the preview/export.
        layers: list[dict] = []
        skipped = 0
        for track in state.get("tracks", []):
            if track.get("muted") or track.get("kind") == "audio":
                continue
            for clip in track.get("clips", []):
                kind = clip.get("kind")
                src = None
                if kind == "workflow":
                    t = kwargs.get(f"clip{int(clip.get('port_index', 0) or 0)}")
                    if t is not None:
                        src = t.to(device=device, dtype=dtype)
                elif kind == "image":
                    pil = _load_pil_image(clip.get("path") or clip.get("asset_path"))
                    if pil is not None:
                        src = _pil_to_tensor(pil, device, dtype)
                elif kind == "text":
                    pil = _render_text_clip_pil(clip, cw, ch)
                    if pil is not None:
                        src = _pil_to_tensor(pil, device, dtype)
                # else: video/audio asset → export-path only.
                if src is None:
                    skipped += 1
                    continue
                layers.append({
                    "src":       src,
                    "start":     int(clip.get("start_frame", 0)),
                    "length":    max(1, int(clip.get("length", 30))),
                    "in_frame":  int(clip.get("in_frame", 0)),
                    "blend":     str(clip.get("blend", "normal")),
                    "fade_in":   int(clip.get("fade_in", 0)),
                    "fade_out":  int(clip.get("fade_out", 0)),
                    "static":    {
                        "x": float(clip.get("x", 0.0)), "y": float(clip.get("y", 0.0)),
                        "rotation": float(clip.get("rotation", 0.0)),
                        "scale": float(clip.get("scale", 1.0)),
                        "opacity": float(clip.get("opacity", 1.0)),
                    },
                    "keyframes": clip.get("keyframes"),
                })

        total = int(state.get("total_frames", 0) or 0)
        if total <= 0:
            total = max((L["start"] + L["length"] for L in layers), default=1)
        total = max(1, total)

        bg = torch.tensor(bg_rgb, device=device, dtype=dtype).view(1, 1, 1, 3)
        output = bg.expand(total, ch, cw, 3).clone()  # [T, H, W, 3]

        for L in layers:
            src = L["src"]
            src_T = max(1, src.shape[0])
            length, start = L["length"], L["start"]
            gt_start = max(0, start)
            gt_end = min(total, start + length)
            if gt_end <= gt_start:
                continue
            fi, fo = L["fade_in"], L["fade_out"]
            for gt in range(gt_start, gt_end):
                local_t = gt - start
                ct = (local_t + L["in_frame"]) % src_T

                tf = _interp_transform(L["static"], L["keyframes"], local_t)

                frame = src[ct:ct + 1].permute(0, 3, 1, 2)
                frame = _fit_to_canvas(frame, ch, cw)
                rgb, alpha = _transform(frame, tf["x"], tf["y"], tf["rotation"], tf["scale"])

                # Fade math matches the editor preview + FFmpeg export exactly
                # (not the legacy clip{i}_* path's off-by-one), so all three
                # render the same ramp.
                fade = 1.0
                if fi > 0 and local_t < fi:
                    fade *= local_t / fi
                if fo > 0 and local_t > length - fo:
                    fade *= (length - local_t) / fo
                fade = max(0.0, min(1.0, fade))

                a = (alpha * tf["opacity"] * fade).clamp(0.0, 1.0)
                base = output[gt:gt + 1].permute(0, 3, 1, 2)
                blended = _blend(base, rgb, L["blend"])
                result = base * (1.0 - a) + blended * a
                output[gt] = result.permute(0, 2, 3, 1).squeeze(0)

        output = output.clamp(0.0, 1.0)
        pf = total // 2
        return IO.NodeOutput(output, _frames_to_video(output, fps),
                             ui=save_live_preview(output[pf:pf + 1], str(cls.hidden.unique_id)))


# ---------------------------------------------------------------------------
# FFmpeg-direct render endpoint
#
# The Comfy graph path (LoadVideoFrames → Timeline → SaveVideo) decodes every
# source clip into a torch tensor batch up front — fine for graph composability,
# but wasteful when the user just wants to export their edit. This endpoint
# accepts the same edit state and renders it via PyAV (FFmpeg under the hood),
# streaming one composited frame at a time. No frame-tensor batch lives in RAM.
# Supports video AND image sources, plus optional audio mux.
# ---------------------------------------------------------------------------


def _blend_np(base: np.ndarray, top: np.ndarray, mode: str) -> np.ndarray:
    """Element-wise blend in float32 [0,1]. base/top: [H,W,3]."""
    a, b = base, top
    if mode == "normal":     return b
    if mode == "multiply":   return a * b
    if mode == "screen":     return 1.0 - (1.0 - a) * (1.0 - b)
    if mode == "overlay":    return np.where(a < 0.5, 2.0 * a * b, 1.0 - 2.0 * (1.0 - a) * (1.0 - b))
    if mode == "soft_light": return (1.0 - 2.0 * b) * a * a + 2.0 * b * a
    if mode == "hard_light": return np.where(b < 0.5, 2.0 * a * b, 1.0 - 2.0 * (1.0 - a) * (1.0 - b))
    if mode == "difference": return np.abs(a - b)
    if mode == "lighten":    return np.maximum(a, b)
    if mode == "darken":     return np.minimum(a, b)
    if mode == "add":        return np.clip(a + b, 0.0, 1.0)
    return b


def _hex_rgb_safe(s, fallback=(0.0, 0.0, 0.0)):
    return _hex_rgb(str(s or ""), fallback)


def _transform_and_alpha(src_pil: "PILImage.Image", canvas_w: int, canvas_h: int,
                        x: float, y: float, rotation: float, scale: float) -> tuple[np.ndarray, np.ndarray]:
    """Aspect-fit + translate + rotate + scale a source PIL image to a
    canvas-sized RGBA buffer. Returns (rgb [H,W,3] float32, alpha [H,W,1] float32)."""
    sw, sh = src_pil.size
    if sw == 0 or sh == 0:
        return np.zeros((canvas_h, canvas_w, 3), dtype=np.float32), np.zeros((canvas_h, canvas_w, 1), dtype=np.float32)
    # Aspect-fit inside canvas (matches backend `_fit_to_canvas`).
    cAspect = canvas_w / canvas_h
    sAspect = sw / sh
    if sAspect > cAspect:
        fit_w = canvas_w
        fit_h = max(1, int(round(canvas_w / sAspect)))
    else:
        fit_h = canvas_h
        fit_w = max(1, int(round(canvas_h * sAspect)))
    fitted = src_pil.convert("RGB").resize((fit_w, fit_h), PILImage.BILINEAR)
    # Scale
    s = max(0.01, float(scale))
    if s != 1.0:
        fitted = fitted.resize(
            (max(1, int(round(fit_w * s))), max(1, int(round(fit_h * s)))),
            PILImage.BILINEAR,
        )
    # Rotate (with expand to avoid clipping during rotation). Rotate in RGBA so
    # the expanded corners are TRANSPARENT — rotating in RGB fills them opaque
    # black, which then composites as a black bounding box around the layer
    # (the bug that made rotated clips export with black boxes; the editor
    # preview never had it, and the WebGL engine's parity gate caught it).
    rgba = fitted.convert("RGBA")
    if rotation != 0.0:
        rgba = rgba.rotate(-float(rotation), resample=PILImage.BILINEAR, expand=True)
    fw, fh = rgba.size

    # Paste fitted on a transparent RGBA canvas at center + offset.
    canvas = PILImage.new("RGBA", (canvas_w, canvas_h), (0, 0, 0, 0))
    cx = canvas_w // 2 + int(round(float(x) * canvas_w)) - fw // 2
    cy = canvas_h // 2 + int(round(float(y) * canvas_h)) - fh // 2
    canvas.paste(rgba, (cx, cy), rgba)
    rgba_np = np.asarray(canvas, dtype=np.float32) / 255.0
    return rgba_np[..., :3], rgba_np[..., 3:4]


def _decoded_frame_at(av_container, video_stream, target_sec: float):
    """Decode the source frame closest to `target_sec`. Caller manages container lifetime."""
    import av
    tb = video_stream.time_base
    target_pts = int(target_sec / tb)
    av_container.seek(max(0, target_pts), stream=video_stream, any_frame=False, backward=True)
    last = None
    for frame in av_container.decode(video_stream):
        if frame.pts is None:
            last = frame
            continue
        last = frame
        if frame.pts >= target_pts:
            break
    return last


_EDIT_STATE_VERSIONS = (1, 2)


def _is_edit_state(state) -> bool:
    """True when `state` is the editor's EditState (shared/timeline/types.ts),
    any supported version. v2 adds transitions[], per-clip speed/reverse/filters,
    captions, mattes — fields this renderer doesn't draw yet (Phase 2+); it must
    still accept v2 and render the parts it knows."""
    return (
        isinstance(state, dict)
        and state.get("version") in _EDIT_STATE_VERSIONS
        and isinstance(state.get("tracks"), list)
    )


def _adapt_edit_state(state: dict) -> dict:
    """If `state` is an EditState (any supported version, see `_is_edit_state`)
    with tracks[], flatten it into the legacy `{fps, canvas_*, clips: [...]}`
    shape that render_timeline_to_file expects. Pass-through anything else.

    Audio clips are extracted: the first audio clip becomes `audio_path` for
    compatibility with the existing single-track audio mux. Multi-track audio
    mixing is a future improvement.
    """
    if not _is_edit_state(state):
        return state

    canvas = state.get("canvas", {})
    out = {
        "fps":           int(canvas.get("fps", 30)),
        "canvas_width":  int(canvas.get("width", 1280)),
        "canvas_height": int(canvas.get("height", 720)),
        "bg_color":      canvas.get("bg_color", "#000000"),
        "total_frames":  int(state.get("total_frames", 0)),
        "output_basename": state.get("output_basename") or "timeline",
        "clips":         [],
    }

    audio_path = state.get("audio_path")
    for track in state.get("tracks", []):
        if track.get("muted"):
            continue
        for clip in track.get("clips", []):
            kind = clip.get("kind")
            if kind == "workflow":
                # WorkflowClip pixels come from graph ports — only the
                # in-graph execute() path can render them. Skip for the
                # FFmpeg render.
                continue
            if kind == "audio":
                if not audio_path:
                    audio_path = clip.get("path") or clip.get("asset_path")
                continue
            if kind == "caption":
                # v2 captions have no export rendering yet (Phase 3 adds it).
                continue
            out["clips"].append({
                "kind":        kind,
                "path":        clip.get("path") or clip.get("asset_path"),
                "start_frame": int(clip.get("start_frame", 0)),
                "length":      int(clip.get("length", 30)),
                "in_frame":    int(clip.get("in_frame", 0)),
                "x":           float(clip.get("x", 0)),
                "y":           float(clip.get("y", 0)),
                "rotation":    float(clip.get("rotation", 0)),
                "scale":       float(clip.get("scale", 1)),
                "opacity":     float(clip.get("opacity", 1)),
                "blend":       str(clip.get("blend", "normal")),
                "fade_in":     int(clip.get("fade_in", 0)),
                "fade_out":    int(clip.get("fade_out", 0)),
                "text":        clip.get("text"),
                "keyframes":   clip.get("keyframes"),
            })

    if audio_path:
        out["audio_path"] = audio_path
    return out


def _prepare_render_clips(state: dict) -> list[dict]:
    """Open per-clip decoders / pre-load images / pre-render text for
    render_frame_np. The caller owns the returned containers — close with
    _close_render_clips()."""
    import av

    W = int(state.get("canvas_width", 1280))
    H = int(state.get("canvas_height", 720))
    clips: list[dict] = []
    for c in state.get("clips", []):
        kind = str(c.get("kind") or ("image" if c.get("is_image") else "video"))
        entry = {
            "kind":     kind,
            "start":    int(c.get("start_frame", 0)),
            "length":   int(c.get("length", 30)),
            "in_frame": int(c.get("in_frame", 0)),
            "x":        float(c.get("x", 0)),
            "y":        float(c.get("y", 0)),
            "rot":      float(c.get("rotation", 0)),
            "scl":      float(c.get("scale", 1)),
            "op":       float(c.get("opacity", 1)),
            "blend":    str(c.get("blend", "normal")),
            "fade_in":  int(c.get("fade_in", 0)),
            "fade_out": int(c.get("fade_out", 0)),
            "keyframes": c.get("keyframes"),
        }
        if kind == "text":
            # Text clips have no file backing — pre-render once into a PIL image.
            from comfy_extras.nodes_text import render_text_to_pil
            t = c.get("text") or {}
            entry["pil"] = render_text_to_pil(
                text=str(t.get("text", "")),
                width=int(t.get("width", W)),
                height=int(t.get("height", H)),
                font_size=int(t.get("font_size", 72)),
                color=str(t.get("color", "#ffffff")),
                bg_color=str(t.get("bg_color", "#000000")),
                align=str(t.get("align", "center")),
                v_align=str(t.get("v_align", "middle")),
                padding=float(t.get("padding", 0.06)),
                line_spacing=float(t.get("line_spacing", 1.2)),
            )
            entry["duration"] = None
            clips.append(entry)
            continue

        path = c.get("path")
        if not path or not os.path.exists(path):
            continue
        if kind == "image":
            entry["pil"] = PILImage.open(path).convert("RGB")
            entry["duration"] = None
        else:  # video
            container = av.open(path, mode="r")
            vs = container.streams.video[0]
            entry["container"] = container
            entry["stream"] = vs
            entry["duration"] = float(vs.duration * vs.time_base) if vs.duration else None
        clips.append(entry)
    return clips


def _close_render_clips(clips: list[dict]) -> None:
    for L in clips:
        if "container" in L:
            try:
                L["container"].close()
            except Exception:
                pass


def render_frame_np(state: dict, clips: list[dict], f: int) -> np.ndarray:
    """Composite output frame `f` of the flat timeline `state` (the
    render_timeline_to_file shape) over its bg color. Returns float32 [H,W,3]
    in [0,1]. Single source of export-path pixel math: the FFmpeg export loop,
    the golden-frame harness, and /comfynext/timeline/render_frame all call
    this — divergence between them is impossible by construction."""
    fps = int(state.get("fps", 30))
    W = int(state.get("canvas_width", 1280))
    H = int(state.get("canvas_height", 720))
    bg_rgb = _hex_rgb_safe(state.get("bg_color"), (0.0, 0.0, 0.0))
    bg = np.array(bg_rgb, dtype=np.float32).reshape(1, 1, 3)
    canvas = np.broadcast_to(bg, (H, W, 3)).copy()

    for L in clips:
        start, length = L["start"], max(1, L["length"])
        if f < start or f >= start + length:
            continue
        local_f = f - start

        # Fade alpha
        fade = 1.0
        if L["fade_in"] > 0 and local_f < L["fade_in"]:
            fade *= local_f / L["fade_in"]
        if L["fade_out"] > 0 and local_f > length - L["fade_out"]:
            fade *= (length - local_f) / L["fade_out"]
        fade = max(0.0, min(1.0, fade))

        # Get source PIL for this frame.
        if L["kind"] in ("image", "text"):
            src_pil = L["pil"]
        else:  # video
            vs = L["stream"]
            container = L["container"]
            local_sec = (local_f + L.get("in_frame", 0)) / fps
            clip_dur = L.get("duration")
            if clip_dur is not None and clip_dur > 0:
                src_sec = local_sec % clip_dur
            else:
                src_sec = local_sec
            try:
                frame = _decoded_frame_at(container, vs, src_sec)
            except Exception:
                frame = None
            if frame is None:
                continue
            src_pil = PILImage.fromarray(frame.to_ndarray(format="rgb24"))

        # Keyframed transform at this clip-local frame (static if none).
        static = {"x": L["x"], "y": L["y"], "rotation": L["rot"], "scale": L["scl"], "opacity": L["op"]}
        tf = _interp_transform(static, L.get("keyframes"), local_f)
        rgb, alpha = _transform_and_alpha(src_pil, W, H, tf["x"], tf["y"], tf["rotation"], tf["scale"])
        a = alpha * tf["opacity"] * fade
        blended = _blend_np(canvas, rgb, L["blend"])
        canvas = canvas * (1.0 - a) + blended * a

    return np.clip(canvas, 0.0, 1.0)


def render_timeline_to_file(state: dict, output_dir: str, progress=None) -> dict:
    """Render the edit `state` to a video file in `output_dir`. Returns metadata.

    `state` shape:
      {
        "fps": 30,
        "total_frames": 120,
        "canvas_width": 1280, "canvas_height": 720,
        "bg_color": "#000000",
        "output_basename": "timeline",  # optional
        "audio_path": "/abs/path.mp3",  # optional
        "clips": [
          { "path": "/abs/path.mp4", "is_image": false,
            "start_frame": 0, "length": 60,
            "x": 0, "y": 0, "rotation": 0, "scale": 1,
            "opacity": 1, "blend": "normal",
            "fade_in": 0, "fade_out": 0 },
          ...
        ]
      }
    """
    import av

    fps = int(state.get("fps", 30))
    total_frames = int(state.get("total_frames", 0))
    if total_frames <= 0:
        total_frames = max((int(c.get("start_frame", 0)) + int(c.get("length", 0)) for c in state.get("clips", [])), default=1)
    total_frames = max(1, total_frames)
    W = int(state.get("canvas_width", 1280))
    H = int(state.get("canvas_height", 720))

    # Build a sane output filename in output_dir.
    base = (str(state.get("output_basename") or "timeline") + "_").rstrip(".")
    stamp = time.strftime("%Y%m%d_%H%M%S")
    out_name = f"{base}{stamp}.mp4"
    out_path = os.path.join(output_dir, out_name)
    os.makedirs(output_dir, exist_ok=True)

    # Open per-clip containers / pre-load images / pre-render text. Containers
    # are lazy decoders so we can seek per output frame.
    clips = _prepare_render_clips(state)

    # Output container + video stream.
    out = av.open(out_path, mode="w")
    out_stream = out.add_stream("h264", rate=Fraction(fps, 1))
    out_stream.width = W
    out_stream.height = H
    out_stream.pix_fmt = "yuv420p"
    # Reasonable defaults; user can re-encode externally if they want more control.
    out_stream.options = {"preset": "veryfast", "crf": "20"}

    # Audio: if provided, copy/transcode from source while we render video.
    audio_in_container = None
    audio_in_stream = None
    audio_out_stream = None
    resampler = None
    audio_path = state.get("audio_path")
    if audio_path and os.path.exists(audio_path):
        try:
            audio_in_container = av.open(audio_path, mode="r")
            audio_in_stream = audio_in_container.streams.audio[0]
            audio_out_stream = out.add_stream("aac", rate=audio_in_stream.rate)
            audio_out_stream.layout = "stereo"
        except Exception:
            audio_in_container = None
            audio_in_stream = None
            audio_out_stream = None

    # Frame-by-frame composite + encode.
    for f in range(total_frames):
        # .round() matches the golden CLI and /timeline/render_frame exactly —
        # truncation here would put exported video ±1 off every other surface.
        out_frame_arr = (render_frame_np(state, clips, f) * 255.0).round().astype(np.uint8)
        av_frame = av.VideoFrame.from_ndarray(out_frame_arr, format="rgb24")
        for packet in out_stream.encode(av_frame):
            out.mux(packet)

        if progress is not None:
            try:
                progress(f + 1, total_frames)
            except Exception:
                pass

    # Flush encoder.
    for packet in out_stream.encode():
        out.mux(packet)

    # Mux audio (length-clamped to the video duration).
    if audio_in_container is not None and audio_out_stream is not None:
        try:
            target_dur = total_frames / float(fps)
            for frame in audio_in_container.decode(audio_in_stream):
                if frame.time is not None and frame.time > target_dur:
                    break
                # Encode
                frame.pts = None
                for packet in audio_out_stream.encode(frame):
                    out.mux(packet)
            for packet in audio_out_stream.encode():
                out.mux(packet)
        except Exception:
            pass

    # Close inputs + output.
    _close_render_clips(clips)
    if audio_in_container is not None:
        try: audio_in_container.close()
        except Exception: pass
    out.close()

    size = os.path.getsize(out_path) if os.path.exists(out_path) else 0
    return {
        "filename": out_name,
        "type": "output",
        "subfolder": "",
        "size_bytes": size,
        "duration_sec": total_frames / float(fps),
        "frames": total_frames,
    }


# Register HTTP endpoint on Comfy's PromptServer if available.
try:
    from server import PromptServer
    from aiohttp import web
    import asyncio

    # Streaming variant: NDJSON progress events while the render runs, plus
    # a final "result" line with the file metadata. Same JSON body as the
    # non-streaming endpoint.
    @PromptServer.instance.routes.post("/comfynext/render_timeline_stream")
    async def _render_timeline_stream_route(request):
        try:
            state = await request.json()
        except Exception as e:
            return web.json_response({"error": f"bad json: {e}"}, status=400)

        input_dir = folder_paths.get_input_directory()
        output_dir = folder_paths.get_output_directory()
        if _is_edit_state(state):
            state = _adapt_edit_state(state)
        for c in state.get("clips", []):
            p = c.get("path")
            if p and not os.path.isabs(p):
                c["path"] = os.path.join(input_dir, p)
        if state.get("audio_path") and not os.path.isabs(state["audio_path"]):
            state["audio_path"] = os.path.join(input_dir, state["audio_path"])

        loop = asyncio.get_event_loop()
        q: asyncio.Queue = asyncio.Queue()

        def progress(current: int, total: int):
            # Called from the executor thread — bounce to the event loop.
            loop.call_soon_threadsafe(q.put_nowait, {"type": "progress", "current": current, "total": total})

        async def run_render():
            try:
                result = await loop.run_in_executor(
                    None, lambda: render_timeline_to_file(state, output_dir, progress)
                )
                # `result` already contains `type: "output"` (asset listing
                # convention). Use a distinct wrapper key so the frontend can
                # tell apart a progress tick from the final payload.
                await q.put({"type": "result", "result": result})
            except Exception as e:
                import traceback
                await q.put({"type": "error", "error": str(e), "trace": traceback.format_exc()})
            finally:
                await q.put({"type": "done"})

        resp = web.StreamResponse(
            status=200,
            headers={"Content-Type": "application/x-ndjson", "Cache-Control": "no-store"},
        )
        await resp.prepare(request)
        render_task = asyncio.create_task(run_render())
        try:
            while True:
                msg = await q.get()
                if msg.get("type") == "done":
                    break
                await resp.write((json.dumps(msg) + "\n").encode("utf-8"))
        finally:
            await render_task  # ensure cleanup
        await resp.write_eof()
        return resp

    @PromptServer.instance.routes.post("/comfynext/render_timeline")
    async def _render_timeline_route(request):
        try:
            state = await request.json()
        except Exception as e:
            return web.json_response({"error": f"bad json: {e}"}, status=400)

        input_dir = folder_paths.get_input_directory()
        output_dir = folder_paths.get_output_directory()

        # Accept the editor's EditState (any supported version) by flattening to
        # the legacy shape before path resolution + render.
        if _is_edit_state(state):
            state = _adapt_edit_state(state)

        # Resolve clip paths: accept either absolute paths or filenames under input/.
        for c in state.get("clips", []):
            p = c.get("path")
            if p and not os.path.isabs(p):
                c["path"] = os.path.join(input_dir, p)
        if state.get("audio_path") and not os.path.isabs(state["audio_path"]):
            state["audio_path"] = os.path.join(input_dir, state["audio_path"])

        # Run the (CPU-bound) render off the event loop so it doesn't block aiohttp.
        loop = asyncio.get_event_loop()
        try:
            result = await loop.run_in_executor(None, render_timeline_to_file, state, output_dir)
        except Exception as e:
            import traceback
            return web.json_response(
                {"error": str(e), "trace": traceback.format_exc()},
                status=500,
            )
        return web.json_response(result)

    @PromptServer.instance.routes.post("/comfynext/timeline/render_frame")
    async def _render_frame_route(request):
        """Render one composited frame of an edit state to PNG. Harness/debug
        surface: the browser golden harness compares PreviewRenderer output
        against this — the same render_frame_np the export uses."""
        try:
            body = await request.json()
        except Exception:
            return web.json_response({"error": "invalid json"}, status=400)
        state = body.get("state")
        try:
            frame = int(body.get("frame", 0))
        except (TypeError, ValueError):
            return web.json_response({"error": "invalid frame"}, status=400)
        if _is_edit_state(state):
            state = _adapt_edit_state(state)
        if not isinstance(state, dict) or not isinstance(state.get("clips"), list):
            return web.json_response({"error": "not an edit state"}, status=400)

        def _render() -> bytes:
            from io import BytesIO
            clips = _prepare_render_clips(state)
            try:
                arr = render_frame_np(state, clips, frame)
            finally:
                _close_render_clips(clips)
            buf = BytesIO()
            PILImage.fromarray((arr * 255.0).round().astype(np.uint8)).save(buf, format="PNG")
            return buf.getvalue()

        data = await asyncio.get_event_loop().run_in_executor(None, _render)
        return web.Response(body=data, content_type="image/png")

    # ── Media listing endpoint ──────────────────────────────────────────────
    #
    # Comfy's /history is in-memory and lost on every server restart, and
    # files written through side-channel endpoints (like /comfynext/render_
    # timeline) never enter it. The Assets tab calls this endpoint to get a
    # complete listing of media files actually on disk in output/.

    _MEDIA_EXTS = {
        ".png", ".jpg", ".jpeg", ".webp", ".gif",          # images
        ".mp4", ".webm", ".mov", ".avi", ".mkv", ".m4v",   # video
        ".mp3", ".wav", ".flac", ".ogg", ".m4a", ".aac",   # audio
    }

    @PromptServer.instance.routes.get("/comfynext/output_listing")
    async def _output_listing_route(_request):
        output_dir = folder_paths.get_output_directory()
        items: list[dict] = []
        try:
            for root, _dirs, files in os.walk(output_dir):
                for fname in files:
                    if fname.startswith("."):
                        continue
                    ext = os.path.splitext(fname)[1].lower()
                    if ext not in _MEDIA_EXTS:
                        continue
                    full = os.path.join(root, fname)
                    try:
                        st = os.stat(full)
                    except OSError:
                        continue
                    rel_sub = os.path.relpath(root, output_dir)
                    subfolder = "" if rel_sub == "." else rel_sub
                    items.append({
                        "filename": fname,
                        "subfolder": subfolder,
                        "type": "output",
                        "size": st.st_size,
                        "mtime": st.st_mtime,
                    })
        except Exception as e:
            return web.json_response({"error": str(e), "items": []}, status=500)
        # Newest first.
        items.sort(key=lambda x: x["mtime"], reverse=True)
        return web.json_response({"items": items})

    # ── Asset library ──────────────────────────────────────────────────────
    #
    # Asset records live in user/timeline_assets.json. Each asset points at a
    # path on disk (typically under input/) along with cached metadata (kind,
    # duration, dimensions). The new TimelineEditor drags from this library.

    def _assets_file() -> str:
        user_dir = folder_paths.get_user_directory()
        os.makedirs(user_dir, exist_ok=True)
        return os.path.join(user_dir, "timeline_assets.json")

    def _load_assets() -> list:
        p = _assets_file()
        if not os.path.exists(p):
            return []
        try:
            with open(p, "r") as f:
                return json.load(f)
        except Exception:
            return []

    def _save_assets(assets: list):
        with open(_assets_file(), "w") as f:
            json.dump(assets, f, indent=2)

    def _probe_media(path: str) -> dict:
        ext = os.path.splitext(path)[1].lower()
        info = {"duration_sec": None, "width": None, "height": None}
        video_exts = {".mp4", ".webm", ".mov", ".avi", ".mkv", ".m4v"}
        image_exts = {".png", ".jpg", ".jpeg", ".webp", ".gif"}
        audio_exts = {".mp3", ".wav", ".flac", ".ogg", ".m4a", ".aac"}
        if ext in video_exts:
            info["kind"] = "video"
            try:
                import av
                c = av.open(path, mode="r")
                vs = c.streams.video[0]
                info["width"], info["height"] = vs.width, vs.height
                if vs.duration and vs.time_base:
                    info["duration_sec"] = float(vs.duration * vs.time_base)
                c.close()
            except Exception:
                pass
        elif ext in image_exts:
            info["kind"] = "image"
            try:
                img = PILImage.open(path)
                info["width"], info["height"] = img.size
                img.close()
            except Exception:
                pass
        elif ext in audio_exts:
            info["kind"] = "audio"
            try:
                import av
                c = av.open(path, mode="r")
                a = c.streams.audio[0]
                if a.duration and a.time_base:
                    info["duration_sec"] = float(a.duration * a.time_base)
                c.close()
            except Exception:
                pass
        else:
            info["kind"] = "video"
        return info

    @PromptServer.instance.routes.get("/comfynext/assets")
    async def _assets_list_route(_request):
        return web.json_response({"assets": _load_assets()})

    @PromptServer.instance.routes.post("/comfynext/asset_import")
    async def _asset_import_route(request):
        try:
            body = await request.json()
        except Exception as e:
            return web.json_response({"error": f"bad json: {e}"}, status=400)
        path = body.get("path")
        if not path:
            return web.json_response({"error": "missing 'path'"}, status=400)
        input_dir = folder_paths.get_input_directory()
        if not os.path.isabs(path):
            path = os.path.join(input_dir, path)
        if not os.path.exists(path):
            return web.json_response({"error": f"not found: {path}"}, status=404)

        loop = asyncio.get_event_loop()
        info = await loop.run_in_executor(None, _probe_media, path)

        assets = _load_assets()
        existing = next((a for a in assets if a["path"] == path), None)
        if existing:
            return web.json_response({"asset": existing, "created": False})

        asset = {
            "id": str(uuid.uuid4()),
            "path": path,
            "kind": info["kind"],
            "name": os.path.basename(path),
            "duration_sec": info["duration_sec"],
            "width":  info["width"],
            "height": info["height"],
            "thumbnail_path": None,
            "waveform_path":  None,
        }
        assets.append(asset)
        _save_assets(assets)
        return web.json_response({"asset": asset, "created": True})

    @PromptServer.instance.routes.delete("/comfynext/assets/{asset_id}")
    async def _asset_delete_route(request):
        asset_id = request.match_info["asset_id"]
        assets = [a for a in _load_assets() if a["id"] != asset_id]
        _save_assets(assets)
        return web.json_response({"ok": True})

    # ── Thumbnails ─────────────────────────────────────────────────────────
    #
    # Generates N evenly-spaced thumbnails for a video asset (or one
    # thumbnail for an image). Returned as base64 PNG strings the frontend
    # can drop straight into a CSS background-image. Cached on disk in
    # user/timeline_thumbs/<asset_id>/<count>.json so repeated requests are
    # cheap.

    def _thumb_cache_dir() -> str:
        user_dir = folder_paths.get_user_directory()
        d = os.path.join(user_dir, "timeline_thumbs")
        os.makedirs(d, exist_ok=True)
        return d

    def _thumb_height_px() -> int:
        return 48  # source-strip thumbnail height in px; width derived from aspect

    def _gen_thumbnails(asset_path: str, count: int) -> list[str]:
        """Return `count` base64 PNG thumbnails. For images, returns one entry."""
        import base64
        from io import BytesIO

        ext = os.path.splitext(asset_path)[1].lower()
        thumb_h = _thumb_height_px()

        if ext in {".png", ".jpg", ".jpeg", ".webp", ".gif"}:
            try:
                img = PILImage.open(asset_path).convert("RGB")
                w, h = img.size
                tw = max(1, int(round(w * thumb_h / h)))
                img = img.resize((tw, thumb_h), PILImage.BILINEAR)
                buf = BytesIO()
                img.save(buf, format="PNG", optimize=True)
                return ["data:image/png;base64," + base64.b64encode(buf.getvalue()).decode()]
            except Exception:
                return []

        # Video path: seek to evenly-spaced timestamps.
        try:
            import av
            c = av.open(asset_path, mode="r")
            vs = c.streams.video[0]
            tb = vs.time_base
            dur_pts = vs.duration or 0
            dur_sec = float(dur_pts * tb) if tb else 0.0
            if dur_sec <= 0:
                # Try container duration as fallback (in microseconds).
                dur_sec = float((c.duration or 0) / 1_000_000.0)
            if dur_sec <= 0:
                c.close()
                return []

            out: list[str] = []
            step = dur_sec / max(1, count)
            for i in range(count):
                t = step * (i + 0.5)  # center each thumb in its slice
                target_pts = int(t / float(tb))
                try:
                    c.seek(max(0, target_pts), stream=vs, any_frame=False, backward=True)
                except Exception:
                    pass
                frame = None
                for f in c.decode(vs):
                    frame = f
                    if f.pts is not None and f.pts >= target_pts:
                        break
                if frame is None:
                    continue
                pil = PILImage.fromarray(frame.to_ndarray(format="rgb24"))
                w, h = pil.size
                tw = max(1, int(round(w * thumb_h / h)))
                pil = pil.resize((tw, thumb_h), PILImage.BILINEAR)
                buf = BytesIO()
                pil.save(buf, format="PNG", optimize=True)
                out.append("data:image/png;base64," + base64.b64encode(buf.getvalue()).decode())
            c.close()
            return out
        except Exception:
            return []

    @PromptServer.instance.routes.get("/comfynext/asset_thumbnails")
    async def _asset_thumbs_route(request):
        asset_id = request.query.get("asset_id")
        try:
            count = max(1, min(20, int(request.query.get("count", "5"))))
        except ValueError:
            count = 5
        if not asset_id:
            return web.json_response({"error": "missing asset_id"}, status=400)

        cache_dir = _thumb_cache_dir()
        cache_file = os.path.join(cache_dir, f"{asset_id}.{count}.json")
        if os.path.exists(cache_file):
            try:
                with open(cache_file, "r") as f:
                    return web.json_response(json.load(f))
            except Exception:
                pass

        asset = next((a for a in _load_assets() if a["id"] == asset_id), None)
        if not asset:
            return web.json_response({"error": "asset not found"}, status=404)

        loop = asyncio.get_event_loop()
        thumbs = await loop.run_in_executor(None, _gen_thumbnails, asset["path"], count)
        payload = {"thumbnails": thumbs, "asset_id": asset_id, "count": count}
        try:
            with open(cache_file, "w") as f:
                json.dump(payload, f)
        except Exception:
            pass
        return web.json_response(payload)

    # ── Waveforms ─────────────────────────────────────────────────────────
    #
    # One-shot peak generator for audio assets. Returns N normalized peaks
    # in [0, 1], one per pixel-bucket. Cached on disk like thumbnails.

    def _gen_waveform_peaks(asset_path: str, bucket_count: int) -> list[float]:
        try:
            import av
            c = av.open(asset_path, mode="r")
            a = c.streams.audio[0]
            # Decode all samples into a flat ndarray, take absolute max per bucket.
            samples = []
            for frame in c.decode(a):
                arr = frame.to_ndarray()
                # Mix to mono if multi-channel.
                if arr.ndim == 2:
                    arr = arr.mean(axis=0) if arr.shape[0] <= 8 else arr.mean(axis=1)
                samples.append(np.abs(arr).astype(np.float32))
            c.close()
            if not samples:
                return []
            flat = np.concatenate(samples)
            # Normalize.
            peak = float(flat.max()) or 1.0
            flat /= peak
            # Bucket.
            n = max(1, bucket_count)
            chunk = max(1, len(flat) // n)
            buckets = []
            for i in range(n):
                start = i * chunk
                end = (i + 1) * chunk if i < n - 1 else len(flat)
                if start >= len(flat):
                    buckets.append(0.0)
                    continue
                buckets.append(float(flat[start:end].max()))
            return buckets
        except Exception:
            return []

    @PromptServer.instance.routes.get("/comfynext/asset_waveform")
    async def _asset_waveform_route(request):
        asset_id = request.query.get("asset_id")
        try:
            buckets = max(16, min(2048, int(request.query.get("buckets", "256"))))
        except ValueError:
            buckets = 256
        if not asset_id:
            return web.json_response({"error": "missing asset_id"}, status=400)

        cache_file = os.path.join(_thumb_cache_dir(), f"wave_{asset_id}.{buckets}.json")
        if os.path.exists(cache_file):
            try:
                with open(cache_file, "r") as f:
                    return web.json_response(json.load(f))
            except Exception:
                pass

        asset = next((a for a in _load_assets() if a["id"] == asset_id), None)
        if not asset:
            return web.json_response({"error": "asset not found"}, status=404)

        loop = asyncio.get_event_loop()
        peaks = await loop.run_in_executor(None, _gen_waveform_peaks, asset["path"], buckets)
        payload = {"peaks": peaks, "asset_id": asset_id, "buckets": buckets}
        try:
            with open(cache_file, "w") as f:
                json.dump(payload, f)
        except Exception:
            pass
        return web.json_response(payload)

    # ── Input dir listing ──────────────────────────────────────────────────
    #
    # The "Input Files" pane in the editor uses this to enumerate media files
    # the user can drag into the timeline as assets.

    @PromptServer.instance.routes.get("/comfynext/input_listing")
    async def _input_listing_route(_request):
        input_dir = folder_paths.get_input_directory()
        items: list[dict] = []
        try:
            for fname in os.listdir(input_dir):
                if fname.startswith("."):
                    continue
                full = os.path.join(input_dir, fname)
                if not os.path.isfile(full):
                    continue
                ext = os.path.splitext(fname)[1].lower()
                if ext not in _MEDIA_EXTS:
                    continue
                try:
                    st = os.stat(full)
                except OSError:
                    continue
                items.append({
                    "filename": fname,
                    "path": full,
                    "type": "input",
                    "size": st.st_size,
                    "mtime": st.st_mtime,
                })
        except Exception as e:
            return web.json_response({"error": str(e), "items": []}, status=500)
        items.sort(key=lambda x: x["mtime"], reverse=True)
        return web.json_response({"items": items})
except Exception:
    # Module imported outside the server context (e.g., a syntax-check import) — skip.
    pass


class TimelineExtension(ComfyExtension):
    @override
    async def get_node_list(self) -> list[type[IO.ComfyNode]]:
        return [TimelineNode]


async def comfy_entrypoint() -> TimelineExtension:
    return TimelineExtension()
