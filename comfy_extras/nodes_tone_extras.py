from __future__ import annotations

from math import ceil

import torch
import torch.nn.functional as F
from typing_extensions import override
from torchvision.transforms.functional import gaussian_blur

from comfy_api.latest import ComfyExtension, IO
from comfy_extras._live_preview import save_live_preview


def _radial_falloff(h: int, w: int, feather: float, device, dtype) -> torch.Tensor:
    """Per-pixel 1.0 at edges, 0.0 at center, with smooth falloff."""
    yy, xx = torch.meshgrid(
        torch.linspace(-1.0, 1.0, h, device=device, dtype=dtype),
        torch.linspace(-1.0, 1.0, w, device=device, dtype=dtype),
        indexing="ij",
    )
    r = torch.sqrt(xx * xx + yy * yy).clamp(0.0, 1.4142)
    # Smooth from 0..1: smoothstep with feather control. feather 0 = hard, 1 = soft.
    edge = 1.0 - feather
    t = ((r - edge) / max(1e-6, 1.4142 - edge)).clamp(0.0, 1.0)
    return t * t * (3.0 - 2.0 * t)


class VignetteNode(IO.ComfyNode):
    @classmethod
    def define_schema(cls):
        return IO.Schema(
            node_id="AdjustVignette",
            display_name="Vignette",
            description="Darken (or lighten) image corners.",
            category="image/tone",
            inputs=[
                IO.Image.Input("image"),
                IO.Float.Input("amount", default=0.5, min=-1.0, max=1.0, step=0.01,
                              tooltip="Negative darkens corners, positive lightens."),
                IO.Float.Input("feather", default=0.6, min=0.0, max=1.0, step=0.01,
                              tooltip="Softness of the falloff."),
            ],
            outputs=[IO.Image.Output(display_name="image")],
            hidden=[IO.Hidden.unique_id],
            is_output_node=True,
        )

    @classmethod
    def execute(cls, image, amount, feather) -> IO.NodeOutput:
        if amount == 0.0:
            x = image.clamp(0.0, 1.0)
        else:
            _, h, w, _ = image.shape
            mask = _radial_falloff(h, w, feather, image.device, image.dtype).unsqueeze(0).unsqueeze(-1)
            # Negative amount darkens (multiply), positive lightens (screen-ish).
            if amount < 0:
                factor = 1.0 + amount * mask  # mask=1 at corners → factor = 1+amount (darker)
                x = (image * factor).clamp(0.0, 1.0)
            else:
                factor = amount * mask
                x = (image + (1.0 - image) * factor).clamp(0.0, 1.0)
        return IO.NodeOutput(x, ui=save_live_preview(x, str(cls.hidden.unique_id)))


class GlowNode(IO.ComfyNode):
    @classmethod
    def define_schema(cls):
        return IO.Schema(
            node_id="AdjustGlow",
            display_name="Glow",
            description="Bright pixels bleed softly into surroundings (bloom).",
            category="image/tone",
            inputs=[
                IO.Image.Input("image"),
                IO.Float.Input("threshold", default=0.7, min=0.0, max=1.0, step=0.01,
                              tooltip="Brightness above this glows."),
                IO.Float.Input("intensity", default=0.5, min=0.0, max=2.0, step=0.05,
                              tooltip="How much glow to add."),
                IO.Float.Input("radius", default=10.0, min=0.0, max=50.0, step=0.5,
                              tooltip="Glow softness in pixels."),
            ],
            outputs=[IO.Image.Output(display_name="image")],
            hidden=[IO.Hidden.unique_id],
            is_output_node=True,
        )

    @classmethod
    def execute(cls, image, threshold, intensity, radius) -> IO.NodeOutput:
        if intensity <= 0.0 or radius <= 0.0:
            x = image.clamp(0.0, 1.0)
        else:
            x = image.permute(0, 3, 1, 2)
            # Luma mask for brightness threshold
            luma = 0.2126 * x[:, 0:1] + 0.7152 * x[:, 1:2] + 0.0722 * x[:, 2:3]
            highlights = (x * (luma > threshold).to(x.dtype)).clamp(0.0, 1.0)
            # Downsample for fast wide blur.
            scale = max(1, int(radius / 4))
            _, _, h, w = x.shape
            small = F.interpolate(highlights, scale_factor=1.0 / scale, mode="area")
            sigma = radius / scale
            ksize = 2 * ceil(3.0 * sigma) + 1
            blurred = gaussian_blur(small, kernel_size=ksize, sigma=sigma)
            blurred = F.interpolate(blurred, size=(h, w), mode="bilinear", align_corners=False)
            x = (x + intensity * blurred).clamp(0.0, 1.0)
            x = x.permute(0, 2, 3, 1)
        return IO.NodeOutput(x, ui=save_live_preview(x, str(cls.hidden.unique_id)))


class ShadowsHighlightsNode(IO.ComfyNode):
    @classmethod
    def define_schema(cls):
        return IO.Schema(
            node_id="AdjustShadowsHighlights",
            display_name="Shadows / Highlights",
            description="Selectively lift shadows and recover highlights.",
            category="image/tone",
            inputs=[
                IO.Image.Input("image"),
                IO.Float.Input("shadows", default=0.0, min=-1.0, max=1.0, step=0.01,
                              tooltip="Lift (+) or crush (-) shadows."),
                IO.Float.Input("highlights", default=0.0, min=-1.0, max=1.0, step=0.01,
                              tooltip="Recover (-) or boost (+) highlights."),
            ],
            outputs=[IO.Image.Output(display_name="image")],
            hidden=[IO.Hidden.unique_id],
            is_output_node=True,
        )

    @classmethod
    def execute(cls, image, shadows, highlights) -> IO.NodeOutput:
        if shadows == 0.0 and highlights == 0.0:
            x = image.clamp(0.0, 1.0)
        else:
            x = image
            # Luma map controls per-pixel weights
            luma = (0.2126 * x[..., 0:1] + 0.7152 * x[..., 1:2] + 0.0722 * x[..., 2:3]).clamp(0.0, 1.0)
            # Shadow weight peaks at dark pixels and fades to mid
            shadow_w = (1.0 - luma).pow(2.0)
            highlight_w = luma.pow(2.0)
            # Map slider to a curve shift
            x = x + shadows * 0.5 * shadow_w - highlights * 0.5 * highlight_w
            x = x.clamp(0.0, 1.0)
        return IO.NodeOutput(x, ui=save_live_preview(x, str(cls.hidden.unique_id)))


class ToneExtrasExtension(ComfyExtension):
    @override
    async def get_node_list(self) -> list[type[IO.ComfyNode]]:
        return [VignetteNode, GlowNode, ShadowsHighlightsNode]


async def comfy_entrypoint() -> ToneExtrasExtension:
    return ToneExtrasExtension()
