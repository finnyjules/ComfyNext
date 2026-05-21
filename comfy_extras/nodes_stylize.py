from __future__ import annotations

from math import ceil

import torch
import torch.nn.functional as F
from typing_extensions import override
from torchvision.transforms.functional import gaussian_blur

from comfy_api.latest import ComfyExtension, IO
from comfy_extras._live_preview import save_live_preview


class PixelateNode(IO.ComfyNode):
    @classmethod
    def define_schema(cls):
        return IO.Schema(
            node_id="Pixelate",
            display_name="Pixelate",
            description="Reduce the image to blocks of color.",
            category="image/stylize",
            inputs=[
                IO.Image.Input("image"),
                IO.Int.Input("size", default=8, min=1, max=64, step=1,
                            tooltip="Pixel block size."),
            ],
            outputs=[IO.Image.Output(display_name="image")],
            hidden=[IO.Hidden.unique_id],
            is_output_node=True,
        )

    @classmethod
    def execute(cls, image, size) -> IO.NodeOutput:
        n = max(1, int(size))
        if n == 1:
            x = image.clamp(0.0, 1.0)
        else:
            t = image.permute(0, 3, 1, 2)
            _, _, h, w = t.shape
            small = F.interpolate(t, size=(max(1, h // n), max(1, w // n)), mode="area")
            t = F.interpolate(small, size=(h, w), mode="nearest")
            x = t.permute(0, 2, 3, 1).clamp(0.0, 1.0)
        return IO.NodeOutput(x, ui=save_live_preview(x, str(cls.hidden.unique_id)))


class FindEdgesNode(IO.ComfyNode):
    @classmethod
    def define_schema(cls):
        return IO.Schema(
            node_id="FindEdges",
            display_name="Find Edges",
            description="Highlight edges using a Sobel filter.",
            category="image/stylize",
            inputs=[
                IO.Image.Input("image"),
                IO.Float.Input("intensity", default=1.0, min=0.0, max=4.0, step=0.05),
                IO.Boolean.Input("invert", default=False, tooltip="White edges on black instead of black on white."),
            ],
            outputs=[IO.Image.Output(display_name="image")],
            hidden=[IO.Hidden.unique_id],
            is_output_node=True,
        )

    @classmethod
    def execute(cls, image, intensity, invert) -> IO.NodeOutput:
        t = image.permute(0, 3, 1, 2)
        sobel_x = torch.tensor([[-1., 0., 1.], [-2., 0., 2.], [-1., 0., 1.]], device=t.device, dtype=t.dtype).view(1, 1, 3, 3)
        sobel_y = torch.tensor([[-1., -2., -1.], [0., 0., 0.], [1., 2., 1.]], device=t.device, dtype=t.dtype).view(1, 1, 3, 3)
        c = t.shape[1]
        kx = sobel_x.expand(c, 1, 3, 3).contiguous()
        ky = sobel_y.expand(c, 1, 3, 3).contiguous()
        padded = F.pad(t, [1, 1, 1, 1], mode="reflect")
        gx = F.conv2d(padded, kx, groups=c)
        gy = F.conv2d(padded, ky, groups=c)
        edges = torch.sqrt(gx * gx + gy * gy)
        # Convert to luma (broadcast-safe)
        edges = edges.mean(dim=1, keepdim=True)
        edges = (edges * intensity).clamp(0.0, 1.0)
        if invert:
            edges = 1.0 - edges
        out = edges.expand(-1, 3, -1, -1).permute(0, 2, 3, 1)
        return IO.NodeOutput(out, ui=save_live_preview(out, str(cls.hidden.unique_id)))


class EmbossNode(IO.ComfyNode):
    @classmethod
    def define_schema(cls):
        return IO.Schema(
            node_id="Emboss",
            display_name="Emboss",
            description="Render the image as a relief.",
            category="image/stylize",
            inputs=[
                IO.Image.Input("image"),
                IO.Float.Input("depth", default=1.0, min=0.0, max=4.0, step=0.05),
            ],
            outputs=[IO.Image.Output(display_name="image")],
            hidden=[IO.Hidden.unique_id],
            is_output_node=True,
        )

    @classmethod
    def execute(cls, image, depth) -> IO.NodeOutput:
        t = image.permute(0, 3, 1, 2)
        kernel = torch.tensor([[-2., -1., 0.], [-1., 1., 1.], [0., 1., 2.]], device=t.device, dtype=t.dtype).view(1, 1, 3, 3)
        c = t.shape[1]
        k = (kernel * depth).expand(c, 1, 3, 3).contiguous()
        padded = F.pad(t, [1, 1, 1, 1], mode="reflect")
        t = F.conv2d(padded, k, groups=c)
        t = (t + 0.5).clamp(0.0, 1.0)
        x = t.permute(0, 2, 3, 1)
        return IO.NodeOutput(x, ui=save_live_preview(x, str(cls.hidden.unique_id)))


class HighPassNode(IO.ComfyNode):
    @classmethod
    def define_schema(cls):
        return IO.Schema(
            node_id="HighPass",
            display_name="High Pass",
            description="Keep the high-frequency residue after a gaussian blur.",
            category="image/stylize",
            inputs=[
                IO.Image.Input("image"),
                IO.Float.Input("radius", default=3.0, min=0.5, max=30.0, step=0.5),
            ],
            outputs=[IO.Image.Output(display_name="image")],
            hidden=[IO.Hidden.unique_id],
            is_output_node=True,
        )

    @classmethod
    def execute(cls, image, radius) -> IO.NodeOutput:
        t = image.permute(0, 3, 1, 2)
        ksize = 2 * ceil(3.0 * radius) + 1
        blurred = gaussian_blur(t, kernel_size=ksize, sigma=radius)
        t = (t - blurred + 0.5).clamp(0.0, 1.0)
        x = t.permute(0, 2, 3, 1)
        return IO.NodeOutput(x, ui=save_live_preview(x, str(cls.hidden.unique_id)))


class StylizeExtension(ComfyExtension):
    @override
    async def get_node_list(self) -> list[type[IO.ComfyNode]]:
        return [PixelateNode, FindEdgesNode, EmbossNode, HighPassNode]


async def comfy_entrypoint() -> StylizeExtension:
    return StylizeExtension()
