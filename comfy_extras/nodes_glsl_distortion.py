from __future__ import annotations

import math

import torch
import torch.nn.functional as F
from typing_extensions import override

from comfy_api.latest import ComfyExtension, IO
from comfy_extras._live_preview import save_live_preview


def _grid(shape, device, dtype):
    _, _, h, w = shape
    yy, xx = torch.meshgrid(
        torch.linspace(-1.0, 1.0, h, device=device, dtype=dtype),
        torch.linspace(-1.0, 1.0, w, device=device, dtype=dtype),
        indexing="ij",
    )
    return xx, yy


def _sample(t, gx, gy, pad="border"):
    grid = torch.stack([gx, gy], dim=-1).unsqueeze(0).expand(t.shape[0], -1, -1, -1)
    return F.grid_sample(t, grid, mode="bilinear", padding_mode=pad, align_corners=False)


class KaleidoscopeNode(IO.ComfyNode):
    @classmethod
    def define_schema(cls):
        return IO.Schema(
            node_id="Kaleidoscope",
            display_name="Kaleidoscope",
            description="Mirror the image into N angular segments.",
            category="image/distortion",
            inputs=[
                IO.Image.Input("image"),
                IO.Int.Input("segments", default=6, min=2, max=20, step=1),
                IO.Float.Input("rotation", default=0.0, min=0.0, max=360.0, step=1.0),
            ],
            outputs=[IO.Image.Output(display_name="image")],
            hidden=[IO.Hidden.unique_id],
            is_output_node=True,
        )

    @classmethod
    def execute(cls, image, segments, rotation) -> IO.NodeOutput:
        t = image.permute(0, 3, 1, 2)
        xx, yy = _grid(t.shape, t.device, t.dtype)
        # Polar
        theta = torch.atan2(yy, xx)
        r = torch.sqrt(xx * xx + yy * yy)
        seg = 2.0 * math.pi / segments
        # Fold theta into a single segment via abs(modulo - segment/2)
        rot = math.radians(rotation)
        theta = (theta + rot) % seg
        theta = torch.where(theta > seg / 2, seg - theta, theta)
        # Back to cartesian
        gx = r * torch.cos(theta)
        gy = r * torch.sin(theta)
        t = _sample(t, gx, gy)
        x = t.permute(0, 2, 3, 1).clamp(0, 1)
        return IO.NodeOutput(x, ui=save_live_preview(x, str(cls.hidden.unique_id)))


class PolarCoordsNode(IO.ComfyNode):
    @classmethod
    def define_schema(cls):
        return IO.Schema(
            node_id="PolarCoords",
            display_name="Polar Coordinates",
            description="Wrap the image into a circle (rect → polar).",
            category="image/distortion",
            inputs=[
                IO.Image.Input("image"),
                IO.Combo.Input("direction", options=["rect_to_polar", "polar_to_rect"], default="rect_to_polar"),
            ],
            outputs=[IO.Image.Output(display_name="image")],
            hidden=[IO.Hidden.unique_id],
            is_output_node=True,
        )

    @classmethod
    def execute(cls, image, direction) -> IO.NodeOutput:
        t = image.permute(0, 3, 1, 2)
        xx, yy = _grid(t.shape, t.device, t.dtype)
        if direction == "rect_to_polar":
            r = torch.sqrt(xx * xx + yy * yy).clamp(0, 1)
            theta = torch.atan2(yy, xx)
            # Map (theta, r) → source UV; theta in [-pi, pi]
            sx = theta / math.pi  # [-1, 1]
            sy = r * 2.0 - 1.0    # [-1, 1]
        else:
            # x in [-1, 1] -> angle in [-pi, pi]; y in [-1, 1] -> radius in [0, 1]
            theta = xx * math.pi
            r = (yy + 1.0) * 0.5
            sx = r * torch.cos(theta)
            sy = r * torch.sin(theta)
        t = _sample(t, sx, sy)
        x = t.permute(0, 2, 3, 1).clamp(0, 1)
        return IO.NodeOutput(x, ui=save_live_preview(x, str(cls.hidden.unique_id)))


class GlitchNode(IO.ComfyNode):
    @classmethod
    def define_schema(cls):
        return IO.Schema(
            node_id="Glitch",
            display_name="Glitch",
            description="Random horizontal slice shifts with per-channel offsets.",
            category="image/distortion",
            inputs=[
                IO.Image.Input("image"),
                IO.Float.Input("intensity", default=0.4, min=0.0, max=1.0, step=0.01),
                IO.Int.Input("slices", default=20, min=2, max=60, step=1),
                IO.Int.Input("seed", default=1, min=0, max=2 ** 31 - 1, step=1),
            ],
            outputs=[IO.Image.Output(display_name="image")],
            hidden=[IO.Hidden.unique_id],
            is_output_node=True,
        )

    @classmethod
    def execute(cls, image, intensity, slices, seed) -> IO.NodeOutput:
        if intensity <= 0:
            x = image.clamp(0, 1)
        else:
            b, h, w, c = image.shape
            g = torch.Generator(device=image.device).manual_seed(int(seed))
            x = image.clone()
            slice_h = max(1, h // int(slices))
            # Per-slice horizontal pixel shift
            max_shift = int(intensity * w * 0.15)
            for i in range(0, h, slice_h):
                end = min(h, i + slice_h)
                shift = int((torch.rand(1, generator=g, device=image.device).item() - 0.5) * 2 * max_shift)
                x[:, i:end] = torch.roll(image[:, i:end], shifts=shift, dims=2)
            # Per-channel small offset
            chroma = max(1, int(intensity * w * 0.005))
            x[..., 0] = torch.roll(x[..., 0], shifts=chroma, dims=2)
            x[..., 2] = torch.roll(x[..., 2], shifts=-chroma, dims=2)
            x = x.clamp(0, 1)
        return IO.NodeOutput(x, ui=save_live_preview(x, str(cls.hidden.unique_id)))


class FisheyeNode(IO.ComfyNode):
    @classmethod
    def define_schema(cls):
        return IO.Schema(
            node_id="Fisheye",
            display_name="Fisheye",
            description="Strong barrel distortion for a fisheye-lens look.",
            category="image/distortion",
            inputs=[
                IO.Image.Input("image"),
                IO.Float.Input("amount", default=0.6, min=0.0, max=1.5, step=0.01),
            ],
            outputs=[IO.Image.Output(display_name="image")],
            hidden=[IO.Hidden.unique_id],
            is_output_node=True,
        )

    @classmethod
    def execute(cls, image, amount) -> IO.NodeOutput:
        if amount <= 0:
            x = image.clamp(0, 1)
        else:
            t = image.permute(0, 3, 1, 2)
            xx, yy = _grid(t.shape, t.device, t.dtype)
            r = torch.sqrt(xx * xx + yy * yy).clamp(1e-6)
            # Fisheye projection: r' = tan(r * amount) / tan(amount), normalized
            new_r = torch.tan(r * amount) / max(1e-6, math.tan(amount))
            scale = new_r / r
            gx, gy = xx * scale, yy * scale
            t = _sample(t, gx, gy, pad="zeros")
            x = t.permute(0, 2, 3, 1).clamp(0, 1)
        return IO.NodeOutput(x, ui=save_live_preview(x, str(cls.hidden.unique_id)))


class DistortionExtension(ComfyExtension):
    @override
    async def get_node_list(self) -> list[type[IO.ComfyNode]]:
        return [KaleidoscopeNode, PolarCoordsNode, GlitchNode, FisheyeNode]


async def comfy_entrypoint() -> DistortionExtension:
    return DistortionExtension()
