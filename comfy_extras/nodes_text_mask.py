"""TextMaskNode — use text as a clipping mask for images.

The "Text Mask" widget (frontend) renders text to a Canvas2D as white on
black, uploads the result via /upload/image, and optionally accepts an
upstream IMAGE to clip. This node loads the mask PNG and applies it.

Two outputs:
  - mask: the raw B&W text mask (white = text, black = background)
  - image: the source image clipped to the text shape (RGBA with alpha)

If no source image is connected, the image output is the mask itself as RGB.

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


def _load_mask(filename: str):
    """Load an uploaded mask PNG → MASK [1,H,W]. White = text = 0 (keep),
    black = bg = 1 (transparent), matching ComfyUI's 1-alpha convention."""
    path = folder_paths.get_annotated_filepath(filename)
    img = Image.open(path).convert("L")
    arr = np.array(img).astype(np.float32) / 255.0
    # ComfyUI mask convention: 0 = keep, 1 = remove. Our mask is white-on-black
    # (white = text), so invert: text → 0, bg → 1.
    mask = 1.0 - torch.from_numpy(arr)
    return mask[None,]


class TextMaskNode(IO.ComfyNode):
    @classmethod
    def define_schema(cls):
        return IO.Schema(
            node_id="TextMask",
            display_name="Text Mask",
            category="image/type",
            description=(
                "Use text as a clipping mask — type a word and it becomes "
                "a mask that reveals the image behind it. Font Playground "
                "rendering, local, no cost."
            ),
            inputs=[
                IO.String.Input(
                    "params",
                    default="{}",
                    multiline=False,
                    extra_dict={"comfynext_widget": "text_mask"},
                    tooltip="Text mask state (managed by the widget).",
                ),
                IO.Image.Input(
                    "source",
                    optional=True,
                    tooltip="Image to show through the text. If unconnected, outputs the raw mask.",
                ),
            ],
            outputs=[
                IO.Image.Output(display_name="image"),
                IO.Mask.Output(display_name="mask"),
            ],
        )

    @classmethod
    def execute(cls, params: str = "{}", source=None) -> IO.NodeOutput:
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
            mask = _load_mask(str(rendered))
        except Exception as e:  # noqa: BLE001
            raise RuntimeError(
                f"Text Mask couldn't load its rendered mask {rendered!r}: {e}. "
                f"Try nudging a slider to re-bake."
            )

        # If a source image is connected, apply the mask to clip it
        if source is not None:
            # mask is [1,H,W], source is [B,H,W,3]
            # Resize mask to match source if needed
            _, sh, sw, _ = source.shape
            _, mh, mw = mask.shape
            if mh != sh or mw != sw:
                from torch.nn import functional as F
                mask_resized = F.interpolate(
                    mask.unsqueeze(0), size=(sh, sw), mode="bilinear", align_corners=False
                ).squeeze(0)
            else:
                mask_resized = mask

            # Apply: text pixels (mask=0) → source, bg pixels (mask=1) → black
            alpha = 1.0 - mask_resized  # text=1, bg=0
            image = source * alpha.unsqueeze(-1)
            return IO.NodeOutput(image, mask_resized)

        # No source: output the mask as a grayscale image
        alpha = 1.0 - mask  # text=1, bg=0
        gray_rgb = alpha.unsqueeze(-1).expand(-1, -1, -1, 3)
        return IO.NodeOutput(gray_rgb, mask)


class TextMaskExtension(ComfyExtension):
    @override
    async def get_node_list(self) -> list[type[IO.ComfyNode]]:
        return [TextMaskNode]


async def comfy_entrypoint() -> TextMaskExtension:
    return TextMaskExtension()
