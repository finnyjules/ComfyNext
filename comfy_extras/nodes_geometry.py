from __future__ import annotations

import math

import torch
import torch.nn.functional as F
from typing_extensions import override

from comfy_api.latest import ComfyExtension, IO
from comfy_extras._live_preview import save_live_preview


class CropNode(IO.ComfyNode):
    @classmethod
    def define_schema(cls):
        return IO.Schema(
            node_id="CropImage",
            display_name="Crop",
            description="Crop by trimming a fraction off each edge.",
            category="image/transform",
            inputs=[
                IO.Image.Input("image"),
                IO.Float.Input("left", default=0.0, min=0.0, max=0.49, step=0.01),
                IO.Float.Input("right", default=0.0, min=0.0, max=0.49, step=0.01),
                IO.Float.Input("top", default=0.0, min=0.0, max=0.49, step=0.01),
                IO.Float.Input("bottom", default=0.0, min=0.0, max=0.49, step=0.01),
            ],
            outputs=[IO.Image.Output(display_name="image")],
            hidden=[IO.Hidden.unique_id],
            is_output_node=True,
        )

    @classmethod
    def execute(cls, image, left, right, top, bottom) -> IO.NodeOutput:
        _, h, w, _ = image.shape
        x0 = int(left * w)
        x1 = max(x0 + 1, int(w - right * w))
        y0 = int(top * h)
        y1 = max(y0 + 1, int(h - bottom * h))
        x = image[:, y0:y1, x0:x1, :].clamp(0.0, 1.0)
        return IO.NodeOutput(x, ui=save_live_preview(x, str(cls.hidden.unique_id)))


class ResizeNode(IO.ComfyNode):
    @classmethod
    def define_schema(cls):
        return IO.Schema(
            node_id="ResizeImage",
            display_name="Resize",
            description="Scale the image by a uniform factor.",
            category="image/transform",
            inputs=[
                IO.Image.Input("image"),
                IO.Float.Input("scale", default=1.0, min=0.1, max=4.0, step=0.05),
                IO.Combo.Input("mode", options=["bilinear", "bicubic", "nearest", "area"], default="bilinear"),
            ],
            outputs=[IO.Image.Output(display_name="image")],
            hidden=[IO.Hidden.unique_id],
            is_output_node=True,
        )

    @classmethod
    def execute(cls, image, scale, mode) -> IO.NodeOutput:
        if scale == 1.0:
            x = image.clamp(0.0, 1.0)
        else:
            t = image.permute(0, 3, 1, 2)
            kwargs = {"scale_factor": scale, "mode": mode}
            if mode in ("bilinear", "bicubic"):
                kwargs["align_corners"] = False
            t = F.interpolate(t, **kwargs)
            x = t.permute(0, 2, 3, 1).clamp(0.0, 1.0)
        return IO.NodeOutput(x, ui=save_live_preview(x, str(cls.hidden.unique_id)))


class RotateNode(IO.ComfyNode):
    @classmethod
    def define_schema(cls):
        return IO.Schema(
            node_id="RotateImage",
            display_name="Rotate",
            description="Rotate the image around its center.",
            category="image/transform",
            inputs=[
                IO.Image.Input("image"),
                IO.Float.Input("angle", default=0.0, min=-180.0, max=180.0, step=1.0),
            ],
            outputs=[IO.Image.Output(display_name="image")],
            hidden=[IO.Hidden.unique_id],
            is_output_node=True,
        )

    @classmethod
    def execute(cls, image, angle) -> IO.NodeOutput:
        if angle == 0.0:
            x = image.clamp(0.0, 1.0)
        else:
            t = image.permute(0, 3, 1, 2)
            rad = math.radians(angle)
            cos_a, sin_a = math.cos(rad), math.sin(rad)
            # Inverse rotation matrix for grid_sample sampling.
            theta = torch.tensor(
                [[cos_a, -sin_a, 0.0], [sin_a, cos_a, 0.0]],
                dtype=t.dtype, device=t.device,
            ).unsqueeze(0).expand(t.shape[0], -1, -1)
            grid = F.affine_grid(theta, t.shape, align_corners=False)
            t = F.grid_sample(t, grid, mode="bilinear", padding_mode="zeros", align_corners=False)
            x = t.permute(0, 2, 3, 1).clamp(0.0, 1.0)
        return IO.NodeOutput(x, ui=save_live_preview(x, str(cls.hidden.unique_id)))


class FlipNode(IO.ComfyNode):
    @classmethod
    def define_schema(cls):
        return IO.Schema(
            node_id="FlipImage",
            display_name="Flip",
            description="Mirror the image horizontally and/or vertically.",
            category="image/transform",
            inputs=[
                IO.Image.Input("image"),
                IO.Boolean.Input("horizontal", default=False),
                IO.Boolean.Input("vertical", default=False),
            ],
            outputs=[IO.Image.Output(display_name="image")],
            hidden=[IO.Hidden.unique_id],
            is_output_node=True,
        )

    @classmethod
    def execute(cls, image, horizontal, vertical) -> IO.NodeOutput:
        x = image
        dims = []
        if vertical:
            dims.append(1)  # H axis
        if horizontal:
            dims.append(2)  # W axis
        if dims:
            x = torch.flip(x, dims=dims)
        x = x.clamp(0.0, 1.0)
        return IO.NodeOutput(x, ui=save_live_preview(x, str(cls.hidden.unique_id)))


class GeometryExtension(ComfyExtension):
    @override
    async def get_node_list(self) -> list[type[IO.ComfyNode]]:
        return [CropNode, ResizeNode, RotateNode, FlipNode]


async def comfy_entrypoint() -> GeometryExtension:
    return GeometryExtension()
