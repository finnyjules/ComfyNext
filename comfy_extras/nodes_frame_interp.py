"""Frame interpolation via dense optical flow (OpenCV Farneback).

Synthesizes in-between frames by computing flow between consecutive frames
and warping forward & backward, then blending. Quality is solid for moderate
motion (talking heads, slow pans, drone shots); less impressive for fast
action than RIFE/FILM but ships dependency-free and runs at CPU speeds.
"""
from __future__ import annotations

import numpy as np
import torch
from typing_extensions import override

from comfy_api.latest import ComfyExtension, IO


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


class FrameInterpExtension(ComfyExtension):
    @override
    async def get_node_list(self) -> list[type[IO.ComfyNode]]:
        return [FrameInterpolateNode]


async def comfy_entrypoint() -> FrameInterpExtension:
    return FrameInterpExtension()
