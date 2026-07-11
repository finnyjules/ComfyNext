"""KineticTypeNode — animated typography render node.

The "Kinetic Typography" widget (frontend) uses GSAP SplitText to animate
text char-by-char, bakes each frame to Canvas2D → PNG, and uploads the
batch via /upload/image. This node loads the frame sequence back as an
IMAGE batch so the animation flows into the graph / Timeline.

State arrives as a single JSON `params` string the widget owns:
  { text, presetId, fontId, axes, color, bg, duration, stagger, ease,
    fps, rendered: string[] }
We only need `rendered` (the uploaded filenames) for execution; the rest is
there for persistence / reproducibility and round-trips untouched.

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
    """A tiny transparent placeholder when nothing has been rendered yet."""
    img = torch.zeros(1, h, w, 3)
    mask = torch.ones(1, h, w)
    return img, mask


def _load_frame(filename: str):
    """Load a single uploaded PNG → (IMAGE [H,W,3], MASK [H,W])."""
    path = folder_paths.get_annotated_filepath(filename)
    img = Image.open(path)
    img = ImageOps.exif_transpose(img)

    if "A" in img.getbands():
        alpha = np.array(img.getchannel("A")).astype(np.float32) / 255.0
        mask = 1.0 - torch.from_numpy(alpha)
    else:
        mask = torch.zeros(img.height, img.width, dtype=torch.float32)

    rgb = np.array(img.convert("RGB")).astype(np.float32) / 255.0
    image = torch.from_numpy(rgb)
    return image, mask


class KineticTypeNode(IO.ComfyNode):
    @classmethod
    def define_schema(cls):
        return IO.Schema(
            node_id="KineticType",
            display_name="Kinetic Typography",
            category="image/type",
            description=(
                "Animated text — type a word, pick a motion preset "
                "(stagger, wave, scramble, elastic...), and get a frame "
                "sequence. GSAP-powered, local render, no AI, no cost."
            ),
            inputs=[
                IO.String.Input(
                    "params",
                    default="{}",
                    multiline=False,
                    extra_dict={"sailor_widget": "kinetic_type"},
                    tooltip="Kinetic typography state (managed by the widget).",
                ),
            ],
            outputs=[
                IO.Image.Output(display_name="frames"),
                IO.Mask.Output(display_name="masks"),
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
        if not rendered or not isinstance(rendered, list) or len(rendered) == 0:
            img, mask = _blank()
            return IO.NodeOutput(img, mask)

        images = []
        masks = []
        for filename in rendered:
            try:
                img, msk = _load_frame(str(filename))
                images.append(img)
                masks.append(msk)
            except Exception:  # noqa: BLE001
                continue  # skip broken frames

        if not images:
            img, mask = _blank()
            return IO.NodeOutput(img, mask)

        # Stack into batches: [N, H, W, 3] and [N, H, W]
        image_batch = torch.stack(images, dim=0)
        mask_batch = torch.stack(masks, dim=0)

        return IO.NodeOutput(image_batch, mask_batch)


class KineticTypeExtension(ComfyExtension):
    @override
    async def get_node_list(self) -> list[type[IO.ComfyNode]]:
        return [KineticTypeNode]


async def comfy_entrypoint() -> KineticTypeExtension:
    return KineticTypeExtension()
