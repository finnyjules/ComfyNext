from __future__ import annotations

"""3D Studio node — compose a 3D scene in the fullscreen frontend editor and
bake it to beauty / depth / normal renders.

Frontend-first (see Scene3DStudioSurface.vue): the editor renders the three
passes client-side (Three.js), uploads the PNGs into ComfyUI's input dir, and
stores the filenames in the hidden widgets below. execute() only replays those
files — there is no server-side renderer, so a graph Run reuses the last bake
(same contract as PoseMannequin). With no bake yet, neutral placeholders are
returned so a Run never errors.
"""

import numpy as np
import torch
from PIL import Image, ImageOps
from typing_extensions import override

import folder_paths
from comfy_api.latest import ComfyExtension, IO


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


def _placeholder(width: int = 1024, height: int = 1024,
                 rgb: tuple[float, float, float] = (0.5, 0.5, 0.5)) -> torch.Tensor:
    """Flat-color IMAGE tensor used before the first bake."""
    t = torch.empty(1, height, width, 3)
    t[..., 0], t[..., 1], t[..., 2] = rgb
    return t


class Scene3DStudioNode(IO.ComfyNode):
    @classmethod
    def define_schema(cls):
        return IO.Schema(
            node_id="Scene3DStudio",
            display_name="3D Studio",
            description=(
                "Compose a 3D scene (primitives + imported GLB models) in the "
                "fullscreen editor, then output baked beauty, depth, and normal "
                "renders for img2img / ControlNet conditioning."
            ),
            category="image/3d",
            inputs=[
                # Editor-managed state. Hidden in the custom Vue renderer; declared
                # so the values serialize with the workflow (PoseMannequin pattern).
                IO.String.Input("scene_state", default="", optional=True,
                                tooltip="Serialized scene document (managed by the editor)."),
                IO.String.Input("beauty_image", default="", optional=True,
                                tooltip="Baked beauty render filename (managed by the editor)."),
                IO.String.Input("depth_image", default="", optional=True,
                                tooltip="Baked depth pass filename (managed by the editor)."),
                IO.String.Input("normal_image", default="", optional=True,
                                tooltip="Baked normal pass filename (managed by the editor)."),
                IO.String.Input("glb_url", default="", optional=True,
                                tooltip="Optional GLB model URL to import into the scene (wire from a Model3D node)."),
            ],
            outputs=[
                IO.Image.Output(display_name="beauty"),
                IO.Image.Output(display_name="depth"),
                IO.Image.Output(display_name="normal"),
            ],
        )

    @classmethod
    def execute(cls, scene_state: str = "", beauty_image: str = "", depth_image: str = "",
                normal_image: str = "", glb_url: str = "") -> IO.NodeOutput:
        beauty = _load_input_image(beauty_image)
        depth = _load_input_image(depth_image)
        normal = _load_input_image(normal_image)
        if beauty is None:
            beauty = _placeholder()
        if depth is None:
            depth = _placeholder(rgb=(0.0, 0.0, 0.0))          # far = black
        if normal is None:
            normal = _placeholder(rgb=(0.5, 0.5, 1.0))         # flat +Z normal
        return IO.NodeOutput(beauty, depth, normal)


class Scene3DExtension(ComfyExtension):
    @override
    async def get_node_list(self) -> list[type[IO.ComfyNode]]:
        return [Scene3DStudioNode]


async def comfy_entrypoint() -> Scene3DExtension:
    return Scene3DExtension()
