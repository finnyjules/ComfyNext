from __future__ import annotations

"""Relight node — re-light an image via nano-banana-2.

Standard API node (no custom Vue renderer). One wired IMAGE input plus a light
gimbal widget ({azimuth, elevation, intensity}), a preset combo, a keep_background
toggle, an optional reference IMAGE whose lighting to match, and free-text refine.
All controls compile into one director's-note prompt — the widget IS the prompt,
the same pattern as the Rotate camera node. When the image is missing it passes a
tiny blank through (no API call).
"""

import json

import torch
from typing_extensions import override

from comfy_api.latest import ComfyExtension, IO
from comfy_extras._live_preview import save_live_preview
from comfy_extras._relight_prompts import PRESETS, relight_instruction


class RelightNode(IO.ComfyNode):
    @classmethod
    def define_schema(cls):
        return IO.Schema(
            node_id="RelightNode",
            display_name="Relight",
            description=(
                "Re-light an image via Nano Banana 2. Aim the light with the gimbal, "
                "set its intensity, optionally pick a preset look or wire a reference "
                "photo to match its lighting. The widget IS the prompt — no typing "
                "needed. ~$0.05 per render."
            ),
            category="api node/image/Replicate",
            inputs=[
                IO.Image.Input("image", tooltip="The image to relight."),
                IO.Combo.Input("preset", options=PRESETS, default="Custom",
                               tooltip="A starting lighting look. 'Custom' uses only the gimbal (neutral white light)."),
                # JSON string {"azimuth":N,"elevation":N,"intensity":0..1} driven by
                # the light_gimbal widget. Required so ComfyUI auto-instantiates it.
                IO.String.Input(
                    "light",
                    default='{"azimuth":-30,"elevation":20,"intensity":0.6}',
                    multiline=False,
                    extra_dict={"comfynext_widget": "light_gimbal"},
                    tooltip="Light direction + intensity. Edited via the gimbal widget.",
                ),
                IO.Boolean.Input("keep_background", default=True, optional=True,
                                 tooltip="On: keep the scene, change only the lighting. Off: let the new light define a new environment."),
                IO.Image.Input("reference", optional=True,
                               tooltip="Optional: a photo whose lighting direction, quality and colour temperature to match."),
                IO.String.Input("instructions", multiline=True, default="", optional=True,
                                tooltip="Optional extra direction to refine the relight."),
                IO.Int.Input("seed", default=0, min=0, max=0xFFFFFFFF,
                             control_after_generate=True, tooltip="0 = random."),
            ],
            outputs=[IO.Image.Output(display_name="image")],
            hidden=[IO.Hidden.unique_id],
            is_output_node=True,
            price_badge=IO.PriceBadge(expr='{"type":"usd","usd":0.05,"format":{"approximate":true}}'),
        )

    @classmethod
    async def execute(cls, image=None, preset="Custom", light="{}", keep_background=True,
                      reference=None, instructions="", seed=0) -> IO.NodeOutput:
        uid = str(cls.hidden.unique_id)

        # Nothing to relight → tiny blank passthrough. No API call.
        if image is None:
            blank = torch.zeros(1, 16, 16, 3)
            return IO.NodeOutput(blank, ui=save_live_preview(blank, uid))

        # Parse the gimbal JSON tolerantly (older workflow / manual edit → defaults).
        try:
            cfg = json.loads(light or "{}")
            if not isinstance(cfg, dict):
                cfg = {}
        except json.JSONDecodeError:
            cfg = {}
        azimuth   = float(cfg.get("azimuth", 0) or 0)
        elevation = float(cfg.get("elevation", 0) or 0)
        intensity = float(cfg.get("intensity", 0.6) or 0.6)

        # Lazy import: avoids comfy_extras/comfy_api_nodes load-order coupling.
        from comfy_api_nodes.nodes_replicate import (
            _run_prediction, _image_tensor_to_data_url,
            _first_output_url, download_url_to_image_tensor,
        )

        image_input = [_image_tensor_to_data_url(image)]
        if reference is not None:
            image_input.append(_image_tensor_to_data_url(reference))

        prompt = relight_instruction(
            preset, azimuth, elevation, intensity,
            bool(keep_background), reference is not None, instructions,
        )
        print(
            f"[Relight] az={azimuth:.1f} el={elevation:.1f} int={intensity:.2f} "
            f"preset={preset!r} keep_bg={bool(keep_background)} ref={reference is not None}",
            flush=True,
        )
        input_dict = {
            "prompt": prompt,
            "image_input": image_input,
            "resolution": "1K",
            "output_format": "png",
        }
        pred = await _run_prediction("google/nano-banana-2", input_dict)
        result = await download_url_to_image_tensor(_first_output_url(pred), cls=cls)
        return IO.NodeOutput(result, ui=save_live_preview(result, uid))


class RelightExtension(ComfyExtension):
    @override
    async def get_node_list(self) -> list[type[IO.ComfyNode]]:
        return [RelightNode]


async def comfy_entrypoint() -> RelightExtension:
    return RelightExtension()
