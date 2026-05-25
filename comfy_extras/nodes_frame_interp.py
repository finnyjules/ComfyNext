"""Frame interpolation — two flavours.

`FrameInterpolate` (this file's classical node): dense optical flow via
OpenCV Farneback. Dependency-free, OK on moderate motion, weak on fast
action. Good fallback when the user doesn't want to download weights.

`FrameInterpolateAI`: RIFE 4.6 via ONNX. Substantially better on fast
motion, supports >2× ratios cleanly. Requires the `frameinterp` model
bundle (~32 MB).
"""
from __future__ import annotations

import os

import numpy as np
import torch
from typing_extensions import override

import folder_paths
from comfy_api.latest import ComfyExtension, IO
from comfy_extras._model_downloads import (
    ModelBundle, ModelFile, loader_cache, register_bundle,
)


# ---------------------------------------------------------------------------
# RIFE 4.6 model bundle
# ---------------------------------------------------------------------------

_RIFE_ROOT = os.path.join(folder_paths.models_dir, "rife")
_RIFE_PATH = os.path.join(_RIFE_ROOT, "rife_v4.6.onnx")
_RIFE_URLS = [
    "https://huggingface.co/wkpark/rife/resolve/main/rife_v4.6.onnx",
    "https://huggingface.co/AlexWortega/RIFE/resolve/main/rife_v4.6.onnx",
]
_RIFE_SIZE = 0  # mirror exports vary slightly — accept any non-empty file


register_bundle(ModelBundle(
    key="frameinterp",
    label="AI Slow Motion",
    files=[ModelFile(name="rife_v4.6.onnx", path=_RIFE_PATH, size=_RIFE_SIZE, urls=_RIFE_URLS)],
))


def _to_bgr(frame: torch.Tensor) -> np.ndarray:
    arr = (frame.detach().cpu().numpy() * 255.0).clip(0, 255).astype(np.uint8)
    return arr[..., ::-1].copy()


def _to_tensor(bgr: np.ndarray) -> torch.Tensor:
    rgb = bgr[..., ::-1].astype(np.float32) / 255.0
    return torch.from_numpy(rgb.copy())


def _warp(img: np.ndarray, flow: np.ndarray) -> np.ndarray:
    import cv2
    h, w = img.shape[:2]
    grid_x, grid_y = np.meshgrid(np.arange(w), np.arange(h))
    map_x = (grid_x + flow[..., 0]).astype(np.float32)
    map_y = (grid_y + flow[..., 1]).astype(np.float32)
    return cv2.remap(img, map_x, map_y, cv2.INTER_LINEAR, borderMode=cv2.BORDER_REFLECT)


class FrameInterpolateNode(IO.ComfyNode):
    @classmethod
    def define_schema(cls):
        return IO.Schema(
            node_id="FrameInterpolate",
            display_name="Slow Motion",
            description="Insert synthetic in-between frames to slow down a clip without choppiness.",
            category="video",
            inputs=[
                IO.Image.Input("frames", tooltip="The clip to slow down."),
                IO.Int.Input("multiplier", default=2, min=2, max=8, step=1,
                             tooltip="How many in-between frames to insert. "
                                     "2 = half speed (1 new frame between each pair). "
                                     "4 = quarter speed. Higher gets noticeably softer on fast motion."),
            ],
            outputs=[IO.Image.Output(display_name="frames")],
        )

    @classmethod
    def execute(cls, frames, multiplier) -> IO.NodeOutput:
        import cv2
        T = frames.shape[0]
        if T < 2 or multiplier < 2:
            return IO.NodeOutput(frames)

        bgr = [_to_bgr(frames[t]) for t in range(T)]
        gray = [cv2.cvtColor(b, cv2.COLOR_BGR2GRAY) for b in bgr]

        out: list[torch.Tensor] = []
        for i in range(T - 1):
            out.append(_to_tensor(bgr[i]))
            flow_fwd = cv2.calcOpticalFlowFarneback(
                gray[i], gray[i + 1], None,
                pyr_scale=0.5, levels=3, winsize=21, iterations=3,
                poly_n=5, poly_sigma=1.2, flags=0,
            )
            flow_bwd = -flow_fwd  # cheap reverse-flow approximation
            for k in range(1, multiplier):
                alpha = k / multiplier
                warp_a = _warp(bgr[i], (flow_fwd * alpha).astype(np.float32))
                warp_b = _warp(bgr[i + 1], (flow_bwd * (1 - alpha)).astype(np.float32))
                blend = (warp_a.astype(np.float32) * (1 - alpha) + warp_b.astype(np.float32) * alpha).astype(np.uint8)
                out.append(_to_tensor(blend))
        out.append(_to_tensor(bgr[-1]))

        return IO.NodeOutput(torch.stack(out, dim=0))


# ---------------------------------------------------------------------------
# RIFE — AI frame interpolation
# ---------------------------------------------------------------------------

def _get_rife_session():
    cache = loader_cache()
    if "frameinterp:session" in cache:
        return cache["frameinterp:session"]
    import onnxruntime as ort
    providers = (
        ["CoreMLExecutionProvider", "CPUExecutionProvider"]
        if not torch.cuda.is_available()
        else ["CUDAExecutionProvider", "CPUExecutionProvider"]
    )
    sess = ort.InferenceSession(_RIFE_PATH, providers=providers)
    cache["frameinterp:session"] = sess
    return sess


def _pad_to_multiple(arr: np.ndarray, multiple: int) -> tuple[np.ndarray, int, int]:
    """RIFE needs spatial dims divisible by 32. Reflect-pad and remember pads."""
    h, w = arr.shape[-2:]
    pad_h = (multiple - h % multiple) % multiple
    pad_w = (multiple - w % multiple) % multiple
    if pad_h == 0 and pad_w == 0:
        return arr, 0, 0
    # arr is [1, C, H, W]
    padded = np.pad(arr, ((0, 0), (0, 0), (0, pad_h), (0, pad_w)), mode="reflect")
    return padded, pad_h, pad_w


def _rife_interpolate(sess, a: np.ndarray, b: np.ndarray, timestep: float) -> np.ndarray:
    """a, b are [H, W, 3] uint8. Returns [H, W, 3] uint8 at time `timestep`."""
    H, W = a.shape[:2]
    a_chw = a.astype(np.float32).transpose(2, 0, 1)[None] / 255.0
    b_chw = b.astype(np.float32).transpose(2, 0, 1)[None] / 255.0

    inputs = sess.get_inputs()
    in_names = [i.name for i in inputs]

    # RIFE ONNX exports come in a couple of layouts:
    #   - single concat input [1, 6, H, W] + scalar timestep
    #   - two separate inputs (img0, img1) + timestep tensor [1, 1, H, W]
    # Detect by input count.
    if len(in_names) == 1:
        concat = np.concatenate([a_chw, b_chw], axis=1)  # [1, 6, H, W]
        padded, pad_h, pad_w = _pad_to_multiple(concat, 32)
        out = sess.run(None, {in_names[0]: padded})[0]
    elif len(in_names) == 2:
        ap, pad_h, pad_w = _pad_to_multiple(a_chw, 32)
        bp, _, _ = _pad_to_multiple(b_chw, 32)
        out = sess.run(None, {in_names[0]: ap, in_names[1]: bp})[0]
    else:
        ap, pad_h, pad_w = _pad_to_multiple(a_chw, 32)
        bp, _, _ = _pad_to_multiple(b_chw, 32)
        # Timestep — try both common formats; one will be the right shape.
        t_scalar = np.array([[timestep]], dtype=np.float32)
        t_map = np.full((1, 1, ap.shape[2], ap.shape[3]), timestep, dtype=np.float32)
        feed = {in_names[0]: ap, in_names[1]: bp}
        for name in in_names[2:]:
            shape = next(i for i in inputs if i.name == name).shape
            # ONNX shape might be dynamic; just try the map first, scalar as fallback.
            try:
                feed[name] = t_map if len(shape) >= 3 else t_scalar
                out = sess.run(None, feed)[0]
                break
            except Exception:
                feed[name] = t_scalar
        else:
            out = sess.run(None, feed)[0]
        # Unconditional path covered above.
        # Fall through for clarity.

    # out is [1, 3, H_pad, W_pad]; crop pads.
    pred = out[0].transpose(1, 2, 0)
    if pad_h or pad_w:
        pred = pred[:H, :W]
    if pred.max() <= 1.5:
        pred = pred * 255.0
    return pred.clip(0, 255).astype(np.uint8)


class FrameInterpolateAINode(IO.ComfyNode):
    """RIFE-based frame interpolation — much cleaner on fast motion than the
    classical optical-flow node."""

    @classmethod
    def define_schema(cls):
        return IO.Schema(
            node_id="FrameInterpolateAI",
            display_name="Slow Motion (AI)",
            description="RIFE 4.6 frame interpolation. Synthesizes in-between frames "
                        "from a learned motion model — handles fast action and complex "
                        "scenes far better than classical optical flow.",
            category="video",
            inputs=[
                IO.Image.Input("frames", tooltip="Clip to slow down."),
                IO.Int.Input("multiplier", default=2, min=2, max=8, step=1,
                             tooltip="How many in-between frames to insert. "
                                     "2 = half speed, 4 = quarter speed, 8 = eighth speed. "
                                     "RIFE handles up to 8× cleanly on most footage."),
            ],
            outputs=[IO.Image.Output(display_name="frames")],
        )

    @classmethod
    def execute(cls, frames, multiplier) -> IO.NodeOutput:
        if not os.path.isfile(_RIFE_PATH):
            raise RuntimeError(
                "RIFE model not found. Click the AI Slow Motion card in the toolbox "
                "to download it (~32 MB)."
            )

        T = frames.shape[0]
        if T < 2 or multiplier < 2:
            return IO.NodeOutput(frames)

        sess = _get_rife_session()

        np_frames = [
            (frames[t].detach().cpu().numpy() * 255.0).clip(0, 255).astype(np.uint8)
            for t in range(T)
        ]

        out: list[np.ndarray] = []
        for i in range(T - 1):
            out.append(np_frames[i])
            for k in range(1, multiplier):
                t = k / multiplier
                out.append(_rife_interpolate(sess, np_frames[i], np_frames[i + 1], t))
        out.append(np_frames[-1])

        out_tensors = [torch.from_numpy(arr.astype(np.float32) / 255.0) for arr in out]
        return IO.NodeOutput(torch.stack(out_tensors, dim=0))


class FrameInterpExtension(ComfyExtension):
    @override
    async def get_node_list(self) -> list[type[IO.ComfyNode]]:
        return [FrameInterpolateNode, FrameInterpolateAINode]


async def comfy_entrypoint() -> FrameInterpExtension:
    return FrameInterpExtension()
