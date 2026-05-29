"""TextOnPathNode — render text along a curve.

The "Text on Path" widget (frontend) renders text along an arc, circle,
wave, or curved line to Canvas2D → PNG, and uploads via /upload/image.
This node loads that PNG as IMAGE + MASK.

Auto-discovered by ComfyUI via `comfy_entrypoint()`.
"""
from __future__ import annotations

import json

import numpy as np
import torch
from PIL import Image, ImageOps
from typing_extensions import override

import folder_paths
from comfy_api.latest import ComfyExtension, IO


def _blank(w: int = 16, h: int = 16):
    img = torch.zeros(1, h, w, 3)
    mask = torch.ones(1, h, w)
    return img, mask


def _load_rendered(filename: str):
    path = folder_paths.get_annotated_filepath(filename)
    img = Image.open(path)
    img = ImageOps.exif_transpose(img)
    if "A" in img.getbands():
        alpha = np.array(img.getchannel("A")).astype(np.float32) / 255.0
        mask = 1.0 - torch.from_numpy(alpha)
    else:
        mask = torch.zeros(img.height, img.width, dtype=torch.float32)
    rgb = np.array(img.convert("RGB")).astype(np.float32) / 255.0
    image = torch.from_numpy(rgb)[None,]
    return image, mask[None,]


class TextOnPathNode(IO.ComfyNode):
    @classmethod
    def define_schema(cls):
        return IO.Schema(
            node_id="TextOnPath",
            display_name="Text on Path",
            category="image/type",
            description=(
                "Render text along an arc, circle, wave, or curve. "
                "Each character follows the path and rotates to match "
                "the tangent. Local render, no AI, no cost."
            ),
            inputs=[
                IO.String.Input(
                    "params",
                    default="{}",
                    multiline=False,
                    extra_dict={"comfynext_widget": "text_on_path"},
                    tooltip="Text-on-path state (managed by the widget).",
                ),
            ],
            outputs=[
                IO.Image.Output(display_name="image"),
                IO.Mask.Output(display_name="mask"),
            ],
        )

    @classmethod
    def execute(cls, params: str = "{}") -> IO.NodeOutput:
        try:
            data = json.loads(params or "{}")
            if not isinstance(data, dict):
                data = {}
        except json.JSONDecodeError:
            data = {}

        rendered = data.get("rendered")
        if not rendered:
            img, mask = _blank()
            return IO.NodeOutput(img, mask)

        try:
            img, mask = _load_rendered(str(rendered))
        except Exception as e:  # noqa: BLE001
            raise RuntimeError(
                f"Text on Path couldn't load rendered image {rendered!r}: {e}. "
                f"Try adjusting a parameter to re-bake."
            )
        return IO.NodeOutput(img, mask)


class TextOnPathExtension(ComfyExtension):
    @override
    async def get_node_list(self) -> list[type[IO.ComfyNode]]:
        return [TextOnPathNode]


async def comfy_entrypoint() -> TextOnPathExtension:
    return TextOnPathExtension()
