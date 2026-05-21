"""Effects inspired by Unicorn Studio's shader library.

These are written as pure-PyTorch operations on [B,H,W,3] images in [0,1].
Each node writes a live preview so the canvas can update incrementally.
"""
from __future__ import annotations

from math import pi

import torch
import torch.nn.functional as F
from typing_extensions import override

from comfy_api.latest import ComfyExtension, IO
from comfy_extras._live_preview import save_live_preview


# ---------------------------------------------------------------------------
# Helpers
# ---------------------------------------------------------------------------


def _luma(image: torch.Tensor) -> torch.Tensor:
    """Compute luminance [B,H,W] from [B,H,W,3]."""
    return 0.2126 * image[..., 0] + 0.7152 * image[..., 1] + 0.0722 * image[..., 2]


def _hex_to_rgb(h: str, fallback=(0.0, 0.0, 0.0)) -> tuple[float, float, float]:
    """'#rrggbb' or 'rrggbb' → (r,g,b) floats in [0,1]."""
    s = h.strip().lstrip("#")
    if len(s) == 3:
        s = "".join(c * 2 for c in s)
    if len(s) != 6:
        return fallback
    try:
        return (int(s[0:2], 16) / 255.0, int(s[2:4], 16) / 255.0, int(s[4:6], 16) / 255.0)
    except ValueError:
        return fallback


def _grid(b: int, h: int, w: int, device, dtype) -> tuple[torch.Tensor, torch.Tensor]:
    """Return (xx, yy) normalized to [-1, 1], shape [H, W]."""
    yy, xx = torch.meshgrid(
        torch.linspace(-1.0, 1.0, h, device=device, dtype=dtype),
        torch.linspace(-1.0, 1.0, w, device=device, dtype=dtype),
        indexing="ij",
    )
    return xx, yy


def _value_noise(h: int, w: int, scale: float, seed: int, device, dtype) -> torch.Tensor:
    """Cheap smooth noise: sample a low-res random grid, bilinear-upsample."""
    g = torch.Generator(device="cpu").manual_seed(int(seed) & 0x7FFFFFFF)
    low_h = max(2, int(h / max(1.0, scale)))
    low_w = max(2, int(w / max(1.0, scale)))
    low = torch.rand((1, 1, low_h, low_w), generator=g).to(device=device, dtype=dtype)
    return F.interpolate(low, size=(h, w), mode="bilinear", align_corners=False).squeeze(0).squeeze(0)


# ---------------------------------------------------------------------------
# 1. Gradient Map
# ---------------------------------------------------------------------------


class GradientMapNode(IO.ComfyNode):
    """Remap luminance to a linear gradient between two colors."""
    @classmethod
    def define_schema(cls):
        return IO.Schema(
            node_id="GradientMap",
            display_name="Gradient Map",
            description="Maps the image's luminance to a 2-color gradient.",
            category="image/grading",
            inputs=[
                IO.Image.Input("image"),
                IO.String.Input("dark_color", default="#1a0a2e",
                               tooltip="Hex color for dark (low-luma) regions."),
                IO.String.Input("light_color", default="#f5dbd1",
                               tooltip="Hex color for bright (high-luma) regions."),
                IO.Float.Input("midpoint", default=0.5, min=0.0, max=1.0, step=0.01,
                              tooltip="Luminance value that maps to the midpoint of the gradient."),
                IO.Float.Input("contrast", default=1.0, min=0.1, max=4.0, step=0.05,
                              tooltip="Steepness of the gradient curve."),
                IO.Float.Input("mix", default=1.0, min=0.0, max=1.0, step=0.01),
            ],
            outputs=[IO.Image.Output(display_name="image")],
            hidden=[IO.Hidden.unique_id],
            is_output_node=True,
        )

    @classmethod
    def execute(cls, image, dark_color, light_color, midpoint, contrast, mix) -> IO.NodeOutput:
        dr, dg, db = _hex_to_rgb(dark_color, (0.0, 0.0, 0.0))
        lr, lg, lb = _hex_to_rgb(light_color, (1.0, 1.0, 1.0))
        dark = torch.tensor([dr, dg, db], device=image.device, dtype=image.dtype)
        light = torch.tensor([lr, lg, lb], device=image.device, dtype=image.dtype)
        lu = _luma(image)
        # Sigmoid-like remapping around the midpoint with adjustable steepness.
        t = (lu - midpoint) * float(contrast) + 0.5
        t = t.clamp(0.0, 1.0).unsqueeze(-1)
        mapped = dark * (1.0 - t) + light * t
        out = image * (1.0 - mix) + mapped * mix
        out = out.clamp(0.0, 1.0)
        return IO.NodeOutput(out, ui=save_live_preview(out, str(cls.hidden.unique_id)))


# ---------------------------------------------------------------------------
# 2. Posterize
# ---------------------------------------------------------------------------


class PosterizeNode(IO.ComfyNode):
    """Quantize each channel to a fixed number of levels."""
    @classmethod
    def define_schema(cls):
        return IO.Schema(
            node_id="Posterize",
            display_name="Posterize",
            description="Reduce each channel to a small number of discrete levels.",
            category="image/grading",
            inputs=[
                IO.Image.Input("image"),
                IO.Int.Input("levels", default=5, min=2, max=16, step=1,
                            tooltip="Number of quantization levels per channel."),
                IO.Float.Input("gamma", default=1.0, min=0.1, max=3.0, step=0.05,
                              tooltip="Pre-quantization gamma. >1 makes shadows posterize more; <1 highlights."),
                IO.Boolean.Input("per_channel", default=True,
                                tooltip="Posterize R/G/B independently. Disable to posterize luma only."),
            ],
            outputs=[IO.Image.Output(display_name="image")],
            hidden=[IO.Hidden.unique_id],
            is_output_node=True,
        )

    @classmethod
    def execute(cls, image, levels, gamma, per_channel) -> IO.NodeOutput:
        n = max(2, int(levels))
        if per_channel:
            x = image.clamp(0.0, 1.0).pow(float(gamma))
            x = torch.round(x * (n - 1)) / (n - 1)
            out = x.pow(1.0 / float(gamma))
        else:
            lu = _luma(image).clamp(0.0, 1.0).pow(float(gamma))
            q = torch.round(lu * (n - 1)) / (n - 1)
            q = q.pow(1.0 / float(gamma))
            # Scale chroma the same way the luma was scaled.
            scale = (q / lu.clamp(min=1e-6)).unsqueeze(-1)
            out = (image * scale).clamp(0.0, 1.0)
        out = out.clamp(0.0, 1.0)
        return IO.NodeOutput(out, ui=save_live_preview(out, str(cls.hidden.unique_id)))


# ---------------------------------------------------------------------------
# 3. Outline
# ---------------------------------------------------------------------------


class OutlineNode(IO.ComfyNode):
    """Trace edges and composite them over a fill or the source."""
    @classmethod
    def define_schema(cls):
        return IO.Schema(
            node_id="Outline",
            display_name="Outline",
            description="Detect edges and draw them over a solid fill or the source image.",
            category="image/stylize",
            inputs=[
                IO.Image.Input("image"),
                IO.Float.Input("thickness", default=1.0, min=0.5, max=4.0, step=0.1,
                              tooltip="Edge thickness multiplier."),
                IO.Float.Input("threshold", default=0.15, min=0.01, max=1.0, step=0.01,
                              tooltip="Edge strength cutoff. Lower = more lines."),
                IO.String.Input("line_color", default="#000000"),
                IO.String.Input("fill_color", default="#ffffff",
                               tooltip="Background fill. Used only when fill_mode='solid'."),
                IO.Combo.Input("fill_mode", options=["solid", "source", "transparent_black"],
                              default="solid"),
                IO.Float.Input("mix", default=1.0, min=0.0, max=1.0, step=0.01),
            ],
            outputs=[IO.Image.Output(display_name="image")],
            hidden=[IO.Hidden.unique_id],
            is_output_node=True,
        )

    @classmethod
    def execute(cls, image, thickness, threshold, line_color, fill_color, fill_mode, mix) -> IO.NodeOutput:
        b, h, w, _ = image.shape
        # Sobel operator on luma.
        lu = _luma(image).unsqueeze(1)  # [B,1,H,W]
        kx = torch.tensor([[-1, 0, 1], [-2, 0, 2], [-1, 0, 1]], device=image.device, dtype=image.dtype).view(1, 1, 3, 3)
        ky = torch.tensor([[-1, -2, -1], [0, 0, 0], [1, 2, 1]], device=image.device, dtype=image.dtype).view(1, 1, 3, 3)
        gx = F.conv2d(lu, kx, padding=1)
        gy = F.conv2d(lu, ky, padding=1)
        mag = torch.sqrt(gx * gx + gy * gy)
        # Normalize so threshold is roughly uniform across images.
        mag = mag / mag.amax(dim=(2, 3), keepdim=True).clamp(min=1e-6)
        # Edge mask, soft transition around the threshold.
        soft = ((mag - threshold * 0.5) / max(0.01, threshold * 0.5)).clamp(0.0, 1.0)
        # Dilate by a small max-pool to thicken lines.
        k = max(1, int(round(thickness)))
        if k > 1:
            soft = F.max_pool2d(soft, kernel_size=k * 2 + 1, stride=1, padding=k)
        em = soft.squeeze(1).unsqueeze(-1)  # [B,H,W,1]

        lc = torch.tensor(_hex_to_rgb(line_color, (0, 0, 0)), device=image.device, dtype=image.dtype)
        if fill_mode == "solid":
            fc = torch.tensor(_hex_to_rgb(fill_color, (1, 1, 1)), device=image.device, dtype=image.dtype)
            base = fc.view(1, 1, 1, 3).expand_as(image)
        elif fill_mode == "source":
            base = image
        else:  # transparent_black
            base = torch.zeros_like(image)
        line_layer = lc.view(1, 1, 1, 3).expand_as(image)
        out = base * (1.0 - em) + line_layer * em
        out = image * (1.0 - mix) + out * mix
        out = out.clamp(0.0, 1.0)
        return IO.NodeOutput(out, ui=save_live_preview(out, str(cls.hidden.unique_id)))


# ---------------------------------------------------------------------------
# 4. Mirror
# ---------------------------------------------------------------------------


class MirrorNode(IO.ComfyNode):
    """Reflect one half of the image onto the other (or quadrants)."""
    @classmethod
    def define_schema(cls):
        return IO.Schema(
            node_id="Mirror",
            display_name="Mirror",
            description="Mirror one half of the image onto the other.",
            category="image/distortion",
            inputs=[
                IO.Image.Input("image"),
                IO.Combo.Input("mode", options=[
                    "left_to_right", "right_to_left",
                    "top_to_bottom", "bottom_to_top",
                    "quadrant_tl", "quadrant_tr",
                ], default="left_to_right"),
                IO.Float.Input("seam", default=0.5, min=0.0, max=1.0, step=0.01,
                              tooltip="Position of the mirror line (0..1)."),
            ],
            outputs=[IO.Image.Output(display_name="image")],
            hidden=[IO.Hidden.unique_id],
            is_output_node=True,
        )

    @classmethod
    def execute(cls, image, mode, seam) -> IO.NodeOutput:
        b, h, w, _ = image.shape
        out = image.clone()

        if mode in ("left_to_right", "right_to_left"):
            cut = max(1, min(w - 1, int(round(seam * w))))
            if mode == "left_to_right":
                left = image[:, :, :cut, :]
                flipped = torch.flip(left, dims=[2])
                # Place flipped to the right of the seam, cropped/padded to width-cut.
                rw = w - cut
                if flipped.shape[2] >= rw:
                    out[:, :, cut:, :] = flipped[:, :, :rw, :]
                else:
                    out[:, :, cut:cut + flipped.shape[2], :] = flipped
            else:
                right = image[:, :, cut:, :]
                flipped = torch.flip(right, dims=[2])
                lw = cut
                if flipped.shape[2] >= lw:
                    out[:, :, :lw, :] = flipped[:, :, -lw:, :]
                else:
                    out[:, :, lw - flipped.shape[2]:lw, :] = flipped

        elif mode in ("top_to_bottom", "bottom_to_top"):
            cut = max(1, min(h - 1, int(round(seam * h))))
            if mode == "top_to_bottom":
                top = image[:, :cut, :, :]
                flipped = torch.flip(top, dims=[1])
                bh = h - cut
                if flipped.shape[1] >= bh:
                    out[:, cut:, :, :] = flipped[:, :bh, :, :]
                else:
                    out[:, cut:cut + flipped.shape[1], :, :] = flipped
            else:
                bottom = image[:, cut:, :, :]
                flipped = torch.flip(bottom, dims=[1])
                th = cut
                if flipped.shape[1] >= th:
                    out[:, :th, :, :] = flipped[:, -th:, :, :]
                else:
                    out[:, th - flipped.shape[1]:th, :, :] = flipped

        else:  # quadrant_tl or quadrant_tr — kaleidoscope-style 4-way
            hh, hw = h // 2, w // 2
            if mode == "quadrant_tl":
                quad = image[:, :hh, :hw, :]
            else:  # tr
                quad = image[:, :hh, w - hw:, :]
                quad = torch.flip(quad, dims=[2])
            top = torch.cat([quad, torch.flip(quad, dims=[2])], dim=2)
            full = torch.cat([top, torch.flip(top, dims=[1])], dim=1)
            # If sizes don't perfectly match (odd dims) pad/crop.
            fh, fw = full.shape[1], full.shape[2]
            out = torch.zeros_like(image)
            out[:, :min(h, fh), :min(w, fw), :] = full[:, :min(h, fh), :min(w, fw), :]

        out = out.clamp(0.0, 1.0)
        return IO.NodeOutput(out, ui=save_live_preview(out, str(cls.hidden.unique_id)))


# ---------------------------------------------------------------------------
# 5. Hologram
# ---------------------------------------------------------------------------


class HologramNode(IO.ComfyNode):
    """Iridescent rainbow shimmer driven by luma + screen position."""
    @classmethod
    def define_schema(cls):
        return IO.Schema(
            node_id="Hologram",
            display_name="Hologram",
            description="Iridescent rainbow tint that shifts with brightness and position.",
            category="image/stylize",
            inputs=[
                IO.Image.Input("image"),
                IO.Float.Input("frequency", default=2.0, min=0.5, max=12.0, step=0.1,
                              tooltip="How many rainbow cycles across the image."),
                IO.Float.Input("angle", default=45.0, min=-180.0, max=180.0, step=1.0,
                              tooltip="Direction of the rainbow bands, in degrees."),
                IO.Float.Input("luma_weight", default=0.5, min=0.0, max=1.0, step=0.01,
                              tooltip="How much luma contributes to the hue shift vs. position."),
                IO.Float.Input("saturation", default=0.8, min=0.0, max=1.5, step=0.05),
                IO.Float.Input("brightness", default=1.0, min=0.0, max=2.0, step=0.05),
                IO.Float.Input("mix", default=0.8, min=0.0, max=1.0, step=0.01),
            ],
            outputs=[IO.Image.Output(display_name="image")],
            hidden=[IO.Hidden.unique_id],
            is_output_node=True,
        )

    @classmethod
    def execute(cls, image, frequency, angle, luma_weight, saturation, brightness, mix) -> IO.NodeOutput:
        b, h, w, _ = image.shape
        xx, yy = _grid(b, h, w, image.device, image.dtype)
        a = torch.tensor(angle * pi / 180.0, device=image.device, dtype=image.dtype)
        # Project (x,y) along angle direction.
        proj = xx * torch.cos(a) + yy * torch.sin(a)
        lu = _luma(image)
        phase = proj * float(frequency) + lu * float(luma_weight) * 4.0
        # Build an HSV-like rainbow from the phase. Use sinusoidal bands.
        r = 0.5 + 0.5 * torch.cos(2 * pi * phase)
        g = 0.5 + 0.5 * torch.cos(2 * pi * phase + 2 * pi / 3.0)
        bl = 0.5 + 0.5 * torch.cos(2 * pi * phase + 4 * pi / 3.0)
        rainbow = torch.stack([r, g, bl], dim=-1)  # [B,H,W,3] or [H,W,3]
        if rainbow.dim() == 3:
            rainbow = rainbow.unsqueeze(0).expand(b, -1, -1, -1)
        # Desaturate toward gray by `saturation`.
        gray = rainbow.mean(dim=-1, keepdim=True)
        rainbow = gray + (rainbow - gray) * float(saturation)
        # Modulate by source luma so darks stay dark.
        rainbow = rainbow * lu.unsqueeze(-1) * float(brightness)
        out = image * (1.0 - mix) + rainbow * mix
        out = out.clamp(0.0, 1.0)
        return IO.NodeOutput(out, ui=save_live_preview(out, str(cls.hidden.unique_id)))


# ---------------------------------------------------------------------------
# 6. Stipple
# ---------------------------------------------------------------------------


class StippleNode(IO.ComfyNode):
    """Random-dot shading: probability of a dot proportional to darkness."""
    @classmethod
    def define_schema(cls):
        return IO.Schema(
            node_id="Stipple",
            display_name="Stipple",
            description="Render the image as a field of randomly placed dots.",
            category="image/stylize",
            inputs=[
                IO.Image.Input("image"),
                IO.Int.Input("density", default=20, min=2, max=80, step=1,
                            tooltip="Higher = more dots per area."),
                IO.Float.Input("dot_size", default=1.0, min=0.5, max=4.0, step=0.1),
                IO.Float.Input("gamma", default=1.0, min=0.2, max=3.0, step=0.05),
                IO.String.Input("dot_color", default="#000000"),
                IO.String.Input("bg_color", default="#ffffff"),
                IO.Int.Input("seed", default=0, min=0, max=2**31 - 1, step=1),
                IO.Boolean.Input("invert", default=False,
                                tooltip="Bright cells get dots instead of dark cells."),
            ],
            outputs=[IO.Image.Output(display_name="image")],
            hidden=[IO.Hidden.unique_id],
            is_output_node=True,
        )

    @classmethod
    def execute(cls, image, density, dot_size, gamma, dot_color, bg_color, seed, invert) -> IO.NodeOutput:
        b, h, w, _ = image.shape
        cell = max(2, int(round(min(h, w) / float(density))))
        h2, w2 = (h // cell) * cell, (w // cell) * cell
        cropped = image[:, :h2, :w2, :]
        lu = _luma(cropped).clamp(0.0, 1.0).pow(float(gamma))
        # Average luma per cell.
        avg = F.avg_pool2d(lu.unsqueeze(1), kernel_size=cell).squeeze(1)  # [B,sh,sw]
        sh, sw = avg.shape[-2], avg.shape[-1]
        # Probability of placing a dot = darkness (1 - luma), or brightness if invert.
        prob = avg if invert else (1.0 - avg)
        g = torch.Generator(device="cpu").manual_seed(int(seed) & 0x7FFFFFFF)
        rand = torch.rand((b, sh, sw), generator=g).to(device=image.device, dtype=image.dtype)
        present = (rand < prob).to(image.dtype)  # [B,sh,sw]
        # Build a radial dot mask once.
        rs = max(1, int(round(dot_size * cell / 3.0)))
        yy, xx = torch.meshgrid(
            torch.arange(cell, device=image.device, dtype=image.dtype) - cell / 2.0,
            torch.arange(cell, device=image.device, dtype=image.dtype) - cell / 2.0,
            indexing="ij",
        )
        d = torch.sqrt(xx * xx + yy * yy)
        dot = (1.0 - ((d - rs + 1.0).clamp(min=0.0))).clamp(0.0, 1.0)  # 1 inside, soft edge
        # Stamp present mask × dot across cells.
        # present: [B,sh,sw] → upsample with nearest, multiply by tiled dot.
        present_up = F.interpolate(present.unsqueeze(1), size=(h2, w2), mode="nearest").squeeze(1)
        dot_tiled = dot.repeat(sh, sw)  # [h2, w2]
        mask = (present_up * dot_tiled.unsqueeze(0)).unsqueeze(-1)  # [B,h2,w2,1]
        dc = torch.tensor(_hex_to_rgb(dot_color, (0, 0, 0)), device=image.device, dtype=image.dtype)
        bc = torch.tensor(_hex_to_rgb(bg_color, (1, 1, 1)), device=image.device, dtype=image.dtype)
        layer = bc.view(1, 1, 1, 3) * (1.0 - mask) + dc.view(1, 1, 1, 3) * mask
        out = torch.zeros_like(image) + bc.view(1, 1, 1, 3)
        out[:, :h2, :w2, :] = layer
        out = out.clamp(0.0, 1.0)
        return IO.NodeOutput(out, ui=save_live_preview(out, str(cls.hidden.unique_id)))


# ---------------------------------------------------------------------------
# 7. Sparkle
# ---------------------------------------------------------------------------


class SparkleNode(IO.ComfyNode):
    """Place 4- or 8-point starbursts on bright spots."""
    @classmethod
    def define_schema(cls):
        return IO.Schema(
            node_id="Sparkle",
            display_name="Sparkle",
            description="Find bright spots and overlay starburst flares on them.",
            category="image/atmosphere",
            inputs=[
                IO.Image.Input("image"),
                IO.Float.Input("threshold", default=0.85, min=0.0, max=1.0, step=0.01,
                              tooltip="Only pixels brighter than this spawn sparkles."),
                IO.Float.Input("size", default=14.0, min=2.0, max=80.0, step=1.0,
                              tooltip="Length of star arms, in pixels."),
                IO.Float.Input("intensity", default=1.0, min=0.0, max=4.0, step=0.05),
                IO.Int.Input("points", default=4, min=2, max=8, step=1,
                            tooltip="Number of arms (2, 4, 6 or 8)."),
                IO.Float.Input("angle", default=0.0, min=-180.0, max=180.0, step=1.0),
                IO.Float.Input("max_density", default=0.005, min=0.0001, max=0.05, step=0.0005,
                              tooltip="Fraction of pixels allowed to spawn a star (keeps stars sparse)."),
            ],
            outputs=[IO.Image.Output(display_name="image")],
            hidden=[IO.Hidden.unique_id],
            is_output_node=True,
        )

    @classmethod
    def execute(cls, image, threshold, size, intensity, points, angle, max_density) -> IO.NodeOutput:
        b, h, w, _ = image.shape
        device, dtype = image.device, image.dtype
        lu = _luma(image)  # [B,H,W]

        # Local maxima via max-pool: keep pixels that are the brightest in their neighborhood.
        nbh = 9
        lmax = F.max_pool2d(lu.unsqueeze(1), kernel_size=nbh, stride=1, padding=nbh // 2).squeeze(1)
        peaks = ((lu >= lmax - 1e-5) & (lu > threshold)).to(dtype)

        # Cap density: keep only the top-k brightest peaks.
        max_n = max(1, int(max_density * h * w))
        flat = (peaks * lu).view(b, -1)
        # For each batch, pick top-max_n indices.
        topk = torch.topk(flat, k=min(max_n, flat.shape[1]), dim=1)
        kept = torch.zeros_like(flat)
        kept.scatter_(1, topk.indices, (topk.values > threshold).to(dtype))
        peaks = kept.view(b, h, w)

        # Build a star kernel.
        ks = int(size) * 2 + 1
        cy = cx = ks // 2
        yy, xx = torch.meshgrid(
            torch.arange(ks, device=device, dtype=dtype) - cy,
            torch.arange(ks, device=device, dtype=dtype) - cx,
            indexing="ij",
        )
        # Distance to each arm direction.
        angles = [angle + i * (360.0 / points) for i in range(points)]
        star = torch.zeros((ks, ks), device=device, dtype=dtype)
        for a_deg in angles:
            a = a_deg * pi / 180.0
            # Distance from the line through origin at angle a.
            # Line direction: (cos a, sin a). Perpendicular distance = |-x sin a + y cos a|
            perp = (-xx * torch.sin(torch.tensor(a, device=device, dtype=dtype))
                    + yy * torch.cos(torch.tensor(a, device=device, dtype=dtype))).abs()
            along = (xx * torch.cos(torch.tensor(a, device=device, dtype=dtype))
                     + yy * torch.sin(torch.tensor(a, device=device, dtype=dtype)))
            arm = torch.exp(-perp * 1.5) * (along.abs() / (ks / 2.0)).clamp(0, 1)
            # Falloff along the arm.
            arm = arm * (1.0 - (along.abs() / (ks / 2.0)).clamp(0, 1))
            star = torch.maximum(star, arm)
        # Bright center.
        center = torch.exp(-(xx * xx + yy * yy) / (ks * 0.06)).clamp(0, 1)
        star = torch.maximum(star, center * 0.6)

        # Convolve peaks with star using conv2d (single-channel, batched).
        star_k = star.view(1, 1, ks, ks)
        peaks_4d = peaks.unsqueeze(1)  # [B,1,H,W]
        flare = F.conv2d(peaks_4d, star_k, padding=ks // 2).squeeze(1)  # [B,H,W]
        flare = (flare * float(intensity)).clamp(0.0, 4.0)
        out = (image + flare.unsqueeze(-1)).clamp(0.0, 1.0)
        return IO.NodeOutput(out, ui=save_live_preview(out, str(cls.hidden.unique_id)))


# ---------------------------------------------------------------------------
# 8. 2D Light
# ---------------------------------------------------------------------------


class TwoDLightNode(IO.ComfyNode):
    """Soft directional gradient lighting overlay."""
    @classmethod
    def define_schema(cls):
        return IO.Schema(
            node_id="TwoDLight",
            display_name="2D Light",
            description="Overlay a soft directional light gradient on the image.",
            category="image/atmosphere",
            inputs=[
                IO.Image.Input("image"),
                IO.Float.Input("x", default=0.3, min=0.0, max=1.0, step=0.01,
                              tooltip="Light source X position (0..1)."),
                IO.Float.Input("y", default=0.3, min=0.0, max=1.0, step=0.01),
                IO.Float.Input("radius", default=0.7, min=0.05, max=2.0, step=0.01,
                              tooltip="Falloff radius, in fractions of the image diagonal."),
                IO.Float.Input("falloff", default=2.0, min=0.5, max=6.0, step=0.1,
                              tooltip="Curve of the falloff. Higher = sharper edge."),
                IO.String.Input("color", default="#ffe8c4"),
                IO.Float.Input("intensity", default=1.0, min=0.0, max=3.0, step=0.05),
                IO.Combo.Input("blend", options=["screen", "add", "multiply", "overlay"],
                              default="screen"),
            ],
            outputs=[IO.Image.Output(display_name="image")],
            hidden=[IO.Hidden.unique_id],
            is_output_node=True,
        )

    @classmethod
    def execute(cls, image, x, y, radius, falloff, color, intensity, blend) -> IO.NodeOutput:
        b, h, w, _ = image.shape
        device, dtype = image.device, image.dtype
        yy = (torch.arange(h, device=device, dtype=dtype) / max(1, h - 1) - y)
        xx = (torch.arange(w, device=device, dtype=dtype) / max(1, w - 1) - x)
        d = torch.sqrt(yy.unsqueeze(1) ** 2 + xx.unsqueeze(0) ** 2)  # [H,W]
        falloff_map = (1.0 - (d / radius).clamp(0.0, 1.0)).pow(float(falloff))
        falloff_map = (falloff_map * float(intensity)).clamp(0.0, 4.0)
        cr, cg, cb = _hex_to_rgb(color, (1, 1, 1))
        light = torch.stack([
            falloff_map * cr,
            falloff_map * cg,
            falloff_map * cb,
        ], dim=-1).unsqueeze(0).expand(b, -1, -1, -1)

        if blend == "screen":
            out = 1.0 - (1.0 - image) * (1.0 - light)
        elif blend == "add":
            out = image + light
        elif blend == "multiply":
            out = image * (1.0 + light)
        else:  # overlay
            low = 2.0 * image * light
            high = 1.0 - 2.0 * (1.0 - image) * (1.0 - light)
            out = torch.where(image < 0.5, low, high)
        out = out.clamp(0.0, 1.0)
        return IO.NodeOutput(out, ui=save_live_preview(out, str(cls.hidden.unique_id)))


# ---------------------------------------------------------------------------
# 9. Flow Field
# ---------------------------------------------------------------------------


class FlowFieldNode(IO.ComfyNode):
    """Sample the image along a smooth noise-driven displacement field."""
    @classmethod
    def define_schema(cls):
        return IO.Schema(
            node_id="FlowField",
            display_name="Flow Field",
            description="Warp the image along a smooth noise-driven flow field.",
            category="image/distortion",
            inputs=[
                IO.Image.Input("image"),
                IO.Float.Input("strength", default=0.05, min=0.0, max=0.4, step=0.005,
                              tooltip="Maximum displacement, in fractions of the image size."),
                IO.Float.Input("scale", default=80.0, min=8.0, max=400.0, step=2.0,
                              tooltip="Noise feature size. Larger = smoother swirls."),
                IO.Float.Input("rotation", default=0.0, min=-180.0, max=180.0, step=1.0,
                              tooltip="Rotate the flow direction in degrees."),
                IO.Int.Input("seed", default=0, min=0, max=2**31 - 1, step=1),
            ],
            outputs=[IO.Image.Output(display_name="image")],
            hidden=[IO.Hidden.unique_id],
            is_output_node=True,
        )

    @classmethod
    def execute(cls, image, strength, scale, rotation, seed) -> IO.NodeOutput:
        b, h, w, _ = image.shape
        device, dtype = image.device, image.dtype
        # Two noise channels: angle and magnitude (sort of).
        n1 = _value_noise(h, w, float(scale), int(seed), device, dtype)
        n2 = _value_noise(h, w, float(scale), int(seed) + 17, device, dtype)
        # Map noise to a unit-vector field via angle = 2π·n1.
        ang = 2 * pi * n1 + rotation * pi / 180.0
        mag = n2  # 0..1
        dx = torch.cos(ang) * mag * float(strength)
        dy = torch.sin(ang) * mag * float(strength)

        # Build sampling grid in grid_sample's [-1,1] coords.
        yy, xx = torch.meshgrid(
            torch.linspace(-1.0, 1.0, h, device=device, dtype=dtype),
            torch.linspace(-1.0, 1.0, w, device=device, dtype=dtype),
            indexing="ij",
        )
        # dx, dy are in [-1,1] frac of width/height already (since strength
        # is small fractional). Multiply by 2 since coord range is 2.
        gx = (xx + dx * 2.0).clamp(-1.0, 1.0)
        gy = (yy + dy * 2.0).clamp(-1.0, 1.0)
        grid = torch.stack([gx, gy], dim=-1).unsqueeze(0).expand(b, -1, -1, -1)
        img_ch = image.permute(0, 3, 1, 2)
        sampled = F.grid_sample(img_ch, grid, mode="bilinear",
                                padding_mode="reflection", align_corners=True)
        out = sampled.permute(0, 2, 3, 1).clamp(0.0, 1.0)
        return IO.NodeOutput(out, ui=save_live_preview(out, str(cls.hidden.unique_id)))


# ---------------------------------------------------------------------------
# Registration
# ---------------------------------------------------------------------------


class UnicornExtension(ComfyExtension):
    @override
    async def get_node_list(self) -> list[type[IO.ComfyNode]]:
        return [
            GradientMapNode, PosterizeNode, OutlineNode, MirrorNode, HologramNode,
            StippleNode, SparkleNode, TwoDLightNode, FlowFieldNode,
        ]


async def comfy_entrypoint() -> UnicornExtension:
    return UnicornExtension()
