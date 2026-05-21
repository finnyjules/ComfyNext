from __future__ import annotations

import math

import torch
import torch.nn.functional as F
from typing_extensions import override

from comfy_api.latest import ComfyExtension, IO
from comfy_extras._live_preview import save_live_preview


def _smoothstep(t):
    return t * t * (3.0 - 2.0 * t)


def _perlin_layer(h, w, scale, seed, device, dtype):
    """Single octave of value-noise via smooth-interpolated random grid."""
    g = torch.Generator(device=device).manual_seed(int(seed) & 0x7fffffff)
    # Random values at grid corners
    gw = max(2, int(w / scale) + 1)
    gh = max(2, int(h / scale) + 1)
    rand_grid = torch.rand(1, 1, gh, gw, device=device, dtype=dtype, generator=g)
    # Bicubic upsample to (h, w) for smooth interpolation
    return F.interpolate(rand_grid, size=(h, w), mode="bicubic", align_corners=False).squeeze(0).squeeze(0)


class PerlinNoiseNode(IO.ComfyNode):
    @classmethod
    def define_schema(cls):
        return IO.Schema(
            node_id="PerlinNoise",
            display_name="Perlin Noise",
            description="Procedural fractal noise texture.",
            category="image/generative",
            inputs=[
                IO.Int.Input("width", default=512, min=64, max=2048, step=8),
                IO.Int.Input("height", default=512, min=64, max=2048, step=8),
                IO.Float.Input("scale", default=80.0, min=4.0, max=512.0, step=1.0),
                IO.Int.Input("octaves", default=4, min=1, max=8, step=1),
                IO.Float.Input("persistence", default=0.5, min=0.1, max=0.9, step=0.05),
                IO.Int.Input("seed", default=1, min=0, max=2 ** 31 - 1, step=1),
            ],
            outputs=[IO.Image.Output(display_name="image")],
            hidden=[IO.Hidden.unique_id],
            is_output_node=True,
        )

    @classmethod
    def execute(cls, width, height, scale, octaves, persistence, seed) -> IO.NodeOutput:
        device = torch.device("cpu")
        dtype = torch.float32
        total = torch.zeros(height, width, device=device, dtype=dtype)
        amp_sum = 0.0
        amp = 1.0
        sc = scale
        for o in range(int(octaves)):
            total = total + amp * _perlin_layer(height, width, sc, seed + o * 17, device, dtype)
            amp_sum += amp
            amp *= persistence
            sc /= 2.0
        total = total / max(1e-6, amp_sum)
        total = total.clamp(0, 1)
        img = total.unsqueeze(0).unsqueeze(-1).expand(1, height, width, 3).contiguous()
        return IO.NodeOutput(img, ui=save_live_preview(img, str(cls.hidden.unique_id)))


class VoronoiNode(IO.ComfyNode):
    @classmethod
    def define_schema(cls):
        return IO.Schema(
            node_id="Voronoi",
            display_name="Voronoi",
            description="Cellular pattern — each pixel takes the nearest random point.",
            category="image/generative",
            inputs=[
                IO.Int.Input("width", default=512, min=64, max=2048, step=8),
                IO.Int.Input("height", default=512, min=64, max=2048, step=8),
                IO.Int.Input("points", default=40, min=4, max=400, step=1),
                IO.Float.Input("edge_width", default=0.02, min=0.0, max=0.2, step=0.005),
                IO.Boolean.Input("colored", default=True),
                IO.Int.Input("seed", default=1, min=0, max=2 ** 31 - 1, step=1),
            ],
            outputs=[IO.Image.Output(display_name="image")],
            hidden=[IO.Hidden.unique_id],
            is_output_node=True,
        )

    @classmethod
    def execute(cls, width, height, points, edge_width, colored, seed) -> IO.NodeOutput:
        device, dtype = torch.device("cpu"), torch.float32
        g = torch.Generator(device=device).manual_seed(int(seed))
        # Generate N random point positions in [0,1] x [0,1]
        sites = torch.rand(int(points), 2, generator=g, device=device, dtype=dtype)
        # For each pixel compute distance to each site (vectorized — keep N small)
        yy, xx = torch.meshgrid(
            torch.linspace(0, 1, height, device=device, dtype=dtype),
            torch.linspace(0, 1, width, device=device, dtype=dtype),
            indexing="ij",
        )
        # [H, W, N] distances
        dy = yy.unsqueeze(-1) - sites[:, 1]
        dx = xx.unsqueeze(-1) - sites[:, 0]
        dist2 = dx * dx + dy * dy
        sorted_d, idx = torch.topk(dist2, k=2, dim=-1, largest=False)
        # Edges: where the difference between the two nearest is small
        edge = ((sorted_d[..., 1].sqrt() - sorted_d[..., 0].sqrt()) < edge_width).to(dtype)
        if colored:
            colors = torch.rand(int(points), 3, generator=g, device=device, dtype=dtype)
            cells = colors[idx[..., 0]]  # [H, W, 3]
            img = (cells * (1.0 - edge.unsqueeze(-1))).clamp(0, 1)
        else:
            mask = 1.0 - edge
            img = mask.unsqueeze(-1).expand(-1, -1, 3)
        img = img.unsqueeze(0).contiguous()
        return IO.NodeOutput(img, ui=save_live_preview(img, str(cls.hidden.unique_id)))


class GradientGeneratorNode(IO.ComfyNode):
    @classmethod
    def define_schema(cls):
        return IO.Schema(
            node_id="GradientGenerator",
            display_name="Gradient",
            description="Generate a linear or radial gradient between two colors.",
            category="image/generative",
            inputs=[
                IO.Int.Input("width", default=512, min=64, max=2048, step=8),
                IO.Int.Input("height", default=512, min=64, max=2048, step=8),
                IO.Combo.Input("type", options=["linear", "radial"], default="linear"),
                IO.Float.Input("angle", default=0.0, min=0.0, max=360.0, step=1.0,
                              tooltip="Direction for linear gradient."),
                IO.Float.Input("start_r", default=0.0, min=0.0, max=1.0, step=0.01),
                IO.Float.Input("start_g", default=0.0, min=0.0, max=1.0, step=0.01),
                IO.Float.Input("start_b", default=0.0, min=0.0, max=1.0, step=0.01),
                IO.Float.Input("end_r", default=1.0, min=0.0, max=1.0, step=0.01),
                IO.Float.Input("end_g", default=1.0, min=0.0, max=1.0, step=0.01),
                IO.Float.Input("end_b", default=1.0, min=0.0, max=1.0, step=0.01),
            ],
            outputs=[IO.Image.Output(display_name="image")],
            hidden=[IO.Hidden.unique_id],
            is_output_node=True,
        )

    @classmethod
    def execute(cls, width, height, type, angle,
                start_r, start_g, start_b, end_r, end_g, end_b) -> IO.NodeOutput:
        device, dtype = torch.device("cpu"), torch.float32
        yy, xx = torch.meshgrid(
            torch.linspace(-1, 1, height, device=device, dtype=dtype),
            torch.linspace(-1, 1, width, device=device, dtype=dtype),
            indexing="ij",
        )
        if type == "radial":
            t = torch.sqrt(xx * xx + yy * yy).clamp(0, 1)
        else:
            rad = math.radians(angle)
            t = (xx * math.cos(rad) + yy * math.sin(rad)) * 0.5 + 0.5
            t = t.clamp(0, 1)
        c0 = torch.tensor([start_r, start_g, start_b], dtype=dtype)
        c1 = torch.tensor([end_r, end_g, end_b], dtype=dtype)
        img = c0 + (c1 - c0) * t.unsqueeze(-1)
        img = img.unsqueeze(0).clamp(0, 1).contiguous()
        return IO.NodeOutput(img, ui=save_live_preview(img, str(cls.hidden.unique_id)))


class GenerativeExtension(ComfyExtension):
    @override
    async def get_node_list(self) -> list[type[IO.ComfyNode]]:
        return [PerlinNoiseNode, VoronoiNode, GradientGeneratorNode]


async def comfy_entrypoint() -> GenerativeExtension:
    return GenerativeExtension()
