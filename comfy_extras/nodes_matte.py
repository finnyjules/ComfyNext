from __future__ import annotations

from math import ceil

import torch
import torch.nn.functional as F
from typing_extensions import override
from torchvision.transforms.functional import gaussian_blur

from comfy_api.latest import ComfyExtension, IO
from comfy_extras._live_preview import save_live_preview


def _ensure_bhw(mask: torch.Tensor) -> torch.Tensor:
    """Normalize a mask to shape [B, H, W]."""
    if mask.ndim == 4 and mask.shape[1] == 1:
        return mask.squeeze(1)
    if mask.ndim == 2:
        return mask.unsqueeze(0)
    return mask


class MatteGrowShrinkNode(IO.ComfyNode):
    @classmethod
    def define_schema(cls):
        return IO.Schema(
            node_id="MatteGrowShrink",
            display_name="Matte Grow / Shrink",
            description="Expand (dilate) or contract (erode) a mask, with optional feather.",
            category="image/mask",
            inputs=[
                IO.Mask.Input("mask"),
                IO.Float.Input(
                    "amount",
                    default=0.0,
                    min=-50.0,
                    max=50.0,
                    step=1.0,
                    tooltip="Pixels to grow (+) or shrink (-) the mask.",
                ),
                IO.Float.Input(
                    "feather",
                    default=0.0,
                    min=0.0,
                    max=30.0,
                    step=0.5,
                    tooltip="Soften the mask edge after grow/shrink (gaussian blur radius).",
                ),
            ],
            outputs=[
                IO.Mask.Output(display_name="mask"),
            ],
            hidden=[IO.Hidden.unique_id],
            is_output_node=True,
        )

    @classmethod
    def execute(cls, mask, amount, feather) -> IO.NodeOutput:
        m = _ensure_bhw(mask).clamp(0.0, 1.0)
        if amount != 0.0:
            k = abs(int(round(amount))) * 2 + 1
            m4 = m.unsqueeze(1)  # [B, 1, H, W]
            if amount > 0:
                # Dilation == max pool
                m4 = F.max_pool2d(m4, kernel_size=k, stride=1, padding=k // 2)
            else:
                # Erosion == -max_pool(-x)
                m4 = -F.max_pool2d(-m4, kernel_size=k, stride=1, padding=k // 2)
            m = m4.squeeze(1)
        if feather > 0.0:
            m4 = m.unsqueeze(1)
            ksize = 2 * ceil(3.0 * feather) + 1
            m4 = gaussian_blur(m4, kernel_size=ksize, sigma=feather)
            m = m4.squeeze(1)
        m = m.clamp(0.0, 1.0)
        # Preview the mask as a grayscale image so the node preview pane shows it.
        preview = m.unsqueeze(-1).expand(-1, -1, -1, 3)
        return IO.NodeOutput(m, ui=save_live_preview(preview, str(cls.hidden.unique_id)))


class MergeAlphaNode(IO.ComfyNode):
    @classmethod
    def define_schema(cls):
        return IO.Schema(
            node_id="MergeAlpha",
            display_name="Merge Alpha",
            description="Combine an image with a mask into an RGBA image.",
            category="image/mask",
            inputs=[
                IO.Image.Input("image"),
                IO.Mask.Input("mask"),
                IO.Boolean.Input("invert_mask", default=False,
                                tooltip="Use 1 - mask as the alpha channel."),
            ],
            outputs=[
                IO.Image.Output(display_name="image"),
            ],
            hidden=[IO.Hidden.unique_id],
            is_output_node=True,
        )

    @classmethod
    def execute(cls, image, mask, invert_mask) -> IO.NodeOutput:
        # image: [B, H, W, 3] in [0,1]
        # mask:  [B, H, W]   in [0,1]
        m = _ensure_bhw(mask)
        if m.shape[1:3] != image.shape[1:3]:
            m4 = m.unsqueeze(1)
            m4 = F.interpolate(m4, size=image.shape[1:3], mode="bilinear", align_corners=False)
            m = m4.squeeze(1)
        m = m.clamp(0.0, 1.0)
        if invert_mask:
            m = 1.0 - m
        # Drop any pre-existing alpha on input so we end up with exactly 4 channels.
        rgb = image[..., :3]
        rgba = torch.cat([rgb, m.unsqueeze(-1)], dim=-1).clamp(0.0, 1.0)
        # For the preview we render the rgb premultiplied by alpha on black, so the
        # transparency reads visually even when the live-preview viewer doesn't
        # composite over a checkerboard.
        preview = (rgb * m.unsqueeze(-1)).clamp(0.0, 1.0)
        return IO.NodeOutput(rgba, ui=save_live_preview(preview, str(cls.hidden.unique_id)))


class MatteExtension(ComfyExtension):
    @override
    async def get_node_list(self) -> list[type[IO.ComfyNode]]:
        return [MatteGrowShrinkNode, MergeAlphaNode]


async def comfy_entrypoint() -> MatteExtension:
    return MatteExtension()
