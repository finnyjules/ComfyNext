"""Object removal via LaMa (Large Mask inpainting, ~196 MB).

LaMa is a Fourier-convolution inpainting model trained on big masks — much
better than diffusion at "remove this clean and leave no hint". The image +
mask flow is identical to ComfyUI's standard inpainting nodes: white in the
mask = inpaint, black = keep.

The session + inpaint loop live in comfy_extras._inpaint, shared with
Lens · 3D Reframe (which fills disocclusion holes the same way).
"""
from __future__ import annotations

from typing_extensions import override

from comfy_api.latest import ComfyExtension, IO
from comfy_extras._live_preview import save_live_preview
from comfy_extras._inpaint import lama_inpaint, lama_ready


class ObjectRemoveNode(IO.ComfyNode):
    """Erase content under the mask and seamlessly fill the hole.

    Works on a single image or a video batch. For video, you typically wire
    a tracked mask (see Subject Mask) so the patched region follows the
    object you want to remove.
    """

    @classmethod
    def define_schema(cls):
        return IO.Schema(
            node_id="ObjectRemove",
            display_name="Object Removal",
            description="LaMa inpainting — clean removal of distractions, watermarks, signs, "
                        "or whole subjects without diffusion-style hallucination.",
            category="image",
            inputs=[
                IO.Image.Input("frames", tooltip="The image or video frames to inpaint."),
                IO.Mask.Input("mask", tooltip="White pixels are the area to erase and regenerate; "
                                              "black pixels are preserved untouched. A single mask is "
                                              "applied to every frame; a mask batch matches the input frame-for-frame."),
                IO.Int.Input("mask_grow", default=4, min=0, max=64, step=1,
                             tooltip="Dilate the mask by this many pixels before inpainting. "
                                     "A small grow (2–8) hides edge halos around the object you're removing — "
                                     "especially if the mask was traced tightly."),
            ],
            outputs=[IO.Image.Output(display_name="frames")],
            hidden=[IO.Hidden.unique_id],
            # Emit the result so the frontend captures it (data.images) — lets the
            # output preview on the node and composite anywhere it's wired (Frame).
            is_output_node=True,
        )

    @classmethod
    def execute(cls, frames, mask, mask_grow) -> IO.NodeOutput:
        if not lama_ready():
            raise RuntimeError(
                "LaMa model not found. Click the Object Removal card in the toolbox "
                "to download it (~196 MB)."
            )
        frames_out = lama_inpaint(frames, mask, grow=int(mask_grow))
        return IO.NodeOutput(
            frames_out,
            ui=save_live_preview(frames_out, str(cls.hidden.unique_id), unique=True),
        )


class ObjectRemoveExtension(ComfyExtension):
    @override
    async def get_node_list(self) -> list[type[IO.ComfyNode]]:
        return [ObjectRemoveNode]


async def comfy_entrypoint() -> ObjectRemoveExtension:
    return ObjectRemoveExtension()
