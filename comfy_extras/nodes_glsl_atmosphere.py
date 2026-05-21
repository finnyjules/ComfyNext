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


class GodRaysNode(IO.ComfyNode):
    @classmethod
    def define_schema(cls):
        return IO.Schema(
            node_id="GodRays",
            display_name="God Rays",
            description="Radial light streaks from a center point through bright pixels.",
            category="image/atmosphere",
            inputs=[
                IO.Image.Input("image"),
                IO.Float.Input("threshold", default=0.75, min=0.0, max=1.0, step=0.01),
                IO.Float.Input("intensity", default=0.6, min=0.0, max=2.0, step=0.05),
                IO.Float.Input("center_x", default=0.5, min=0.0, max=1.0, step=0.01),
                IO.Float.Input("center_y", default=0.3, min=0.0, max=1.0, step=0.01),
                IO.Int.Input("samples", default=24, min=4, max=80, step=1),
            ],
            outputs=[IO.Image.Output(display_name="image")],
            hidden=[IO.Hidden.unique_id],
            is_output_node=True,
        )

    @classmethod
    def execute(cls, image, threshold, intensity, center_x, center_y, samples) -> IO.NodeOutput:
        if intensity <= 0:
            x = image.clamp(0, 1)
        else:
            t = image.permute(0, 3, 1, 2)
            # Threshold luma
            luma = 0.2126 * t[:, 0:1] + 0.7152 * t[:, 1:2] + 0.0722 * t[:, 2:3]
            bright = (t * (luma > threshold).to(t.dtype))
            xx, yy = _grid(t.shape, t.device, t.dtype)
            # Vector from each pixel toward the light center
            cx = center_x * 2.0 - 1.0
            cy = center_y * 2.0 - 1.0
            dx = cx - xx
            dy = cy - yy
            # Accumulate `samples` taps along that direction
            accum = torch.zeros_like(bright)
            step = 1.0 / samples
            decay = 1.0
            decay_step = 0.92
            for s in range(int(samples)):
                f = s * step
                gx = xx + dx * f * 0.5
                gy = yy + dy * f * 0.5
                grid = torch.stack([gx, gy], dim=-1).unsqueeze(0).expand(t.shape[0], -1, -1, -1)
                accum = accum + F.grid_sample(bright, grid, mode="bilinear", padding_mode="zeros", align_corners=False) * decay
                decay *= decay_step
            accum = accum / samples
            x = (t + intensity * accum).clamp(0, 1)
            x = x.permute(0, 2, 3, 1)
        return IO.NodeOutput(x, ui=save_live_preview(x, str(cls.hidden.unique_id)))


class LightLeakNode(IO.ComfyNode):
    @classmethod
    def define_schema(cls):
        return IO.Schema(
            node_id="LightLeak",
            display_name="Light Leak",
            description="Colored gradient overlay simulating film light leaks.",
            category="image/atmosphere",
            inputs=[
                IO.Image.Input("image"),
                IO.Float.Input("angle", default=30.0, min=0.0, max=360.0, step=1.0),
                IO.Float.Input("position", default=0.7, min=0.0, max=1.0, step=0.01),
                IO.Float.Input("softness", default=0.5, min=0.05, max=1.0, step=0.01),
                IO.Float.Input("intensity", default=0.6, min=0.0, max=1.0, step=0.01),
                IO.Float.Input("color_r", default=1.0,  min=0.0, max=1.0, step=0.01),
                IO.Float.Input("color_g", default=0.6,  min=0.0, max=1.0, step=0.01),
                IO.Float.Input("color_b", default=0.25, min=0.0, max=1.0, step=0.01),
            ],
            outputs=[IO.Image.Output(display_name="image")],
            hidden=[IO.Hidden.unique_id],
            is_output_node=True,
        )

    @classmethod
    def execute(cls, image, angle, position, softness, intensity,
                color_r, color_g, color_b) -> IO.NodeOutput:
        b, h, w, _ = image.shape
        device, dtype = image.device, image.dtype
        yy, xx = torch.meshgrid(
            torch.linspace(-1, 1, h, device=device, dtype=dtype),
            torch.linspace(-1, 1, w, device=device, dtype=dtype),
            indexing="ij",
        )
        rad = radians(angle)
        # Directional gradient with soft band centered at `position` along the axis
        t = xx * cos(rad) + yy * sin(rad)  # [-1, 1]
        t01 = (t + 1.0) * 0.5
        band = torch.exp(-((t01 - position) ** 2) / (2.0 * softness * softness))
        leak = band.unsqueeze(0).unsqueeze(-1) * intensity
        color = torch.tensor([color_r, color_g, color_b], device=device, dtype=dtype).view(1, 1, 1, 3)
        # Screen blend
        x = 1.0 - (1.0 - image) * (1.0 - color * leak)
        x = x.clamp(0, 1)
        return IO.NodeOutput(x, ui=save_live_preview(x, str(cls.hidden.unique_id)))


class FilmGrainNode(IO.ComfyNode):
    @classmethod
    def define_schema(cls):
        return IO.Schema(
            node_id="FilmGrain",
            display_name="Film Grain",
            description="Anisotropic noise that peaks in the midtones, like analog film.",
            category="image/atmosphere",
            inputs=[
                IO.Image.Input("image"),
                IO.Float.Input("amount", default=0.15, min=0.0, max=1.0, step=0.01),
                IO.Float.Input("size", default=1.0, min=0.5, max=4.0, step=0.05,
                              tooltip="Grain size in pixels (>1 = larger clumps)."),
                IO.Int.Input("seed", default=1, min=0, max=2 ** 31 - 1, step=1),
            ],
            outputs=[IO.Image.Output(display_name="image")],
            hidden=[IO.Hidden.unique_id],
            is_output_node=True,
        )

    @classmethod
    def execute(cls, image, amount, size, seed) -> IO.NodeOutput:
        if amount <= 0:
            x = image.clamp(0, 1)
        else:
            b, h, w, c = image.shape
            device, dtype = image.device, image.dtype
            g = torch.Generator(device=device).manual_seed(int(seed))
            # Generate at lower res for larger grain, then upsample.
            gh, gw = max(2, int(h / size)), max(2, int(w / size))
            noise = torch.randn(1, 1, gh, gw, device=device, dtype=dtype, generator=g)
            if size > 1:
                noise = F.interpolate(noise, size=(h, w), mode="bilinear", align_corners=False)
            noise = noise.squeeze(0).squeeze(0)
            # Midtone-weighted (peaks at luma=0.5)
            luma = 0.2126 * image[..., 0] + 0.7152 * image[..., 1] + 0.0722 * image[..., 2]
            weight = (4.0 * luma * (1.0 - luma)).clamp(0, 1)
            grain = noise.unsqueeze(0) * weight * amount * 0.5
            x = (image + grain.unsqueeze(-1)).clamp(0, 1)
        return IO.NodeOutput(x, ui=save_live_preview(x, str(cls.hidden.unique_id)))


class LensFlareNode(IO.ComfyNode):
    @classmethod
    def define_schema(cls):
        return IO.Schema(
            node_id="LensFlare",
            display_name="Lens Flare",
            description="Procedural lens flare: halo, anamorphic streak, ghost circles.",
            category="image/atmosphere",
            inputs=[
                IO.Image.Input("image"),
                IO.Float.Input("light_x", default=0.7, min=0.0, max=1.0, step=0.01),
                IO.Float.Input("light_y", default=0.3, min=0.0, max=1.0, step=0.01),
                IO.Float.Input("intensity", default=0.7, min=0.0, max=2.0, step=0.05),
                IO.Float.Input("halo_size", default=0.05, min=0.005, max=0.3, step=0.005),
                IO.Float.Input("streak", default=0.5, min=0.0, max=1.5, step=0.05,
                              tooltip="Horizontal anamorphic streak through the light source."),
                IO.Int.Input("ghosts", default=5, min=0, max=10, step=1,
                            tooltip="Number of secondary ghost flares along the optical axis."),
                IO.Float.Input("color_r", default=1.00, min=0.0, max=1.0, step=0.01),
                IO.Float.Input("color_g", default=0.85, min=0.0, max=1.0, step=0.01),
                IO.Float.Input("color_b", default=0.55, min=0.0, max=1.0, step=0.01),
            ],
            outputs=[IO.Image.Output(display_name="image")],
            hidden=[IO.Hidden.unique_id],
            is_output_node=True,
        )

    @classmethod
    def execute(cls, image, light_x, light_y, intensity, halo_size, streak, ghosts,
                color_r, color_g, color_b) -> IO.NodeOutput:
        if intensity <= 0:
            x = image.clamp(0, 1)
            return IO.NodeOutput(x, ui=save_live_preview(x, str(cls.hidden.unique_id)))

        b, h, w, _ = image.shape
        device, dtype = image.device, image.dtype
        aspect = w / max(1, h)
        yy, xx = torch.meshgrid(
            torch.linspace(0, 1, h, device=device, dtype=dtype),
            torch.linspace(0, 1, w, device=device, dtype=dtype),
            indexing="ij",
        )
        # Aspect-corrected distance from the light source so the halo stays circular.
        adx = (xx - light_x) * aspect
        ady = (yy - light_y)
        d = torch.sqrt(adx * adx + ady * ady)

        # Tight bright halo with a soft falloff.
        halo = torch.exp(-(d / max(1e-4, halo_size)) ** 2)
        # Anamorphic horizontal streak through the light source.
        anam = torch.zeros_like(halo)
        if streak > 0:
            anam = torch.exp(-((yy - light_y) ** 2) / (0.001 / max(streak, 1e-4))) \
                   * torch.exp(-((xx - light_x) ** 2) * 4.0)

        accum = halo + anam * streak

        # Ghost flares along the line through (0.5, 0.5) opposite to the light.
        if ghosts > 0:
            cx, cy = 0.5, 0.5
            for i in range(int(ghosts)):
                t = (i + 1) / (ghosts + 1) * 2.0  # walk from light past center
                gx = light_x + (cx - light_x) * t
                gy = light_y + (cy - light_y) * t
                gdx = (xx - gx) * aspect
                gdy = (yy - gy)
                gd = torch.sqrt(gdx * gdx + gdy * gdy)
                radius = halo_size * (0.6 + 0.5 * ((i * 7) % 5) / 4.0)  # slight size variety
                strength = 0.5 / (i + 1.5)
                accum = accum + torch.exp(-(gd / max(1e-4, radius)) ** 2) * strength

        color = torch.tensor([color_r, color_g, color_b], device=device, dtype=dtype).view(1, 1, 1, 3)
        flare = accum.unsqueeze(0).unsqueeze(-1) * color * intensity
        # Screen-blend on top of the image.
        x = (1.0 - (1.0 - image) * (1.0 - flare.clamp(0, 1))).clamp(0, 1)
        return IO.NodeOutput(x, ui=save_live_preview(x, str(cls.hidden.unique_id)))


class AtmosphereExtension(ComfyExtension):
    @override
    async def get_node_list(self) -> list[type[IO.ComfyNode]]:
        return [GodRaysNode, LightLeakNode, FilmGrainNode, LensFlareNode]


async def comfy_entrypoint() -> AtmosphereExtension:
    return AtmosphereExtension()
