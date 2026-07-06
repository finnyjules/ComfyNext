from __future__ import annotations

"""Swap Background node — lock a product, change the environment.

The inverse of Swap Product: keeps the product exact and swaps the scene behind
it. A wired `background_reference` image wins; otherwise a `scene_prompt` text
describes a new scene to generate. Three toggles (relight / shadow / keep
placement) shape the composite. Nano Banana 2. When there is nothing to change
the background to (no reference and no prompt), the product passes through.

Sibling to nodes_swap_product.py.
"""

import torch
from typing_extensions import override

from comfy_api.latest import ComfyExtension, IO
from comfy_extras._live_preview import save_live_preview, save_generation_output
from comfy_extras._swap_background_prompts import build_swap_background_instruction


class SwapBackgroundNode(IO.ComfyNode):
    @classmethod
    def define_schema(cls):
        return IO.Schema(
            node_id="SwapBackgroundNode",
            display_name="Swap Background",
            description=(
                "Lock the product, change the background (Nano Banana 2). Wire a "
                "background reference image, or type a scene to generate one. "
                "Toggles: relight the product to the new scene, ground it with a "
                "contact shadow, and keep its scale/placement for batch "
                "consistency. Branding stays pixel-faithful. ~$0.05 per swap."
            ),
            category="api node/image/Replicate",
            inputs=[
                IO.Image.Input("product", tooltip="The product to keep. Its branding stays exact."),
                IO.Image.Input("background_reference", optional=True,
                               tooltip="A scene/backdrop photo to place the product into. Wins over the scene prompt."),
                IO.String.Input("scene_prompt", multiline=True, default="", optional=True,
                                tooltip="Describe a new background to generate when no reference is wired, e.g. 'marble bathroom counter, soft morning light'."),
                IO.Boolean.Input("relight_to_scene", default=True,
                                 tooltip="On: relight the product to the new scene. Off: keep the product's original lighting, only change what's behind it."),
                IO.Boolean.Input("ground_with_shadow", default=True,
                                 tooltip="On: add a contact shadow/reflection so it sits on the surface. Off: clean float (good for gradient/abstract backdrops)."),
                IO.Boolean.Input("keep_scale_and_placement", default=True,
                                 tooltip="On: keep the product the same size and position (consistent across a product line). Off: let the model compose it into the scene."),
                IO.String.Input("instructions", multiline=True, default="", optional=True,
                                tooltip="Optional extra direction, appended to the instruction."),
            ],
            outputs=[IO.Image.Output(display_name="image")],
            hidden=[IO.Hidden.unique_id],
            is_output_node=True,
            price_badge=IO.PriceBadge(expr='{"type":"usd","usd":0.05,"format":{"approximate":true}}'),
        )

    @classmethod
    async def execute(cls, product=None, background_reference=None, scene_prompt="",
                      relight_to_scene=True, ground_with_shadow=True,
                      keep_scale_and_placement=True, instructions="") -> IO.NodeOutput:
        uid = str(cls.hidden.unique_id)

        # No product → tiny blank. No API call.
        if product is None:
            blank = torch.zeros(1, 16, 16, 3)
            return IO.NodeOutput(blank, ui=save_live_preview(blank, uid))

        has_reference = background_reference is not None
        # Nothing to change the background to → pass the product through unchanged.
        if not has_reference and not (scene_prompt or "").strip():
            return IO.NodeOutput(product, ui=save_live_preview(product, uid))

        # Lazy import: avoids comfy_extras/comfy_api_nodes load-order coupling.
        from comfy_api_nodes.nodes_replicate import (
            _run_prediction, _image_tensor_to_data_url,
            _first_output_url, download_url_to_image_tensor,
        )
        prompt = build_swap_background_instruction(
            has_reference, scene_prompt, bool(relight_to_scene),
            bool(ground_with_shadow), bool(keep_scale_and_placement), instructions,
        )
        # Reference mode: [background, product] (order matches the prompt's
        # "first image / second image" framing). Prompt mode: [product] only.
        if has_reference:
            image_input = [
                _image_tensor_to_data_url(background_reference),
                _image_tensor_to_data_url(product),
            ]
        else:
            image_input = [_image_tensor_to_data_url(product)]
        input_dict = {
            "prompt": prompt,
            "image_input": image_input,
            "resolution": "1K",
            "output_format": "png",
        }
        pred = await _run_prediction("google/nano-banana-2", input_dict)
        result = await download_url_to_image_tensor(_first_output_url(pred), cls=cls)
        return IO.NodeOutput(result, ui=save_generation_output(result, "swap_background"))


class SwapBackgroundExtension(ComfyExtension):
    @override
    async def get_node_list(self) -> list[type[IO.ComfyNode]]:
        return [SwapBackgroundNode]


async def comfy_entrypoint() -> SwapBackgroundExtension:
    return SwapBackgroundExtension()
