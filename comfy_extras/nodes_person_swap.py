from __future__ import annotations

"""Person Swap node — replace the person in a scene with a different person.

Standard nano-banana-2 API node (no custom Vue renderer). Two wired IMAGE inputs:
`scene` (the image whose person to replace) and `person` (a reference photo of the
new person). A `keep_outfit` toggle decides whether the original wardrobe is kept
(identity-only swap, the default) or the new person's own clothing is brought in.
The original pose, framing, background and lighting are always preserved. When a
required image is missing, the scene passes through unchanged (no API call).

Sibling to the face-only Face Swap node; this swaps the whole person.
"""

import torch
from typing_extensions import override

from comfy_api.latest import ComfyExtension, IO
from comfy_extras._live_preview import save_live_preview, save_generation_output
from comfy_extras._person_swap_prompts import swap_instruction


class PersonSwapNode(IO.ComfyNode):
    @classmethod
    def define_schema(cls):
        return IO.Schema(
            node_id="PersonSwap",
            display_name="Person Swap",
            description=(
                "Replace the person in a scene with a different person (Nano Banana 2). "
                "Wire the scene and a reference photo of the new person. Keeps the "
                "original pose, framing, background and lighting; the outfit toggle "
                "keeps or replaces the wardrobe."
            ),
            category="api node/image/Replicate",
            inputs=[
                IO.Image.Input("scene", tooltip="The image containing the person to replace."),
                IO.Image.Input("person", tooltip="A reference photo of the new person."),
                IO.Boolean.Input("keep_original_outfit", default=True, optional=True,
                                 tooltip="On: the new person wears the outfit already in the scene (swap identity only). Off: the new person brings their own clothing."),
                IO.String.Input("instructions", multiline=True, default="", optional=True,
                                tooltip="Optional extra direction. Also targets a specific person in a crowd, e.g. \"replace the woman on the left\"."),
            ],
            outputs=[IO.Image.Output(display_name="image")],
            hidden=[IO.Hidden.unique_id],
            is_output_node=True,
            price_badge=IO.PriceBadge(expr='{"type":"usd","usd":0.05,"format":{"approximate":true}}'),
        )

    @classmethod
    async def execute(cls, scene=None, person=None, keep_original_outfit=True, instructions="") -> IO.NodeOutput:
        uid = str(cls.hidden.unique_id)

        # Nothing to swap with → pass the scene through (or a tiny blank). No API call.
        if scene is None or person is None:
            if scene is not None:
                return IO.NodeOutput(scene, ui=save_live_preview(scene, uid))
            blank = torch.zeros(1, 16, 16, 3)
            return IO.NodeOutput(blank, ui=save_live_preview(blank, uid))

        # Lazy import: avoids comfy_extras/comfy_api_nodes load-order coupling.
        from comfy_api_nodes.nodes_replicate import (
            _run_prediction, _image_tensor_to_data_url,
            _first_output_url, download_url_to_image_tensor,
        )
        input_dict = {
            "prompt": swap_instruction(bool(keep_original_outfit), instructions),
            "image_input": [_image_tensor_to_data_url(scene), _image_tensor_to_data_url(person)],
            "resolution": "1K",
            "output_format": "png",
        }
        pred = await _run_prediction("google/nano-banana-2", input_dict)
        result = await download_url_to_image_tensor(_first_output_url(pred), cls=cls)
        # Durable output so the swapped result is recorded as an asset (the
        # passthrough/blank guards above stay temp previews — no asset on a no-op).
        return IO.NodeOutput(result, ui=save_generation_output(result, "person_swap"))


class PersonSwapExtension(ComfyExtension):
    @override
    async def get_node_list(self) -> list[type[IO.ComfyNode]]:
        return [PersonSwapNode]


async def comfy_entrypoint() -> PersonSwapExtension:
    return PersonSwapExtension()
