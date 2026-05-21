from __future__ import annotations

from math import ceil, cos, sin, radians

import torch
import torch.nn.functional as F
from typing_extensions import override
from torchvision.transforms.functional import gaussian_blur

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


def _sample(t, gx, gy):
    grid = torch.stack([gx, gy], dim=-1).unsqueeze(0).expand(t.shape[0], -1, -1, -1)
    return F.grid_sample(t, grid, mode="bilinear", padding_mode="border", align_corners=False)


class ChromaticAberrationNode(IO.ComfyNode):
    @classmethod
    def define_schema(cls):
        return IO.Schema(
            node_id="ChromaticAberration",
            display_name="Chromatic Aberration",
            description="Offset color channels radially, simulating lens fringing.",
            category="image/lens",
            inputs=[
                IO.Image.Input("image"),
                IO.Float.Input("amount", default=0.01, min=0.0, max=0.05, step=0.001),
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
            scales = [(1.0 - amount), 1.0, (1.0 + amount)]
            chans = []
            for i, s in enumerate(scales):
                gx, gy = xx * s, yy * s
                sampled = _sample(t[:, i:i + 1], gx, gy)
                chans.append(sampled)
            t = torch.cat(chans, dim=1)
            x = t.permute(0, 2, 3, 1).clamp(0, 1)
        return IO.NodeOutput(x, ui=save_live_preview(x, str(cls.hidden.unique_id)))


class HalftoneNode(IO.ComfyNode):
    @classmethod
    def define_schema(cls):
        return IO.Schema(
            node_id="Halftone",
            display_name="Halftone",
            description="Newspaper-print dot pattern.",
            category="image/lens",
            inputs=[
                IO.Image.Input("image"),
                IO.Int.Input("cell_size", default=8, min=2, max=48, step=1),
                IO.Float.Input("angle", default=15.0, min=0.0, max=90.0, step=1.0),
            ],
            outputs=[IO.Image.Output(display_name="image")],
            hidden=[IO.Hidden.unique_id],
            is_output_node=True,
        )

    @classmethod
    def execute(cls, image, cell_size, angle) -> IO.NodeOutput:
        b, h, w, c = image.shape
        device, dtype = image.device, image.dtype
        rad = radians(angle)
        cos_a, sin_a = cos(rad), sin(rad)
        yy, xx = torch.meshgrid(
            torch.arange(h, device=device, dtype=dtype),
            torch.arange(w, device=device, dtype=dtype),
            indexing="ij",
        )
        # Rotate coords, then take fractional within cell
        rx = xx * cos_a + yy * sin_a
        ry = -xx * sin_a + yy * cos_a
        u = (rx % cell_size) - cell_size / 2.0
        v = (ry % cell_size) - cell_size / 2.0
        d = torch.sqrt(u * u + v * v)  # distance from cell center
        # Average luma in each cell — approximate via blur
        luma = (0.2126 * image[..., 0] + 0.7152 * image[..., 1] + 0.0722 * image[..., 2])
        avg = F.avg_pool2d(luma.unsqueeze(1), kernel_size=cell_size, stride=1, padding=cell_size // 2)
        avg = F.interpolate(avg, size=(h, w), mode="nearest")[:, 0]
        # Dot radius scales with darkness (more ink for darker)
        max_r = cell_size * 0.55
        target_r = (1.0 - avg) * max_r
        mask = (d.unsqueeze(0) < target_r).to(dtype)  # 1 inside dot, 0 outside
        # Dots are dark on white
        x = (1.0 - mask).unsqueeze(-1).expand(-1, -1, -1, c).clamp(0, 1)
        return IO.NodeOutput(x, ui=save_live_preview(x, str(cls.hidden.unique_id)))


class CRTNode(IO.ComfyNode):
    @classmethod
    def define_schema(cls):
        return IO.Schema(
            node_id="CRT",
            display_name="CRT / VHS",
            description="Scanlines, RGB stripe mask, chromatic offset, and slight barrel.",
            category="image/lens",
            inputs=[
                IO.Image.Input("image"),
                IO.Float.Input("scanlines", default=0.3, min=0.0, max=1.0, step=0.01),
                IO.Float.Input("rgb_mask", default=0.2, min=0.0, max=1.0, step=0.01),
                IO.Float.Input("chroma", default=0.005, min=0.0, max=0.02, step=0.001),
                IO.Float.Input("curvature", default=0.05, min=0.0, max=0.2, step=0.01),
            ],
            outputs=[IO.Image.Output(display_name="image")],
            hidden=[IO.Hidden.unique_id],
            is_output_node=True,
        )

    @classmethod
    def execute(cls, image, scanlines, rgb_mask, chroma, curvature) -> IO.NodeOutput:
        t = image.permute(0, 3, 1, 2)
        # Barrel curvature
        if curvature > 0:
            xx, yy = _grid(t.shape, t.device, t.dtype)
            r2 = xx * xx + yy * yy
            f = 1.0 + curvature * r2
            t = _sample(t, xx * f, yy * f)
        # Chromatic offset
        if chroma > 0:
            xx, yy = _grid(t.shape, t.device, t.dtype)
            scales = [(1.0 - chroma), 1.0, (1.0 + chroma)]
            chans = []
            for i, s in enumerate(scales):
                chans.append(_sample(t[:, i:i + 1], xx * s, yy * s))
            t = torch.cat(chans, dim=1)
        b, c, h, w = t.shape
        device, dtype = t.device, t.dtype
        # Scanlines
        if scanlines > 0:
            line = (torch.sin(torch.arange(h, device=device, dtype=dtype) * 3.14159).abs())
            line = (1.0 - scanlines * line).view(1, 1, h, 1)
            t = t * line
        # RGB stripe mask
        if rgb_mask > 0:
            col_idx = torch.arange(w, device=device) % 3
            stripe = torch.zeros(3, w, device=device, dtype=dtype)
            stripe[0, col_idx == 0] = 1.0
            stripe[1, col_idx == 1] = 1.0
            stripe[2, col_idx == 2] = 1.0
            stripe = stripe.view(1, 3, 1, w).expand(b, 3, h, w)
            t = t * (1.0 - rgb_mask) + (t * stripe * 3.0) * rgb_mask
        x = t.permute(0, 2, 3, 1).clamp(0, 1)
        return IO.NodeOutput(x, ui=save_live_preview(x, str(cls.hidden.unique_id)))


class BokehNode(IO.ComfyNode):
    @classmethod
    def define_schema(cls):
        return IO.Schema(
            node_id="Bokeh",
            display_name="Bokeh",
            description="Disk-kernel defocus blur — highlights bloom as soft circles.",
            category="image/lens",
            inputs=[
                IO.Image.Input("image"),
                IO.Float.Input("radius", default=5.0, min=0.0, max=30.0, step=0.5),
                IO.Float.Input("highlight_boost", default=1.5, min=1.0, max=4.0, step=0.05,
                              tooltip="Brighter highlights pop more as bokeh circles."),
            ],
            outputs=[IO.Image.Output(display_name="image")],
            hidden=[IO.Hidden.unique_id],
            is_output_node=True,
        )

    @classmethod
    def execute(cls, image, radius, highlight_boost) -> IO.NodeOutput:
        if radius <= 0:
            x = image.clamp(0, 1)
        else:
            t = image.permute(0, 3, 1, 2)
            # Downsample for large radii to keep cost bounded.
            scale = max(1, int(radius / 5))
            _, _, h, w = t.shape
            small = F.interpolate(t, scale_factor=1.0 / scale, mode="area") if scale > 1 else t
            r = radius / scale
            # Build a disk kernel
            k = int(2 * ceil(r) + 1)
            yy, xx = torch.meshgrid(
                torch.arange(k, device=t.device, dtype=t.dtype) - k // 2,
                torch.arange(k, device=t.device, dtype=t.dtype) - k // 2,
                indexing="ij",
            )
            disk = (torch.sqrt(xx * xx + yy * yy) <= r).to(t.dtype)
            disk = disk / disk.sum()
            kernel = disk.view(1, 1, k, k).expand(small.shape[1], 1, k, k).contiguous()
            # Boost highlights before blur, gamma-decompress after
            small_boosted = small.pow(highlight_boost)
            padded = F.pad(small_boosted, [k // 2] * 4, mode="reflect")
            blurred = F.conv2d(padded, kernel, groups=small.shape[1])
            blurred = blurred.clamp(min=0).pow(1.0 / highlight_boost)
            if scale > 1:
                blurred = F.interpolate(blurred, size=(h, w), mode="bilinear", align_corners=False)
            x = blurred.permute(0, 2, 3, 1).clamp(0, 1)
        return IO.NodeOutput(x, ui=save_live_preview(x, str(cls.hidden.unique_id)))


class LensExtension(ComfyExtension):
    @override
    async def get_node_list(self) -> list[type[IO.ComfyNode]]:
        return [ChromaticAberrationNode, HalftoneNode, CRTNode, BokehNode]


async def comfy_entrypoint() -> LensExtension:
    return LensExtension()
