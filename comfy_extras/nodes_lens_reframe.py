from __future__ import annotations

"""Lens · 3D Reframe — re-shoot a photo as if captured on a different lens.

Node 2 of the lens family. Earlier versions reprojected the image through a
monocular-depth estimate, but single-image depth isn't accurate enough for clean
geometry (foreshortened limbs smeared). This version instead hands the job to an
instruction-driven image model (nano-banana-2, the same one the Relight node
uses): pick a real lens and it re-photographs the scene at that lens's
perspective, field of view and compression — coherent, no warp artifacts.

Run-on-demand (NOT auto-rerun): each run is a paid API call. Set source/target
lens + strength, then press Run.
"""

import torch
from typing_extensions import override

from comfy_api.latest import ComfyExtension, IO
from comfy_extras._live_preview import save_live_preview, save_generation_output
from comfy_extras import _lenses


class LensReframeNode(IO.ComfyNode):
    """Re-shoot on a different lens — perspective, FOV and compression, regenerated."""

    @classmethod
    def define_schema(cls):
        return IO.Schema(
            node_id="LensReframe",
            display_name="Lens · 3D Reframe",
            description=(
                "Re-shoot the photo as if taken on a different lens. Pick what it was "
                "shot on and the lens to re-shoot as, and an AI image model "
                "(nano-banana-2) regenerates the scene at that lens's perspective, "
                "field of view and compression. Runs only on Run — each run is a paid "
                "API call."
            ),
            category="image/lens",
            inputs=[
                IO.Image.Input("image", tooltip="The image to re-shoot on a different lens."),
                IO.Combo.Input("source_lens", options=_lenses.NAMES, default="Normal 50mm Planar",
                               tooltip="What it was shot on. Gives the model the starting perspective."),
                IO.Combo.Input("target_lens", options=_lenses.NAMES, default="Portrait 85mm GM",
                               tooltip="Re-shoot as this lens — drives the new perspective + look."),
                IO.Float.Input("reframe_strength", default=1.0, min=0.0, max=1.5, step=0.05,
                               tooltip="How far to push the lens change: subtle → dramatic."),
                IO.Float.Input("custom_focal", default=50.0, min=10.0, max=300.0, step=1.0,
                               tooltip="Focal length (mm) used when a lens is set to Custom."),
            ],
            outputs=[IO.Image.Output(display_name="image")],
            hidden=[IO.Hidden.unique_id],
            is_output_node=True,
        )

    @classmethod
    async def execute(cls, image=None, source_lens="Normal 50mm Planar",
                      target_lens="Portrait 85mm GM", reframe_strength=1.0,
                      custom_focal=50.0) -> IO.NodeOutput:
        uid = str(cls.hidden.unique_id)
        if image is None:
            blank = torch.zeros(1, 16, 16, 3)
            return IO.NodeOutput(blank, ui=save_live_preview(blank, uid))

        from comfy_api_nodes.nodes_replicate import (
            _run_prediction, _image_tensor_to_data_url,
            _first_output_url, download_url_to_image_tensor,
        )

        prompt = _lenses.reframe_instruction(
            source_lens, target_lens, float(reframe_strength), float(custom_focal)
        )
        print(f"[Reframe] {source_lens} → {target_lens} str={reframe_strength:.2f}\n  {prompt}",
              flush=True)

        pred = await _run_prediction("google/nano-banana-2", {
            "prompt": prompt,
            "image_input": [_image_tensor_to_data_url(image)],
            "resolution": "1K",
            "output_format": "png",
        })
        result = await download_url_to_image_tensor(_first_output_url(pred), cls=cls)
        return IO.NodeOutput(result, ui=save_generation_output(result, "reframe"))


class LensReframeExtension(ComfyExtension):
    @override
    async def get_node_list(self) -> list[type[IO.ComfyNode]]:
        return [LensReframeNode]


async def comfy_entrypoint() -> LensReframeExtension:
    return LensReframeExtension()
