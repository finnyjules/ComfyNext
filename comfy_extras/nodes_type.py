"""RenderType — local typography render node. RETIRED 2026-07-27.

Superseded by the Vector Type Studio (`VectorType`), which sets the same
variable families as real outlines. Its toolbox entry and its frontend widget
(`WidgetFontPlayground.vue`) are gone, so no new RenderType node can be created.
The node itself is kept one release so that any workflow saved outside the
projects store still loads and still resolves its already-baked PNG; it can be
deleted after that. Zero RenderType nodes were found across the 380 saved
project documents on disk when the widget was retired.

The (now-deleted) "Font Playground" widget rasterized a variable-font word to a
PNG client-side and uploaded it via /upload/image. This node just loads that
PNG back as an IMAGE (+ MASK from its alpha) so the type flows into the graph
like any other image — no AI, no cost.

State arrives as a single JSON `params` string the widget owns:
  { fontId, text, size, color, bg, axes, rendered, w, h }
We only need `rendered` (the uploaded filename) for execution; the rest is
there for persistence / reproducibility and round-trips untouched.

Auto-discovered by ComfyUI via `comfy_entrypoint()`, same as nodes_compositor.
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
    """A tiny transparent placeholder when nothing has been rendered yet."""
    img = torch.zeros(1, h, w, 3)
    mask = torch.ones(1, h, w)  # MASK = 1 - alpha; fully transparent → all 1
    return img, mask


def _load_rendered(filename: str):
    """Load an uploaded PNG → (IMAGE [1,H,W,3], MASK [1,H,W]). MASK is 1-alpha,
    matching ComfyUI's LoadImage convention so it composites correctly."""
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


class RenderTypeNode(IO.ComfyNode):
    @classmethod
    def define_schema(cls):
        return IO.Schema(
            node_id="RenderType",
            display_name="Font Playground",
            category="image/type",
            description=(
                "Render a word in a real variable font — drag weight, width, "
                "slant and other axes live, then it bakes to a crisp image. "
                "Local render, no AI, no cost."
            ),
            inputs=[
                # The whole playground state. Hidden from the normal widget
                # chain — the font_playground widget owns the entire UI.
                IO.String.Input(
                    "params",
                    default="{}",
                    multiline=False,
                    extra_dict={"sailor_widget": "font_playground"},
                    tooltip="Font playground state (managed by the widget).",
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
        except Exception as e:  # noqa: BLE001 — surface a clear message, don't crash the graph
            raise RuntimeError(
                f"Font Playground couldn't load its rendered image {rendered!r}: {e}. "
                f"Try nudging a slider to re-bake."
            )
        return IO.NodeOutput(img, mask)


class RenderTypeExtension(ComfyExtension):
    @override
    async def get_node_list(self) -> list[type[IO.ComfyNode]]:
        return [RenderTypeNode]


async def comfy_entrypoint() -> RenderTypeExtension:
    return RenderTypeExtension()
