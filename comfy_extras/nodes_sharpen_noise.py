from __future__ import annotations

from math import ceil

import torch
import torch.nn.functional as F
from typing_extensions import override
from torchvision.transforms.functional import gaussian_blur

from comfy_api.latest import ComfyExtension, IO
from comfy_extras._live_preview import save_live_preview


class SharpenNode(IO.ComfyNode):
    @classmethod
    def define_schema(cls):
        return IO.Schema(
            node_id="Sharpen",
            display_name="Sharpen",
            description="Unsharp mask: image + amount * (image - blur).",
            category="image/filter",
            inputs=[
                IO.Image.Input("image"),
                IO.Float.Input("amount", default=0.5, min=0.0, max=4.0, step=0.05),
                IO.Float.Input("radius", default=1.5, min=0.3, max=10.0, step=0.1),
            ],
            outputs=[IO.Image.Output(display_name="image")],
            hidden=[IO.Hidden.unique_id],
            is_output_node=True,
        )

    @classmethod
    def execute(cls, image, amount, radius) -> IO.NodeOutput:
        if amount == 0.0:
            x = image.clamp(0.0, 1.0)
        else:
            x = image.permute(0, 3, 1, 2)
            ksize = 2 * ceil(3.0 * radius) + 1
            blurred = gaussian_blur(x, kernel_size=ksize, sigma=radius)
            x = (x + amount * (x - blurred)).clamp(0.0, 1.0)
            x = x.permute(0, 2, 3, 1)
        return IO.NodeOutput(x, ui=save_live_preview(x, str(cls.hidden.unique_id)))


class AddNoiseNode(IO.ComfyNode):
    @classmethod
    def define_schema(cls):
        return IO.Schema(
            node_id="AddNoise",
            display_name="Add Noise",
            description="Add gaussian or uniform noise to the image.",
            category="image/filter",
            inputs=[
                IO.Image.Input("image"),
                IO.Float.Input("amount", default=0.1, min=0.0, max=1.0, step=0.01),
                IO.Combo.Input("type", options=["gaussian", "uniform"], default="gaussian"),
                IO.Boolean.Input("monochromatic", default=False),
            ],
            outputs=[IO.Image.Output(display_name="image")],
            hidden=[IO.Hidden.unique_id],
            is_output_node=True,
        )

    @classmethod
    def execute(cls, image, amount, type, monochromatic) -> IO.NodeOutput:
        if amount <= 0.0:
            x = image.clamp(0.0, 1.0)
        else:
            shape = list(image.shape)
            if monochromatic:
                shape[-1] = 1
            if type == "uniform":
                noise = (torch.rand(shape, device=image.device, dtype=image.dtype) - 0.5) * 2.0
            else:
                noise = torch.randn(shape, device=image.device, dtype=image.dtype)
            if monochromatic:
                noise = noise.expand_as(image)
            x = (image + amount * 0.5 * noise).clamp(0.0, 1.0)
        return IO.NodeOutput(x, ui=save_live_preview(x, str(cls.hidden.unique_id)))


class DenoiseNode(IO.ComfyNode):
    """Simple separable Gaussian denoise. Edge-preservation is approximate."""
    @classmethod
    def define_schema(cls):
        return IO.Schema(
            node_id="Denoise",
            display_name="Denoise",
            description="Smooth out noise with a gaussian filter.",
            category="image/filter",
            inputs=[
                IO.Image.Input("image"),
                IO.Float.Input("strength", default=0.5, min=0.0, max=5.0, step=0.05,
                              tooltip="Higher = more smoothing."),
            ],
            outputs=[IO.Image.Output(display_name="image")],
            hidden=[IO.Hidden.unique_id],
            is_output_node=True,
        )

    @classmethod
    def execute(cls, image, strength) -> IO.NodeOutput:
        if strength <= 0.0:
            x = image.clamp(0.0, 1.0)
        else:
            x = image.permute(0, 3, 1, 2)
            sigma = strength
            ksize = 2 * ceil(3.0 * sigma) + 1
            x = gaussian_blur(x, kernel_size=ksize, sigma=sigma)
            x = x.permute(0, 2, 3, 1).clamp(0.0, 1.0)
        return IO.NodeOutput(x, ui=save_live_preview(x, str(cls.hidden.unique_id)))


class SharpenNoiseExtension(ComfyExtension):
    @override
    async def get_node_list(self) -> list[type[IO.ComfyNode]]:
        return [SharpenNode, AddNoiseNode, DenoiseNode]


async def comfy_entrypoint() -> SharpenNoiseExtension:
    return SharpenNoiseExtension()
