from __future__ import annotations

import math
from math import ceil

import torch
import torch.nn.functional as F
from typing_extensions import override
from torchvision.transforms.functional import gaussian_blur

from comfy_api.latest import ComfyExtension, IO
from comfy_extras._live_preview import save_live_preview


def _luma(x):
    return 0.2126 * x[..., 0] + 0.7152 * x[..., 1] + 0.0722 * x[..., 2]


class TiltShiftNode(IO.ComfyNode):
    @classmethod
    def define_schema(cls):
        return IO.Schema(
            node_id="TiltShift",
            display_name="Tilt-shift",
            description="Sharp horizontal band, heavy blur above and below — miniature look.",
            category="image/lens",
            inputs=[
                IO.Image.Input("image"),
                IO.Float.Input("position", default=0.5, min=0.0, max=1.0, step=0.01,
                              tooltip="Vertical center of the focused band."),
                IO.Float.Input("width", default=0.2, min=0.02, max=0.8, step=0.01,
                              tooltip="Height of the in-focus band."),
                IO.Float.Input("blur", default=10.0, min=1.0, max=40.0, step=0.5,
                              tooltip="Maximum blur radius outside the band."),
            ],
            outputs=[IO.Image.Output(display_name="image")],
            hidden=[IO.Hidden.unique_id],
            is_output_node=True,
        )

    @classmethod
    def execute(cls, image, position, width, blur) -> IO.NodeOutput:
        b, h, w, c = image.shape
        device, dtype = image.device, image.dtype
        # 1 inside the focused band, 0 fully out. Smooth falloff over `width / 2`.
        y = torch.linspace(0.0, 1.0, h, device=device, dtype=dtype)
        d = (y - position).abs()
        falloff = max(1e-4, width * 0.5)
        m = ((width / 2 + falloff - d) / falloff).clamp(0.0, 1.0)
        m = m * m * (3.0 - 2.0 * m)  # smoothstep
        mask = m.view(1, h, 1, 1)

        t = image.permute(0, 3, 1, 2)
        # Blur once at the max radius; mask blends it with the original.
        scale = max(1, int(blur / 4))
        small = F.interpolate(t, scale_factor=1.0 / scale, mode="area") if scale > 1 else t
        sigma = blur / scale
        ksize = 2 * ceil(3.0 * sigma) + 1
        blurred = gaussian_blur(small, kernel_size=ksize, sigma=sigma)
        if scale > 1:
            blurred = F.interpolate(blurred, size=(h, w), mode="bilinear", align_corners=False)
        # mask is [1, H, 1, 1] — broadcast across width.
        out = t * mask.permute(0, 2, 1, 3) + blurred * (1.0 - mask.permute(0, 2, 1, 3))
        out = out.permute(0, 2, 3, 1).clamp(0.0, 1.0)
        return IO.NodeOutput(out, ui=save_live_preview(out, str(cls.hidden.unique_id)))


class FrequencySeparationNode(IO.ComfyNode):
    @classmethod
    def define_schema(cls):
        return IO.Schema(
            node_id="FrequencySeparation",
            display_name="Frequency Separation",
            description="Split image into low (color/tone) and high (texture/detail) frequencies.",
            category="image/filter",
            inputs=[
                IO.Image.Input("image"),
                IO.Float.Input("radius", default=4.0, min=0.5, max=30.0, step=0.5),
                IO.Combo.Input("show", options=["low", "high", "combined"], default="combined",
                              tooltip="Which frequency to output as the preview/output image."),
            ],
            outputs=[
                IO.Image.Output(display_name="low_freq"),
                IO.Image.Output(display_name="high_freq"),
            ],
            hidden=[IO.Hidden.unique_id],
            is_output_node=True,
        )

    @classmethod
    def execute(cls, image, radius, show) -> IO.NodeOutput:
        t = image.permute(0, 3, 1, 2)
        ksize = 2 * ceil(3.0 * radius) + 1
        low_t = gaussian_blur(t, kernel_size=ksize, sigma=radius)
        low = low_t.permute(0, 2, 3, 1).clamp(0.0, 1.0)
        high = (image - low + 0.5).clamp(0.0, 1.0)
        if show == "low":
            preview = low
        elif show == "high":
            preview = high
        else:
            # Side-by-side combined preview.
            preview = torch.cat([low, high], dim=2).clamp(0.0, 1.0)
        return IO.NodeOutput(low, high, ui=save_live_preview(preview, str(cls.hidden.unique_id)))


class PaletteQuantizeNode(IO.ComfyNode):
    @classmethod
    def define_schema(cls):
        return IO.Schema(
            node_id="PaletteQuantize",
            display_name="Palette Quantize",
            description="Reduce the image to N colors via k-means clustering.",
            category="image/color",
            inputs=[
                IO.Image.Input("image"),
                IO.Int.Input("colors", default=8, min=2, max=32, step=1),
                IO.Int.Input("iterations", default=6, min=1, max=20, step=1,
                            tooltip="K-means refinement passes."),
                IO.Int.Input("seed", default=1, min=0, max=2 ** 31 - 1, step=1),
            ],
            outputs=[IO.Image.Output(display_name="image")],
            hidden=[IO.Hidden.unique_id],
            is_output_node=True,
        )

    @classmethod
    def execute(cls, image, colors, iterations, seed) -> IO.NodeOutput:
        b, h, w, c = image.shape
        device, dtype = image.device, image.dtype
        k = max(2, int(colors))

        # Cluster on a downsampled copy for speed (k-means is O(N*K) per iter).
        t = image.permute(0, 3, 1, 2)
        sample_size = min(96, h, w)
        small = F.interpolate(t, size=(sample_size, sample_size), mode="area")
        sample = small.permute(0, 2, 3, 1).reshape(-1, c)

        g = torch.Generator(device=device).manual_seed(int(seed))
        # Initialize centroids by picking k random sample pixels.
        idx = torch.randperm(sample.shape[0], generator=g, device=device)[:k]
        centers = sample[idx].clone()

        for _ in range(int(iterations)):
            # Assign each sample to the nearest centroid (chunked to avoid OOM).
            d2 = ((sample.unsqueeze(1) - centers.unsqueeze(0)) ** 2).sum(dim=-1)
            labels = d2.argmin(dim=1)
            new_centers = centers.clone()
            for ci in range(k):
                mask = labels == ci
                if mask.any():
                    new_centers[ci] = sample[mask].mean(dim=0)
            centers = new_centers

        # Snap every pixel of the original (full-res) image to its nearest centroid.
        pixels = image.reshape(-1, c)
        chunk = 65536
        out_chunks = []
        for i in range(0, pixels.shape[0], chunk):
            seg = pixels[i:i + chunk]
            d2 = ((seg.unsqueeze(1) - centers.unsqueeze(0)) ** 2).sum(dim=-1)
            labels = d2.argmin(dim=1)
            out_chunks.append(centers[labels])
        out = torch.cat(out_chunks, dim=0).reshape(b, h, w, c).clamp(0.0, 1.0)
        return IO.NodeOutput(out, ui=save_live_preview(out, str(cls.hidden.unique_id)))


class HeightmapReliefNode(IO.ComfyNode):
    @classmethod
    def define_schema(cls):
        return IO.Schema(
            node_id="HeightmapRelief",
            display_name="Relief Lighting",
            description="Light the image as if its luma were a heightmap.",
            category="image/stylize",
            inputs=[
                IO.Image.Input("image"),
                IO.Float.Input("angle", default=135.0, min=0.0, max=360.0, step=1.0,
                              tooltip="Light direction in degrees (0 = right, 90 = up)."),
                IO.Float.Input("elevation", default=0.4, min=0.05, max=1.0, step=0.01,
                              tooltip="Light elevation from horizon (0=grazing, 1=overhead)."),
                IO.Float.Input("depth", default=3.0, min=0.1, max=10.0, step=0.1,
                              tooltip="How tall the heightmap is."),
                IO.Float.Input("ambient", default=0.3, min=0.0, max=1.0, step=0.01),
                IO.Boolean.Input("keep_color", default=True,
                                tooltip="Modulate the source color (off = pure shaded gray)."),
            ],
            outputs=[IO.Image.Output(display_name="image")],
            hidden=[IO.Hidden.unique_id],
            is_output_node=True,
        )

    @classmethod
    def execute(cls, image, angle, elevation, depth, ambient, keep_color) -> IO.NodeOutput:
        luma = _luma(image)  # [B, H, W]
        # Sobel gradient
        device, dtype = image.device, image.dtype
        sx = torch.tensor([[-1., 0., 1.], [-2., 0., 2.], [-1., 0., 1.]], device=device, dtype=dtype).view(1, 1, 3, 3)
        sy = torch.tensor([[-1., -2., -1.], [0., 0., 0.], [1., 2., 1.]], device=device, dtype=dtype).view(1, 1, 3, 3)
        l4 = luma.unsqueeze(1)
        padded = F.pad(l4, [1, 1, 1, 1], mode="reflect")
        gx = F.conv2d(padded, sx).squeeze(1) * depth
        gy = F.conv2d(padded, sy).squeeze(1) * depth
        # Surface normal: (-gx, -gy, 1) normalized
        nx = -gx
        ny = -gy
        nz = torch.ones_like(nx)
        norm = torch.sqrt(nx * nx + ny * ny + nz * nz).clamp(min=1e-6)
        nx, ny, nz = nx / norm, ny / norm, nz / norm
        # Light direction
        rad = math.radians(angle)
        elev_rad = elevation * (math.pi / 2)
        lx = math.cos(rad) * math.cos(elev_rad)
        ly = math.sin(rad) * math.cos(elev_rad)
        lz = math.sin(elev_rad)
        shade = (nx * lx + ny * ly + nz * lz).clamp(min=0.0)
        intensity = (ambient + (1.0 - ambient) * shade).clamp(0.0, 1.0).unsqueeze(-1)
        if keep_color:
            out = (image * intensity).clamp(0.0, 1.0)
        else:
            out = intensity.expand(-1, -1, -1, 3).clamp(0.0, 1.0)
        return IO.NodeOutput(out, ui=save_live_preview(out, str(cls.hidden.unique_id)))


class CausticsNode(IO.ComfyNode):
    @classmethod
    def define_schema(cls):
        return IO.Schema(
            node_id="Caustics",
            display_name="Caustics",
            description="Water-surface light dappling, screen-blended over the image.",
            category="image/atmosphere",
            inputs=[
                IO.Image.Input("image"),
                IO.Float.Input("scale", default=6.0, min=1.0, max=30.0, step=0.5,
                              tooltip="Pattern frequency."),
                IO.Float.Input("intensity", default=0.5, min=0.0, max=1.5, step=0.05),
                IO.Float.Input("color_r", default=0.6, min=0.0, max=1.0, step=0.01),
                IO.Float.Input("color_g", default=0.85, min=0.0, max=1.0, step=0.01),
                IO.Float.Input("color_b", default=1.0,  min=0.0, max=1.0, step=0.01),
                IO.Int.Input("seed", default=1, min=0, max=2 ** 31 - 1, step=1),
            ],
            outputs=[IO.Image.Output(display_name="image")],
            hidden=[IO.Hidden.unique_id],
            is_output_node=True,
        )

    @classmethod
    def execute(cls, image, scale, intensity, color_r, color_g, color_b, seed) -> IO.NodeOutput:
        b, h, w, _ = image.shape
        device, dtype = image.device, image.dtype
        yy, xx = torch.meshgrid(
            torch.linspace(0.0, 1.0, h, device=device, dtype=dtype),
            torch.linspace(0.0, 1.0, w, device=device, dtype=dtype),
            indexing="ij",
        )
        # Phase offset from seed so results vary deterministically.
        phi = (seed % 1000) * 0.073
        # Superpose a few sine layers at increasing frequencies and slight angles.
        c = torch.zeros_like(xx)
        for i in range(5):
            freq = scale * (1.0 + i * 0.6)
            ang = phi + i * 0.81
            kx = math.cos(ang) * freq
            ky = math.sin(ang) * freq
            c = c + torch.sin(kx * xx + ky * yy + phi * (i + 1))
        # Sharpen highlights — caustics are mostly bright streaks.
        caustic = (c * 0.2).abs().pow(2.5).clamp(0.0, 1.0)
        color = torch.tensor([color_r, color_g, color_b], device=device, dtype=dtype).view(1, 1, 1, 3)
        flare = caustic.unsqueeze(0).unsqueeze(-1) * color * intensity
        # Screen blend over the image.
        out = (1.0 - (1.0 - image) * (1.0 - flare.clamp(0, 1))).clamp(0.0, 1.0)
        return IO.NodeOutput(out, ui=save_live_preview(out, str(cls.hidden.unique_id)))


class BlindsNode(IO.ComfyNode):
    @classmethod
    def define_schema(cls):
        return IO.Schema(
            node_id="Blinds",
            display_name="Blinds",
            description="Venetian blinds — image visible through slats, dark between.",
            category="image/lens",
            inputs=[
                IO.Image.Input("image"),
                IO.Int.Input("count", default=16, min=2, max=80, step=1,
                            tooltip="Number of slats."),
                IO.Float.Input("openness", default=0.5, min=0.05, max=0.95, step=0.01,
                              tooltip="Fraction of each slat that's open."),
                IO.Float.Input("shadow", default=0.85, min=0.0, max=1.0, step=0.01,
                              tooltip="How dark the closed sections are."),
                IO.Float.Input("softness", default=0.05, min=0.0, max=0.3, step=0.01,
                              tooltip="Edge softness between slat and shadow."),
                IO.Float.Input("angle", default=0.0, min=0.0, max=180.0, step=1.0,
                              tooltip="Slat direction (0 = horizontal, 90 = vertical)."),
            ],
            outputs=[IO.Image.Output(display_name="image")],
            hidden=[IO.Hidden.unique_id],
            is_output_node=True,
        )

    @classmethod
    def execute(cls, image, count, openness, shadow, softness, angle) -> IO.NodeOutput:
        b, h, w, _ = image.shape
        device, dtype = image.device, image.dtype
        # Build coord along the slat-perpendicular axis.
        yy, xx = torch.meshgrid(
            torch.linspace(0.0, 1.0, h, device=device, dtype=dtype),
            torch.linspace(0.0, 1.0, w, device=device, dtype=dtype),
            indexing="ij",
        )
        rad = math.radians(angle)
        # When angle=0, slats are horizontal, so the perpendicular axis is yy.
        perp = yy * math.cos(rad) + xx * math.sin(rad)
        fp = (perp * count) % 1.0  # 0..1 within each slat
        # Want fp in [0, openness] = visible, fp in [openness, 1] = shadow.
        # Soft transition over `softness` on both sides.
        s = max(softness, 1e-3)
        # mask = 1 in visible zone, 0 in shadow zone, smooth at edges.
        m = ((openness + s - fp) / s).clamp(0.0, 1.0) * (fp >= 0).to(dtype)
        # Smoothstep
        m = m * m * (3.0 - 2.0 * m)
        m = m.unsqueeze(0).unsqueeze(-1)
        # 1 inside visible, (1 - shadow) inside dark.
        intensity = m + (1.0 - m) * (1.0 - shadow)
        out = (image * intensity).clamp(0.0, 1.0)
        return IO.NodeOutput(out, ui=save_live_preview(out, str(cls.hidden.unique_id)))


class LabExtension(ComfyExtension):
    @override
    async def get_node_list(self) -> list[type[IO.ComfyNode]]:
        return [
            TiltShiftNode, FrequencySeparationNode, PaletteQuantizeNode,
            HeightmapReliefNode, CausticsNode, BlindsNode,
        ]


async def comfy_entrypoint() -> LabExtension:
    return LabExtension()
