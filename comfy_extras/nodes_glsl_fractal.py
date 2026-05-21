from __future__ import annotations

import torch
import torch.nn.functional as F
from typing_extensions import override

from comfy_api.latest import ComfyExtension, IO
from comfy_extras._live_preview import save_live_preview


# 5-point laplacian via conv2d (used by reaction-diffusion).
_LAPLACIAN = torch.tensor(
    [[0., 1., 0.], [1., -4., 1.], [0., 1., 0.]], dtype=torch.float32
).view(1, 1, 3, 3)


class ReactionDiffusionNode(IO.ComfyNode):
    """Gray-Scott reaction-diffusion — grows biological-looking patterns."""
    @classmethod
    def define_schema(cls):
        return IO.Schema(
            node_id="ReactionDiffusion",
            display_name="Reaction-Diffusion",
            description="Grow Gray-Scott patterns: spots, stripes, coral.",
            category="image/generative",
            inputs=[
                IO.Int.Input("width", default=256, min=64, max=1024, step=8),
                IO.Int.Input("height", default=256, min=64, max=1024, step=8),
                IO.Float.Input("feed", default=0.040, min=0.005, max=0.1, step=0.001,
                              tooltip="Feed rate. Combined with kill, this picks the family of pattern."),
                IO.Float.Input("kill", default=0.060, min=0.030, max=0.080, step=0.001),
                IO.Int.Input("iterations", default=600, min=50, max=3000, step=10),
                IO.Int.Input("seed", default=1, min=0, max=2 ** 31 - 1, step=1),
            ],
            outputs=[IO.Image.Output(display_name="image")],
            hidden=[IO.Hidden.unique_id],
            is_output_node=True,
        )

    @classmethod
    def execute(cls, width, height, feed, kill, iterations, seed) -> IO.NodeOutput:
        device = torch.device("cpu")
        dtype = torch.float32
        h, w = int(height), int(width)
        # Initialize: u=1 everywhere, v=0, then seed a noisy patch in the center.
        u = torch.ones(1, 1, h, w, device=device, dtype=dtype)
        v = torch.zeros(1, 1, h, w, device=device, dtype=dtype)
        g = torch.Generator(device=device).manual_seed(int(seed))
        pw = max(8, min(h, w) // 8)
        cy, cx = h // 2, w // 2
        # Random nucleation patch.
        v[..., cy - pw:cy + pw, cx - pw:cx + pw] = torch.rand(
            1, 1, pw * 2, pw * 2, device=device, dtype=dtype, generator=g
        )
        u[..., cy - pw:cy + pw, cx - pw:cx + pw] = 1.0 - v[..., cy - pw:cy + pw, cx - pw:cx + pw]

        lap_kernel = _LAPLACIAN.to(device, dtype)
        du, dv = 1.0, 0.5  # diffusion rates
        dt = 1.0

        for _ in range(int(iterations)):
            lap_u = F.conv2d(F.pad(u, [1, 1, 1, 1], mode="reflect"), lap_kernel)
            lap_v = F.conv2d(F.pad(v, [1, 1, 1, 1], mode="reflect"), lap_kernel)
            reaction = u * v * v
            u = u + dt * (du * lap_u - reaction + feed * (1.0 - u))
            v = v + dt * (dv * lap_v + reaction - (feed + kill) * v)
            u = u.clamp(0.0, 1.0)
            v = v.clamp(0.0, 1.0)

        out = v.squeeze(0).squeeze(0)
        img = out.unsqueeze(0).unsqueeze(-1).expand(1, h, w, 3).contiguous()
        return IO.NodeOutput(img, ui=save_live_preview(img, str(cls.hidden.unique_id)))


class FractalNode(IO.ComfyNode):
    """Mandelbrot or Julia set, with color-mapped escape time."""
    @classmethod
    def define_schema(cls):
        return IO.Schema(
            node_id="Fractal",
            display_name="Fractal",
            description="Mandelbrot or Julia set with zoom and palette.",
            category="image/generative",
            inputs=[
                IO.Combo.Input("type", options=["mandelbrot", "julia"], default="mandelbrot"),
                IO.Int.Input("width", default=512, min=64, max=2048, step=8),
                IO.Int.Input("height", default=512, min=64, max=2048, step=8),
                IO.Float.Input("center_x", default=-0.5, min=-2.0, max=2.0, step=0.001),
                IO.Float.Input("center_y", default=0.0, min=-2.0, max=2.0, step=0.001),
                IO.Float.Input("zoom", default=1.0, min=0.5, max=10000.0, step=0.1),
                IO.Float.Input("julia_cx", default=-0.7, min=-1.5, max=1.5, step=0.001),
                IO.Float.Input("julia_cy", default=0.27015, min=-1.5, max=1.5, step=0.001),
                IO.Int.Input("max_iter", default=128, min=16, max=512, step=8),
                IO.Float.Input("palette_r", default=0.5, min=0.0, max=1.0, step=0.01),
                IO.Float.Input("palette_g", default=0.7, min=0.0, max=1.0, step=0.01),
                IO.Float.Input("palette_b", default=1.0, min=0.0, max=1.0, step=0.01),
            ],
            outputs=[IO.Image.Output(display_name="image")],
            hidden=[IO.Hidden.unique_id],
            is_output_node=True,
        )

    @classmethod
    def execute(cls, type, width, height, center_x, center_y, zoom,
                julia_cx, julia_cy, max_iter,
                palette_r, palette_g, palette_b) -> IO.NodeOutput:
        device = torch.device("cpu")
        dtype = torch.float32
        h, w = int(height), int(width)
        # Viewport: default ~[-2, 2] in x, scaled by zoom.
        scale = 4.0 / max(zoom, 1e-3)
        aspect = w / max(1, h)
        xs = torch.linspace(center_x - scale * aspect / 2, center_x + scale * aspect / 2, w, dtype=dtype)
        ys = torch.linspace(center_y - scale / 2, center_y + scale / 2, h, dtype=dtype)
        yy, xx = torch.meshgrid(ys, xs, indexing="ij")
        if type == "julia":
            z_re, z_im = xx.clone(), yy.clone()
            c_re = torch.full_like(z_re, julia_cx)
            c_im = torch.full_like(z_im, julia_cy)
        else:
            z_re = torch.zeros_like(xx)
            z_im = torch.zeros_like(yy)
            c_re, c_im = xx, yy

        escape = torch.zeros(h, w, dtype=dtype)
        alive = torch.ones(h, w, dtype=torch.bool)

        for i in range(int(max_iter)):
            zr2 = z_re * z_re - z_im * z_im
            z_im_new = 2.0 * z_re * z_im + c_im
            z_re = (zr2 + c_re) * alive.to(dtype) + z_re * (~alive).to(dtype)
            z_im = z_im_new * alive.to(dtype) + z_im * (~alive).to(dtype)
            mag2 = z_re * z_re + z_im * z_im
            just_escaped = alive & (mag2 > 4.0)
            escape = torch.where(just_escaped, torch.full_like(escape, float(i)), escape)
            alive = alive & (mag2 <= 4.0)
            if not alive.any():
                break

        # Normalize escape iterations; interior stays at 0.
        norm = (escape / max_iter).clamp(0.0, 1.0)
        # Map through a hue-style palette using sin curves.
        t = norm * 6.28318
        r = (torch.sin(t * palette_r + 0.0) * 0.5 + 0.5)
        gc = (torch.sin(t * palette_g + 2.094) * 0.5 + 0.5)
        bc = (torch.sin(t * palette_b + 4.188) * 0.5 + 0.5)
        # Interior pixels (escape == 0) get black.
        interior = (escape == 0).to(dtype).unsqueeze(-1)
        rgb = torch.stack([r, gc, bc], dim=-1) * (1.0 - interior)
        img = rgb.unsqueeze(0).clamp(0, 1).contiguous()
        return IO.NodeOutput(img, ui=save_live_preview(img, str(cls.hidden.unique_id)))


class FractalExtension(ComfyExtension):
    @override
    async def get_node_list(self) -> list[type[IO.ComfyNode]]:
        return [ReactionDiffusionNode, FractalNode]


async def comfy_entrypoint() -> FractalExtension:
    return FractalExtension()
