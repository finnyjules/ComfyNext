from __future__ import annotations

"""Cloud edit-action nodes — Remove Object, Text Edit, Recolor Object.

Three standard nano-banana-2 API nodes (no custom Vue renderer), siblings of
the Swap Product node. Each takes ONE wired IMAGE plus text widgets and runs a
single instruction edit. When the image or a required string is missing, the
image passes through unchanged (no API call, no charge).

NOT to be confused with the local, mask-input ObjectRemove (LaMa) node in the
Toolbox — these are prompt-driven cloud Actions.
"""

import torch
from typing_extensions import override

from comfy_api.latest import ComfyExtension, IO
from comfy_extras._live_preview import save_live_preview, save_generation_output
from comfy_extras._edit_action_prompts import (
    remove_object_instruction,
    text_edit_instruction,
    recolor_instruction,
)

_PRICE = IO.PriceBadge(expr='{"type":"usd","usd":0.05,"format":{"approximate":true}}')


async def _nano_edit(image, prompt: str, asset_tag: str, cls) -> IO.NodeOutput:
    """Run one nano-banana-2 instruction edit on a single image."""
    # Lazy import: avoids comfy_extras/comfy_api_nodes load-order coupling.
    from comfy_api_nodes.nodes_replicate import (
        _run_prediction, _image_tensor_to_data_url,
        _first_output_url, download_url_to_image_tensor,
    )
    input_dict = {
        "prompt": prompt,
        "image_input": [_image_tensor_to_data_url(image)],
        "resolution": "1K",
        "output_format": "png",
    }
    pred = await _run_prediction("google/nano-banana-2", input_dict)
    result = await download_url_to_image_tensor(_first_output_url(pred), cls=cls)
    # Durable output so the edit is recorded as an asset.
    return IO.NodeOutput(result, ui=save_generation_output(result, asset_tag))


def _passthrough(image, uid: str) -> IO.NodeOutput:
    """No-op guard: return the input (or a tiny blank) as a temp preview."""
    if image is not None:
        return IO.NodeOutput(image, ui=save_live_preview(image, uid))
    blank = torch.zeros(1, 16, 16, 3)
    return IO.NodeOutput(blank, ui=save_live_preview(blank, uid))


class RemoveObjectNode(IO.ComfyNode):
    @classmethod
    def define_schema(cls):
        return IO.Schema(
            node_id="RemoveObjectNode",
            display_name="Remove Object",
            description=(
                "Erase a described object and seamlessly fill the hole from the "
                "surrounding scene (Nano Banana 2). Describe what to remove — "
                "no mask needed. ~$0.05 per edit."
            ),
            category="api node/image/Replicate",
            inputs=[
                IO.Image.Input("image", tooltip="The image to edit."),
                IO.String.Input("target", multiline=False, default="",
                                tooltip="What to remove, e.g. \"the red car on the left\"."),
                IO.String.Input("instructions", multiline=True, default="", optional=True,
                                tooltip="Optional extra direction, e.g. \"match the brick texture\"."),
            ],
            outputs=[IO.Image.Output(display_name="image")],
            hidden=[IO.Hidden.unique_id],
            is_output_node=True,
            price_badge=_PRICE,
        )

    @classmethod
    async def execute(cls, image=None, target="", instructions="") -> IO.NodeOutput:
        uid = str(cls.hidden.unique_id)
        if image is None or not (target or "").strip():
            return _passthrough(image, uid)
        return await _nano_edit(image, remove_object_instruction(target, instructions), "remove_object", cls)


class TextEditNode(IO.ComfyNode):
    @classmethod
    def define_schema(cls):
        return IO.Schema(
            node_id="TextEditNode",
            display_name="Edit Text",
            description=(
                "Find and replace rendered text inside the image (Nano Banana 2), "
                "matching the original font, colour, perspective and lighting. "
                "~$0.05 per edit."
            ),
            category="api node/image/Replicate",
            inputs=[
                IO.Image.Input("image", tooltip="The image containing the text."),
                IO.String.Input("find", multiline=False, default="",
                                tooltip="The exact text currently in the image, e.g. \"SALE\"."),
                IO.String.Input("replace", multiline=False, default="",
                                tooltip="The new text, e.g. \"50% OFF\"."),
                IO.String.Input("instructions", multiline=True, default="", optional=True,
                                tooltip="Optional extra direction, e.g. \"keep the neon glow\"."),
            ],
            outputs=[IO.Image.Output(display_name="image")],
            hidden=[IO.Hidden.unique_id],
            is_output_node=True,
            price_badge=_PRICE,
        )

    @classmethod
    async def execute(cls, image=None, find="", replace="", instructions="") -> IO.NodeOutput:
        uid = str(cls.hidden.unique_id)
        if image is None or not (find or "").strip() or not (replace or "").strip():
            return _passthrough(image, uid)
        return await _nano_edit(image, text_edit_instruction(find, replace, instructions), "text_edit", cls)


class RecolorObjectNode(IO.ComfyNode):
    @classmethod
    def define_schema(cls):
        return IO.Schema(
            node_id="RecolorObjectNode",
            display_name="Recolor Object",
            description=(
                "Change a described object's colour while keeping its material, "
                "texture and the scene's lighting (Nano Banana 2). The color "
                "input is variable-bindable for campaign batches. ~$0.05 per edit."
            ),
            category="api node/image/Replicate",
            inputs=[
                IO.Image.Input("image", tooltip="The image to edit."),
                IO.String.Input("target", multiline=False, default="",
                                tooltip="What to recolor, e.g. \"the shirt\"."),
                IO.String.Input("color", multiline=False, default="",
                                tooltip="The new colour — a name, hex, or both, e.g. \"forest green (#2d6a4f)\"."),
                IO.String.Input("instructions", multiline=True, default="", optional=True,
                                tooltip="Optional extra direction, e.g. \"matte finish\"."),
            ],
            outputs=[IO.Image.Output(display_name="image")],
            hidden=[IO.Hidden.unique_id],
            is_output_node=True,
            price_badge=_PRICE,
        )

    @classmethod
    async def execute(cls, image=None, target="", color="", instructions="") -> IO.NodeOutput:
        uid = str(cls.hidden.unique_id)
        if image is None or not (target or "").strip() or not (color or "").strip():
            return _passthrough(image, uid)
        return await _nano_edit(image, recolor_instruction(target, color, instructions), "recolor_object", cls)


class EditActionsExtension(ComfyExtension):
    @override
    async def get_node_list(self) -> list[type[IO.ComfyNode]]:
        return [RemoveObjectNode, TextEditNode, RecolorObjectNode]


async def comfy_entrypoint() -> EditActionsExtension:
    return EditActionsExtension()
