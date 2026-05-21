"""Timeline node — like the Compositor, but each input is a video clip with
its own start frame, length, fade in/out, and transform. Output is a single
composite video on a fixed-size canvas.

Wiring:  LoadVideo → GetVideoComponents → Timeline → CreateVideo → SaveVideo

Frames-of-a-clip are batches `[T, H, W, 3]`. The first connected clip sets
the canvas size (matching the Compositor convention).
"""
from __future__ import annotations

import os
import time
from fractions import Fraction

import numpy as np
import torch
from PIL import Image as PILImage
from typing_extensions import override

import folder_paths
from comfy_api.latest import ComfyExtension, IO
from comfy_extras._live_preview import save_live_preview
from comfy_extras.nodes_compositor import _BLEND_MODES, _blend, _fit_to_canvas, _transform


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


def _clip_inputs(idx: int, optional: bool):
    """Per-clip input declarations. clip1 is required (defines canvas size)."""
    start_default = (idx - 1) * 12   # stagger clips by default so they don't overlap fully
    return [
        IO.Image.Input(f"clip{idx}", optional=optional,
                      tooltip=f"Clip {idx}" + (" (sets canvas size)" if idx == 1 else "")),
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
        for i in range(1, 5):
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
        ])
        return IO.Schema(
            node_id="Timeline",
            display_name="Timeline",
            description="Composite multiple clips on a timeline with per-clip start, transform, opacity, blend, and fades.",
            category="video",
            inputs=inputs,
            outputs=[IO.Image.Output(display_name="frames")],
            hidden=[IO.Hidden.unique_id],
            is_output_node=True,
        )

    @classmethod
    def execute(cls, **kwargs) -> IO.NodeOutput:
        # Gather connected layers.
        layers = []
        for i in range(1, 5):
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
            return IO.NodeOutput(blank, ui=save_live_preview(blank, str(cls.hidden.unique_id)))

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
        return IO.NodeOutput(output, ui=save_live_preview(preview, str(cls.hidden.unique_id)))


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
    # Rotate (with expand to avoid clipping during rotation).
    if rotation != 0.0:
        fitted = fitted.rotate(-float(rotation), resample=PILImage.BILINEAR, expand=True)
    fw, fh = fitted.size

    # Paste fitted on a transparent RGBA canvas at center + offset.
    canvas = PILImage.new("RGBA", (canvas_w, canvas_h), (0, 0, 0, 0))
    cx = canvas_w // 2 + int(round(float(x) * canvas_w)) - fw // 2
    cy = canvas_h // 2 + int(round(float(y) * canvas_h)) - fh // 2
    # Build alpha-bearing version of the fitted layer.
    rgba = fitted.convert("RGBA")
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


def render_timeline_to_file(state: dict, output_dir: str) -> dict:
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
    bg_rgb = _hex_rgb_safe(state.get("bg_color"), (0.0, 0.0, 0.0))
    bg = np.array(bg_rgb, dtype=np.float32).reshape(1, 1, 3)

    # Build a sane output filename in output_dir.
    base = (str(state.get("output_basename") or "timeline") + "_").rstrip(".")
    stamp = time.strftime("%Y%m%d_%H%M%S")
    out_name = f"{base}{stamp}.mp4"
    out_path = os.path.join(output_dir, out_name)
    os.makedirs(output_dir, exist_ok=True)

    # Open per-clip containers / pre-load images / pre-render text. Containers
    # are lazy decoders so we can seek per output frame.
    clips: list[dict] = []
    for c in state.get("clips", []):
        kind = str(c.get("kind") or ("image" if c.get("is_image") else "video"))
        entry = {
            "kind":   kind,
            "start":  int(c.get("start_frame", 0)),
            "length": int(c.get("length", 30)),
            "x":      float(c.get("x", 0)),
            "y":      float(c.get("y", 0)),
            "rot":    float(c.get("rotation", 0)),
            "scl":    float(c.get("scale", 1)),
            "op":     float(c.get("opacity", 1)),
            "blend":  str(c.get("blend", "normal")),
            "fade_in":  int(c.get("fade_in", 0)),
            "fade_out": int(c.get("fade_out", 0)),
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
        canvas = np.broadcast_to(bg, (H, W, 3)).copy()  # writable

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
                local_sec = local_f / fps
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

            rgb, alpha = _transform_and_alpha(src_pil, W, H, L["x"], L["y"], L["rot"], L["scl"])
            a = alpha * L["op"] * fade
            blended = _blend_np(canvas, rgb, L["blend"])
            canvas = canvas * (1.0 - a) + blended * a

        # Encode this frame.
        out_frame_arr = np.clip(canvas, 0.0, 1.0)
        out_frame_arr = (out_frame_arr * 255.0).astype(np.uint8)
        av_frame = av.VideoFrame.from_ndarray(out_frame_arr, format="rgb24")
        for packet in out_stream.encode(av_frame):
            out.mux(packet)

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
    for L in clips:
        if "container" in L:
            try: L["container"].close()
            except Exception: pass
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

    @PromptServer.instance.routes.post("/comfynext/render_timeline")
    async def _render_timeline_route(request):
        try:
            state = await request.json()
        except Exception as e:
            return web.json_response({"error": f"bad json: {e}"}, status=400)

        # Resolve clip paths: accept either absolute paths or filenames under input/.
        input_dir = folder_paths.get_input_directory()
        output_dir = folder_paths.get_output_directory()
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
except Exception:
    # Module imported outside the server context (e.g., a syntax-check import) — skip.
    pass


class TimelineExtension(ComfyExtension):
    @override
    async def get_node_list(self) -> list[type[IO.ComfyNode]]:
        return [TimelineNode]


async def comfy_entrypoint() -> TimelineExtension:
    return TimelineExtension()
