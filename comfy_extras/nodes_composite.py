from __future__ import annotations

import torch
import torch.nn.functional as F
from typing_extensions import override

from comfy_api.latest import ComfyExtension, IO
from comfy_extras._live_preview import save_live_preview


def _match_size(top: torch.Tensor, base: torch.Tensor) -> torch.Tensor:
    """Resize `top` to match `base` if needed. Both [B, H, W, C]."""
    if top.shape[1:3] == base.shape[1:3]:
        return top
    t = top.permute(0, 3, 1, 2)
    t = F.interpolate(t, size=base.shape[1:3], mode="bilinear", align_corners=False)
    return t.permute(0, 2, 3, 1)


def _blend(base: torch.Tensor, top: torch.Tensor, mode: str) -> torch.Tensor:
    a, b = base, top
    if mode == "normal":
        return b
    if mode == "multiply":
        return a * b
    if mode == "screen":
        return 1.0 - (1.0 - a) * (1.0 - b)
    if mode == "overlay":
        low = 2.0 * a * b
        high = 1.0 - 2.0 * (1.0 - a) * (1.0 - b)
        return torch.where(a < 0.5, low, high)
    if mode == "soft_light":
        return (1.0 - 2.0 * b) * a * a + 2.0 * b * a
    if mode == "hard_light":
        low = 2.0 * a * b
        high = 1.0 - 2.0 * (1.0 - a) * (1.0 - b)
        return torch.where(b < 0.5, low, high)
    if mode == "difference":
        return (a - b).abs()
    if mode == "lighten":
        return torch.maximum(a, b)
    if mode == "darken":
        return torch.minimum(a, b)
    if mode == "add":
        return a + b
    if mode == "subtract":
        return a - b
    return b


class BlendNode(IO.ComfyNode):
    @classmethod
    def define_schema(cls):
        return IO.Schema(
            node_id="Blend",
            display_name="Blend",
            description="Combine two images with a blend mode.",
            category="image/composite",
            inputs=[
                IO.Image.Input("base"),
                IO.Image.Input("top"),
                IO.Combo.Input(
                    "mode",
                    options=["normal", "multiply", "screen", "overlay", "soft_light", "hard_light",
                             "difference", "lighten", "darken", "add", "subtract"],
                    default="normal",
                ),
                IO.Float.Input("opacity", default=1.0, min=0.0, max=1.0, step=0.01),
            ],
            outputs=[IO.Image.Output(display_name="image")],
            hidden=[IO.Hidden.unique_id],
            is_output_node=True,
        )

    @classmethod
    def execute(cls, base, top, mode, opacity) -> IO.NodeOutput:
        top = _match_size(top, base)
        blended = _blend(base, top, mode)
        x = (base * (1.0 - opacity) + blended * opacity).clamp(0.0, 1.0)
        return IO.NodeOutput(x, ui=save_live_preview(x, str(cls.hidden.unique_id)))


class ApplyMaskNode(IO.ComfyNode):
    @classmethod
    def define_schema(cls):
        return IO.Schema(
            node_id="ApplyMask",
            display_name="Apply Mask",
            description="Multiply the image by a mask (white = keep, black = remove).",
            category="image/mask",
            inputs=[
                IO.Image.Input("image"),
                IO.Mask.Input("mask"),
                IO.Boolean.Input("invert", default=False),
            ],
            outputs=[IO.Image.Output(display_name="image")],
            hidden=[IO.Hidden.unique_id],
            is_output_node=True,
        )

    @classmethod
    def execute(cls, image, mask, invert) -> IO.NodeOutput:
        # Mask shape is [B, H, W] or [B, 1, H, W]. Normalize to [B, H, W, 1].
        m = mask
        if m.ndim == 4 and m.shape[1] == 1:
            m = m.squeeze(1)
        # Resize mask to image if needed
        if m.shape[1:3] != image.shape[1:3]:
            mr = m.unsqueeze(1)
            mr = F.interpolate(mr, size=image.shape[1:3], mode="bilinear", align_corners=False)
            m = mr.squeeze(1)
        m = m.unsqueeze(-1)
        if invert:
            m = 1.0 - m
        x = (image * m).clamp(0.0, 1.0)
        return IO.NodeOutput(x, ui=save_live_preview(x, str(cls.hidden.unique_id)))


class ThresholdMaskNode(IO.ComfyNode):
    @classmethod
    def define_schema(cls):
        return IO.Schema(
            node_id="ThresholdMask",
            display_name="Threshold Mask",
            description="Build a mask from image luminance above a threshold.",
            category="image/mask",
            inputs=[
                IO.Image.Input("image"),
                IO.Float.Input("threshold", default=0.5, min=0.0, max=1.0, step=0.01),
                IO.Float.Input("softness", default=0.0, min=0.0, max=0.5, step=0.01,
                              tooltip="Width of the soft transition band."),
                IO.Boolean.Input("invert", default=False),
            ],
            outputs=[IO.Mask.Output(display_name="mask")],
            hidden=[IO.Hidden.unique_id],
            is_output_node=True,
        )

    @classmethod
    def execute(cls, image, threshold, softness, invert) -> IO.NodeOutput:
        luma = 0.2126 * image[..., 0] + 0.7152 * image[..., 1] + 0.0722 * image[..., 2]
        if softness <= 0.0:
            mask = (luma > threshold).to(image.dtype)
        else:
            low = threshold - softness
            high = threshold + softness
            mask = ((luma - low) / max(1e-6, high - low)).clamp(0.0, 1.0)
        if invert:
            mask = 1.0 - mask
        # Preview shows the source image with the mask applied — much more useful
        # than a flat grayscale mask for judging what the mask selects.
        preview = (image * mask.unsqueeze(-1)).clamp(0.0, 1.0)
        return IO.NodeOutput(mask, ui=save_live_preview(preview, str(cls.hidden.unique_id)))


class ColorRangeMaskNode(IO.ComfyNode):
    @classmethod
    def define_schema(cls):
        return IO.Schema(
            node_id="ColorRangeMask",
            display_name="Color Range Mask",
            description="Build a mask from pixels matching a target color.",
            category="image/mask",
            inputs=[
                IO.Image.Input("image"),
                IO.Float.Input("target_r", default=1.0, min=0.0, max=1.0, step=0.01),
                IO.Float.Input("target_g", default=0.0, min=0.0, max=1.0, step=0.01),
                IO.Float.Input("target_b", default=0.0, min=0.0, max=1.0, step=0.01),
                IO.Float.Input("tolerance", default=0.2, min=0.0, max=1.0, step=0.01),
                IO.Boolean.Input("invert", default=False),
            ],
            outputs=[IO.Mask.Output(display_name="mask")],
            hidden=[IO.Hidden.unique_id],
            is_output_node=True,
        )

    @classmethod
    def execute(cls, image, target_r, target_g, target_b, tolerance, invert) -> IO.NodeOutput:
        target = torch.tensor([target_r, target_g, target_b], device=image.device, dtype=image.dtype).view(1, 1, 1, 3)
        dist = (image - target).pow(2.0).sum(dim=-1).sqrt()  # 0..~sqrt(3)
        norm = (dist / max(1e-6, tolerance * 1.732)).clamp(0.0, 1.0)
        mask = 1.0 - norm
        if invert:
            mask = 1.0 - mask
        preview = (image * mask.unsqueeze(-1)).clamp(0.0, 1.0)
        return IO.NodeOutput(mask, ui=save_live_preview(preview, str(cls.hidden.unique_id)))


class CompositeExtension(ComfyExtension):
    @override
    async def get_node_list(self) -> list[type[IO.ComfyNode]]:
        return [BlendNode, ApplyMaskNode, ThresholdMaskNode, ColorRangeMaskNode]


async def comfy_entrypoint() -> CompositeExtension:
    return CompositeExtension()
