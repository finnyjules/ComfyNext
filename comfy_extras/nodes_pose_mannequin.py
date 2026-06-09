from __future__ import annotations

"""Pose Mannequin node — put a character into a posed-mannequin's body pose.

Frontend-first feature (see frontend PoseEditorModal): the user poses a 3D
artist mannequin, the editor bakes a gray render of it, and Nano Banana 2
redraws the wired character in that pose. The in-editor path generates instantly
via /api/inpaint/pose and writes the result back onto the node, so most runs
never touch this execute(). This server-side path exists for graph "Run" parity:

  • result_image set  → return that baked result (deterministic, no API cost).
  • else character + mannequin_image → generate via Nano Banana 2.
  • else                → pass the character through unchanged.

The mannequin can only be rendered client-side (Three.js), so the editor uploads
it into ComfyUI's input dir and stores the filename here.
"""

import numpy as np
import torch
from PIL import Image, ImageOps
from typing_extensions import override

import folder_paths
from comfy_api.latest import ComfyExtension, IO
from comfy_extras._live_preview import save_live_preview


# Mirrors the BASE_PROMPT in frontend/server/api/inpaint/pose.post.ts so the
# graph path and the in-editor path produce comparable results. The second image
# is a surface-normal render of the posed mannequin (its colours encode which way
# each body part faces — spike showed this nails orientation where a flat gray
# render or depth map are front/back-ambiguous).
_BASE_PROMPT = (
    "The first image is a character. The second image is a SURFACE-NORMAL render of "
    "a posed 3D mannequin: its colours encode the target body pose AND the exact 3D "
    "orientation — which way the body and each limb face. Redraw the EXACT SAME "
    "character from the first image — keep their face, hair, skin tone, body type, "
    "clothing and art style identical — but pose them to match the second image: "
    "limb positions, stance, head angle, AND the whole-body orientation/facing "
    "direction (front, three-quarter, side, or back). If the body is turned or facing "
    "away, turn the character the same way; do NOT default to a front-facing view. "
    "Full body, head to toe, plain neutral studio background, natural and photographic. "
    "Output only the character in that pose, never the normal-map render itself."
)


def _load_input_image(filename: str) -> torch.Tensor | None:
    """Load an image from ComfyUI's input dir (by stored filename) → IMAGE tensor."""
    if not filename:
        return None
    try:
        path = folder_paths.get_annotated_filepath(filename)
        img = ImageOps.exif_transpose(Image.open(path)).convert("RGB")
        arr = np.array(img).astype(np.float32) / 255.0
        return torch.from_numpy(arr)[None,]
    except Exception:
        return None


class PoseMannequinNode(IO.ComfyNode):
    @classmethod
    def define_schema(cls):
        return IO.Schema(
            node_id="PoseMannequin",
            display_name="Pose Mannequin",
            description=(
                "Pose a 3D mannequin, then redraw the connected character in that "
                "pose (Nano Banana 2). Edit the pose in the on-canvas 3D editor."
            ),
            category="image/generate",
            inputs=[
                IO.Image.Input("character", tooltip="The character to re-pose (identity is preserved)."),
                IO.String.Input("prompt", multiline=True, default="", optional=True,
                                tooltip="Optional extra guidance (lighting, outfit notes…)."),
                # Editor-managed state. Hidden in the custom Vue renderer; declared
                # so the values serialize with the workflow.
                IO.String.Input("pose_state", default="", optional=True,
                                tooltip="Serialized 3D joint rotations (managed by the editor)."),
                IO.String.Input("mannequin_image", default="", optional=True,
                                tooltip="Baked gray mannequin render filename, for display (managed by the editor)."),
                IO.String.Input("pose_cond_image", default="", optional=True,
                                tooltip="Baked surface-normal render filename — the generation conditioning (managed by the editor)."),
                IO.String.Input("result_image", default="", optional=True,
                                tooltip="Last generated result filename (managed by the editor)."),
            ],
            outputs=[IO.Image.Output(display_name="image")],
            hidden=[IO.Hidden.unique_id],
            is_output_node=True,
            price_badge=IO.PriceBadge(expr='{"type":"usd","usd":0.05,"format":{"approximate":true}}'),
        )

    @classmethod
    async def execute(cls, character=None, prompt="", pose_state="",
                      mannequin_image="", pose_cond_image="", result_image="") -> IO.NodeOutput:
        uid = str(cls.hidden.unique_id)

        # 1. A baked result from the editor wins — deterministic, no API cost.
        baked = _load_input_image(result_image)
        if baked is not None:
            return IO.NodeOutput(baked, ui=save_live_preview(baked, uid))

        # 2. Generate from character + conditioning via Nano Banana 2. Prefer the
        #    surface-normal render (orientation-accurate); fall back to the gray.
        mannequin = _load_input_image(pose_cond_image) or _load_input_image(mannequin_image)
        if character is not None and mannequin is not None:
            # Lazy import: avoids any comfy_extras/comfy_api_nodes load-order coupling.
            from comfy_api_nodes.nodes_replicate import (
                _run_prediction, _image_tensor_to_data_url,
                _first_output_url, download_url_to_image_tensor,
            )
            extra = (prompt or "").strip()
            instruction = f"{_BASE_PROMPT} Additional direction: {extra}." if extra else _BASE_PROMPT
            input_dict = {
                "prompt": instruction,
                "image_input": [
                    _image_tensor_to_data_url(character),
                    _image_tensor_to_data_url(mannequin),
                ],
                "resolution": "1K",
                "output_format": "png",
            }
            pred = await _run_prediction("google/nano-banana-2", input_dict)
            result = await download_url_to_image_tensor(_first_output_url(pred), cls=cls)
            return IO.NodeOutput(result, ui=save_live_preview(result, uid))

        # 3. Nothing to pose with — pass the character through (or a tiny blank).
        if character is not None:
            return IO.NodeOutput(character, ui=save_live_preview(character, uid))
        blank = torch.zeros(1, 16, 16, 3)
        return IO.NodeOutput(blank, ui=save_live_preview(blank, uid))


class PoseMannequinExtension(ComfyExtension):
    @override
    async def get_node_list(self) -> list[type[IO.ComfyNode]]:
        return [PoseMannequinNode]


async def comfy_entrypoint() -> PoseMannequinExtension:
    return PoseMannequinExtension()
