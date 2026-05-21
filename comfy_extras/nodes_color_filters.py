from __future__ import annotations

import torch
from typing_extensions import override
from torchvision.transforms.functional import adjust_saturation

from comfy_api.latest import ComfyExtension, IO
from comfy_extras._live_preview import save_live_preview


def _luma(x_bhwc: torch.Tensor) -> torch.Tensor:
    return 0.2126 * x_bhwc[..., 0:1] + 0.7152 * x_bhwc[..., 1:2] + 0.0722 * x_bhwc[..., 2:3]


class TemperatureNode(IO.ComfyNode):
    @classmethod
    def define_schema(cls):
        return IO.Schema(
            node_id="AdjustTemperature",
            display_name="Temperature / Tint",
            description="Shift white balance: warm/cool and green/magenta.",
            category="image/color",
            inputs=[
                IO.Image.Input("image"),
                IO.Float.Input("temperature", default=0.0, min=-1.0, max=1.0, step=0.01,
                              tooltip="Negative = cooler (blue), positive = warmer (yellow)."),
                IO.Float.Input("tint", default=0.0, min=-1.0, max=1.0, step=0.01,
                              tooltip="Negative = greener, positive = more magenta."),
            ],
            outputs=[IO.Image.Output(display_name="image")],
            hidden=[IO.Hidden.unique_id],
            is_output_node=True,
        )

    @classmethod
    def execute(cls, image, temperature, tint) -> IO.NodeOutput:
        x = image.clone()
        x[..., 0] = x[..., 0] + 0.15 * temperature        # R
        x[..., 1] = x[..., 1] - 0.075 * temperature + 0.1 * tint   # G
        x[..., 2] = x[..., 2] - 0.15 * temperature - 0.1 * tint    # B
        x = x.clamp(0.0, 1.0)
        return IO.NodeOutput(x, ui=save_live_preview(x, str(cls.hidden.unique_id)))


class VibranceNode(IO.ComfyNode):
    @classmethod
    def define_schema(cls):
        return IO.Schema(
            node_id="AdjustVibrance",
            display_name="Vibrance",
            description="Saturates muted colors more than already-saturated ones.",
            category="image/color",
            inputs=[
                IO.Image.Input("image"),
                IO.Float.Input("amount", default=0.0, min=-1.0, max=1.0, step=0.01),
            ],
            outputs=[IO.Image.Output(display_name="image")],
            hidden=[IO.Hidden.unique_id],
            is_output_node=True,
        )

    @classmethod
    def execute(cls, image, amount) -> IO.NodeOutput:
        if amount == 0.0:
            x = image.clamp(0.0, 1.0)
        else:
            x = image
            cmax, _ = x.max(dim=-1, keepdim=True)
            cmin, _ = x.min(dim=-1, keepdim=True)
            sat = cmax - cmin  # 0..1 per pixel
            # Weight: low-sat pixels get boosted more (1 - sat)
            weight = (1.0 - sat).pow(2.0) if amount > 0 else torch.ones_like(sat)
            gray = _luma(x).expand_as(x)
            factor = 1.0 + amount * weight
            x = (gray + (x - gray) * factor).clamp(0.0, 1.0)
        return IO.NodeOutput(x, ui=save_live_preview(x, str(cls.hidden.unique_id)))


class ColorBalanceNode(IO.ComfyNode):
    @classmethod
    def define_schema(cls):
        return IO.Schema(
            node_id="AdjustColorBalance",
            display_name="Color Balance",
            description="Shift color in shadows, midtones, and highlights independently.",
            category="image/color",
            inputs=[
                IO.Image.Input("image"),
                IO.Float.Input("shadows_cr", default=0.0, min=-1.0, max=1.0, step=0.01, tooltip="Shadows: cyan/red"),
                IO.Float.Input("shadows_mg", default=0.0, min=-1.0, max=1.0, step=0.01, tooltip="Shadows: magenta/green"),
                IO.Float.Input("shadows_yb", default=0.0, min=-1.0, max=1.0, step=0.01, tooltip="Shadows: yellow/blue"),
                IO.Float.Input("midtones_cr", default=0.0, min=-1.0, max=1.0, step=0.01, tooltip="Midtones: cyan/red"),
                IO.Float.Input("midtones_mg", default=0.0, min=-1.0, max=1.0, step=0.01, tooltip="Midtones: magenta/green"),
                IO.Float.Input("midtones_yb", default=0.0, min=-1.0, max=1.0, step=0.01, tooltip="Midtones: yellow/blue"),
                IO.Float.Input("highlights_cr", default=0.0, min=-1.0, max=1.0, step=0.01, tooltip="Highlights: cyan/red"),
                IO.Float.Input("highlights_mg", default=0.0, min=-1.0, max=1.0, step=0.01, tooltip="Highlights: magenta/green"),
                IO.Float.Input("highlights_yb", default=0.0, min=-1.0, max=1.0, step=0.01, tooltip="Highlights: yellow/blue"),
            ],
            outputs=[IO.Image.Output(display_name="image")],
            hidden=[IO.Hidden.unique_id],
            is_output_node=True,
        )

    @classmethod
    def execute(cls, image, shadows_cr, shadows_mg, shadows_yb,
                midtones_cr, midtones_mg, midtones_yb,
                highlights_cr, highlights_mg, highlights_yb) -> IO.NodeOutput:
        x = image
        luma = _luma(x).clamp(0.0, 1.0)
        w_shadow = (1.0 - luma).pow(2.0)
        w_high = luma.pow(2.0)
        w_mid = 1.0 - w_shadow - w_high
        w_mid = w_mid.clamp(0.0, 1.0)
        amount = 0.3  # scale slider intensity
        dr = amount * (shadows_cr * w_shadow + midtones_cr * w_mid + highlights_cr * w_high)
        dg = amount * (shadows_mg * w_shadow + midtones_mg * w_mid + highlights_mg * w_high)
        db = amount * (shadows_yb * w_shadow + midtones_yb * w_mid + highlights_yb * w_high)
        x = x.clone()
        x[..., 0] = x[..., 0] + dr.squeeze(-1)
        x[..., 1] = x[..., 1] + dg.squeeze(-1)
        x[..., 2] = x[..., 2] + db.squeeze(-1)
        x = x.clamp(0.0, 1.0)
        return IO.NodeOutput(x, ui=save_live_preview(x, str(cls.hidden.unique_id)))


class BlackWhiteNode(IO.ComfyNode):
    @classmethod
    def define_schema(cls):
        return IO.Schema(
            node_id="AdjustBlackWhite",
            display_name="Black & White",
            description="Convert to grayscale with adjustable color weights.",
            category="image/color",
            inputs=[
                IO.Image.Input("image"),
                IO.Float.Input("red", default=0.3, min=0.0, max=1.0, step=0.01),
                IO.Float.Input("green", default=0.59, min=0.0, max=1.0, step=0.01),
                IO.Float.Input("blue", default=0.11, min=0.0, max=1.0, step=0.01),
            ],
            outputs=[IO.Image.Output(display_name="image")],
            hidden=[IO.Hidden.unique_id],
            is_output_node=True,
        )

    @classmethod
    def execute(cls, image, red, green, blue) -> IO.NodeOutput:
        total = max(1e-6, red + green + blue)
        wr, wg, wb = red / total, green / total, blue / total
        gray = wr * image[..., 0:1] + wg * image[..., 1:2] + wb * image[..., 2:3]
        x = gray.expand_as(image).clamp(0.0, 1.0)
        return IO.NodeOutput(x, ui=save_live_preview(x, str(cls.hidden.unique_id)))


class PhotoFilterNode(IO.ComfyNode):
    @classmethod
    def define_schema(cls):
        return IO.Schema(
            node_id="AdjustPhotoFilter",
            display_name="Photo Filter",
            description="Overlay a color cast over the image.",
            category="image/color",
            inputs=[
                IO.Image.Input("image"),
                IO.Combo.Input("color", options=["warm", "cool", "sepia", "magenta", "green", "blue"], default="warm"),
                IO.Float.Input("density", default=0.25, min=0.0, max=1.0, step=0.01),
            ],
            outputs=[IO.Image.Output(display_name="image")],
            hidden=[IO.Hidden.unique_id],
            is_output_node=True,
        )

    PRESETS = {
        "warm":    (1.00, 0.78, 0.40),
        "cool":    (0.40, 0.65, 1.00),
        "sepia":   (1.00, 0.85, 0.65),
        "magenta": (1.00, 0.45, 0.85),
        "green":   (0.55, 1.00, 0.55),
        "blue":    (0.30, 0.45, 1.00),
    }

    @classmethod
    def execute(cls, image, color, density) -> IO.NodeOutput:
        r, g, b = cls.PRESETS.get(color, (1.0, 1.0, 1.0))
        tint = torch.tensor([r, g, b], device=image.device, dtype=image.dtype).view(1, 1, 1, 3)
        # Multiplicative blend, scaled by density and weighted to preserve luma roughly.
        x = image * (1.0 - density) + (image * tint) * density
        x = x.clamp(0.0, 1.0)
        return IO.NodeOutput(x, ui=save_live_preview(x, str(cls.hidden.unique_id)))


class GradientMapNode(IO.ComfyNode):
    @classmethod
    def define_schema(cls):
        return IO.Schema(
            node_id="AdjustGradientMap",
            display_name="Gradient Map",
            description="Remap luminance through a 2-stop color gradient.",
            category="image/color",
            inputs=[
                IO.Image.Input("image"),
                IO.Float.Input("shadow_r", default=0.05, min=0.0, max=1.0, step=0.01),
                IO.Float.Input("shadow_g", default=0.05, min=0.0, max=1.0, step=0.01),
                IO.Float.Input("shadow_b", default=0.20, min=0.0, max=1.0, step=0.01),
                IO.Float.Input("highlight_r", default=1.00, min=0.0, max=1.0, step=0.01),
                IO.Float.Input("highlight_g", default=0.90, min=0.0, max=1.0, step=0.01),
                IO.Float.Input("highlight_b", default=0.50, min=0.0, max=1.0, step=0.01),
                IO.Float.Input("mix", default=1.0, min=0.0, max=1.0, step=0.01),
            ],
            outputs=[IO.Image.Output(display_name="image")],
            hidden=[IO.Hidden.unique_id],
            is_output_node=True,
        )

    @classmethod
    def execute(cls, image, shadow_r, shadow_g, shadow_b,
                highlight_r, highlight_g, highlight_b, mix) -> IO.NodeOutput:
        luma = _luma(image).clamp(0.0, 1.0)  # [B, H, W, 1]
        shadow = torch.tensor([shadow_r, shadow_g, shadow_b], device=image.device, dtype=image.dtype).view(1, 1, 1, 3)
        high = torch.tensor([highlight_r, highlight_g, highlight_b], device=image.device, dtype=image.dtype).view(1, 1, 1, 3)
        mapped = shadow * (1.0 - luma) + high * luma
        x = (image * (1.0 - mix) + mapped * mix).clamp(0.0, 1.0)
        return IO.NodeOutput(x, ui=save_live_preview(x, str(cls.hidden.unique_id)))


class ChannelMixerNode(IO.ComfyNode):
    @classmethod
    def define_schema(cls):
        return IO.Schema(
            node_id="AdjustChannelMixer",
            display_name="Channel Mixer",
            description="Recombine R/G/B channels with custom coefficients.",
            category="image/color",
            inputs=[
                IO.Image.Input("image"),
                IO.Float.Input("r_from_r", default=1.0, min=-1.0, max=2.0, step=0.01),
                IO.Float.Input("r_from_g", default=0.0, min=-1.0, max=2.0, step=0.01),
                IO.Float.Input("r_from_b", default=0.0, min=-1.0, max=2.0, step=0.01),
                IO.Float.Input("g_from_r", default=0.0, min=-1.0, max=2.0, step=0.01),
                IO.Float.Input("g_from_g", default=1.0, min=-1.0, max=2.0, step=0.01),
                IO.Float.Input("g_from_b", default=0.0, min=-1.0, max=2.0, step=0.01),
                IO.Float.Input("b_from_r", default=0.0, min=-1.0, max=2.0, step=0.01),
                IO.Float.Input("b_from_g", default=0.0, min=-1.0, max=2.0, step=0.01),
                IO.Float.Input("b_from_b", default=1.0, min=-1.0, max=2.0, step=0.01),
            ],
            outputs=[IO.Image.Output(display_name="image")],
            hidden=[IO.Hidden.unique_id],
            is_output_node=True,
        )

    @classmethod
    def execute(cls, image, r_from_r, r_from_g, r_from_b,
                g_from_r, g_from_g, g_from_b,
                b_from_r, b_from_g, b_from_b) -> IO.NodeOutput:
        r, g, b = image[..., 0], image[..., 1], image[..., 2]
        new_r = r_from_r * r + r_from_g * g + r_from_b * b
        new_g = g_from_r * r + g_from_g * g + g_from_b * b
        new_b = b_from_r * r + b_from_g * g + b_from_b * b
        x = torch.stack([new_r, new_g, new_b], dim=-1).clamp(0.0, 1.0)
        return IO.NodeOutput(x, ui=save_live_preview(x, str(cls.hidden.unique_id)))


class InvertNode(IO.ComfyNode):
    @classmethod
    def define_schema(cls):
        return IO.Schema(
            node_id="AdjustInvert",
            display_name="Invert",
            description="Invert image colors.",
            category="image/color",
            inputs=[
                IO.Image.Input("image"),
                IO.Float.Input("amount", default=1.0, min=0.0, max=1.0, step=0.01),
            ],
            outputs=[IO.Image.Output(display_name="image")],
            hidden=[IO.Hidden.unique_id],
            is_output_node=True,
        )

    @classmethod
    def execute(cls, image, amount) -> IO.NodeOutput:
        x = (image * (1.0 - amount) + (1.0 - image) * amount).clamp(0.0, 1.0)
        return IO.NodeOutput(x, ui=save_live_preview(x, str(cls.hidden.unique_id)))


class PosterizeNode(IO.ComfyNode):
    @classmethod
    def define_schema(cls):
        return IO.Schema(
            node_id="AdjustPosterize",
            display_name="Posterize",
            description="Reduce the number of color levels per channel.",
            category="image/color",
            inputs=[
                IO.Image.Input("image"),
                IO.Int.Input("levels", default=4, min=2, max=32, step=1),
            ],
            outputs=[IO.Image.Output(display_name="image")],
            hidden=[IO.Hidden.unique_id],
            is_output_node=True,
        )

    @classmethod
    def execute(cls, image, levels) -> IO.NodeOutput:
        n = max(2, int(levels))
        x = (torch.floor(image * (n - 1) + 0.5) / (n - 1)).clamp(0.0, 1.0)
        return IO.NodeOutput(x, ui=save_live_preview(x, str(cls.hidden.unique_id)))


class ThresholdNode(IO.ComfyNode):
    @classmethod
    def define_schema(cls):
        return IO.Schema(
            node_id="AdjustThreshold",
            display_name="Threshold",
            description="Convert to pure black/white based on luminance.",
            category="image/color",
            inputs=[
                IO.Image.Input("image"),
                IO.Float.Input("threshold", default=0.5, min=0.0, max=1.0, step=0.01),
            ],
            outputs=[IO.Image.Output(display_name="image")],
            hidden=[IO.Hidden.unique_id],
            is_output_node=True,
        )

    @classmethod
    def execute(cls, image, threshold) -> IO.NodeOutput:
        luma = _luma(image)
        mask = (luma > threshold).to(image.dtype)
        x = mask.expand_as(image)
        return IO.NodeOutput(x, ui=save_live_preview(x, str(cls.hidden.unique_id)))


class ColorFiltersExtension(ComfyExtension):
    @override
    async def get_node_list(self) -> list[type[IO.ComfyNode]]:
        return [
            TemperatureNode, VibranceNode, ColorBalanceNode, BlackWhiteNode,
            PhotoFilterNode, GradientMapNode, ChannelMixerNode,
            InvertNode, PosterizeNode, ThresholdNode,
        ]


async def comfy_entrypoint() -> ColorFiltersExtension:
    return ColorFiltersExtension()
