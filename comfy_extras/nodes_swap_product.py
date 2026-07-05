from __future__ import annotations

"""Swap Product node — place a new product into a finished packshot scene.

Standard nano-banana-2 API node (no custom Vue renderer). Two wired IMAGE inputs:
`scene_reference` (a finished packshot whose background, framing, camera and
lighting to keep) and `product` (the new product to drop in — a clean cutout or a
plain photo both work). An optional `instructions` field refines the swap. The
scene look is copied from the reference, so results stay consistent across
products without seed-locking. When a required image is missing, the scene passes
through unchanged (no API call).

Sibling to the Person Swap node; this swaps the product instead of the person.
"""

import torch
from typing_extensions import override

from comfy_api.latest import ComfyExtension, IO
from comfy_extras._live_preview import save_live_preview, save_generation_output
from comfy_extras._swap_product_prompts import swap_product_instruction


class SwapProductNode(IO.ComfyNode):
    @classmethod
    def define_schema(cls):
        return IO.Schema(
            node_id="SwapProductNode",
            display_name="Swap Product",
            description=(
                "Place a new product into a finished packshot scene (Nano Banana 2). "
                "Wire the finished shot as the scene reference and the new product; "
                "keeps the reference's background, framing, camera and lighting, and "
                "reproduces the new product's branding faithfully. ~$0.05 per swap."
            ),
            category="api node/image/Replicate",
            inputs=[
                IO.Image.Input("scene_reference",
                               tooltip="A finished packshot whose background, framing, camera and lighting to keep."),
                IO.Image.Input("product",
                               tooltip="The new product to place into the scene — a clean cutout or a plain photo both work."),
                IO.String.Input("instructions", multiline=True, default="", optional=True,
                                tooltip="Optional extra direction to refine the swap, e.g. \"shift the product slightly left\"."),
            ],
            outputs=[IO.Image.Output(display_name="image")],
            hidden=[IO.Hidden.unique_id],
            is_output_node=True,
            price_badge=IO.PriceBadge(expr='{"type":"usd","usd":0.05,"format":{"approximate":true}}'),
        )

    @classmethod
    async def execute(cls, scene_reference=None, product=None, instructions="") -> IO.NodeOutput:
        uid = str(cls.hidden.unique_id)

        # Missing a required image → pass the scene through (or a tiny blank). No API call.
        if scene_reference is None or product is None:
            if scene_reference is not None:
                return IO.NodeOutput(scene_reference, ui=save_live_preview(scene_reference, uid))
            blank = torch.zeros(1, 16, 16, 3)
            return IO.NodeOutput(blank, ui=save_live_preview(blank, uid))

        # Lazy import: avoids comfy_extras/comfy_api_nodes load-order coupling.
        from comfy_api_nodes.nodes_replicate import (
            _run_prediction, _image_tensor_to_data_url,
            _first_output_url, download_url_to_image_tensor,
        )
        input_dict = {
            "prompt": swap_product_instruction(instructions),
            # Order is load-bearing: [0] = scene reference, [1] = new product.
            "image_input": [
                _image_tensor_to_data_url(scene_reference),
                _image_tensor_to_data_url(product),
            ],
            "resolution": "1K",
            "output_format": "png",
        }
        pred = await _run_prediction("google/nano-banana-2", input_dict)
        result = await download_url_to_image_tensor(_first_output_url(pred), cls=cls)
        # Durable output so the swapped result is recorded as an asset (the
        # passthrough/blank guards above stay temp previews — no asset on a no-op).
        return IO.NodeOutput(result, ui=save_generation_output(result, "swap_product"))


class SwapProductExtension(ComfyExtension):
    @override
    async def get_node_list(self) -> list[type[IO.ComfyNode]]:
        return [SwapProductNode]


async def comfy_entrypoint() -> SwapProductExtension:
    return SwapProductExtension()
