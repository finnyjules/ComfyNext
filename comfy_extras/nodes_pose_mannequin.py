from __future__ import annotations

"""Pose Mannequin node — put a character into a target body pose.

Frontend-first feature (see frontend PoseEditorModal). A `pose_source` input
picks one of three ways to describe the target pose, and execute() branches on it:

  • mannequin (default) → the user poses a 3D artist mannequin in the editor; if
    a baked editor render is present it wins (deterministic, no API cost),
    otherwise Nano Banana 2 redraws the wired character from the normal-map
    conditioning render (pose_cond_image, falling back to mannequin_image).
  • image → a wired `pose_image` reference; Nano Banana 2 copies its body pose
    onto the wired character.
  • prompt → a `pose_prompt` text description; Nano Banana 2 re-poses the
    character from words (single character image, no reference).

The in-editor mannequin path generates instantly via /api/inpaint/pose and
writes the result back onto the node, so most mannequin runs never touch this
execute(); the server-side path exists for graph "Run" parity. When there's
nothing to pose with, the character passes through unchanged.

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
from comfy_extras._pose_prompts import pose_instruction


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
            category="api node/image/Replicate",
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
                IO.Combo.Input("pose_source", options=["mannequin", "image", "prompt"],
                               default="mannequin", optional=True,
                               tooltip="Where the pose comes from: the 3D mannequin, a wired pose image, or a text prompt."),
                IO.Image.Input("pose_image", optional=True,
                               tooltip="A reference image whose body pose to copy (used when pose_source = image)."),
                IO.String.Input("pose_prompt", multiline=True, default="", optional=True,
                                tooltip="Describe the target pose in words (used when pose_source = prompt)."),
            ],
            outputs=[IO.Image.Output(display_name="image")],
            hidden=[IO.Hidden.unique_id],
            is_output_node=True,
            price_badge=IO.PriceBadge(expr='{"type":"usd","usd":0.05,"format":{"approximate":true}}'),
        )

    @classmethod
    async def execute(cls, character=None, prompt="", pose_state="",
                      mannequin_image="", pose_cond_image="", result_image="",
                      pose_source="mannequin", pose_image=None, pose_prompt="") -> IO.NodeOutput:
        uid = str(cls.hidden.unique_id)

        async def _generate(instruction: str, images: list) -> "IO.NodeOutput":
            # Lazy import: avoids comfy_extras/comfy_api_nodes load-order coupling.
            from comfy_api_nodes.nodes_replicate import (
                _run_prediction, _image_tensor_to_data_url,
                _first_output_url, download_url_to_image_tensor,
            )
            input_dict = {
                "prompt": instruction,
                "image_input": [_image_tensor_to_data_url(t) for t in images],
                "resolution": "1K",
                "output_format": "png",
            }
            pred = await _run_prediction("google/nano-banana-2", input_dict)
            result = await download_url_to_image_tensor(_first_output_url(pred), cls=cls)
            return IO.NodeOutput(result, ui=save_live_preview(result, uid))

        # Image mode: re-pose from a wired reference image.
        if pose_source == "image":
            if character is not None and pose_image is not None:
                return await _generate(pose_instruction("image", prompt, ""),
                                       [character, pose_image])

        # Prompt mode: re-pose from a text description (single character image).
        elif pose_source == "prompt":
            if character is not None and (pose_prompt or "").strip():
                return await _generate(pose_instruction("prompt", prompt, pose_prompt),
                                       [character])

        # Mannequin mode (default): baked result wins, else normal-map conditioning.
        else:
            baked = _load_input_image(result_image)
            if baked is not None:
                return IO.NodeOutput(baked, ui=save_live_preview(baked, uid))
            cond = _load_input_image(pose_cond_image) or _load_input_image(mannequin_image)
            if character is not None and cond is not None:
                return await _generate(pose_instruction("mannequin", prompt, ""),
                                       [character, cond])

        # Nothing to pose with — pass the character through (or a tiny blank).
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
