from __future__ import annotations

"""3D Model viewer node — display a GLB mesh from a URL on the canvas.

Wire a `glb_url` (e.g. the output of Hunyuan3D / Hunyuan3D Multi-View) into this
node and the Vue renderer loads the GLB in an interactive Three.js viewer (orbit,
zoom). The node itself is a thin passthrough: it echoes the URL as its output and
as a `ui.text` payload so the frontend (which mirrors ui.text → data.text, like
the Text node) has the URL to load.
"""

from typing_extensions import override

from comfy_api.latest import ComfyExtension, IO


class Model3DNode(IO.ComfyNode):
    @classmethod
    def define_schema(cls):
        return IO.Schema(
            node_id="Model3D",
            display_name="3D Model",
            category="3d",
            description=(
                "Display a 3D model (GLB) from a URL — wire a glb_url (e.g. from "
                "Hunyuan3D or Hunyuan3D Multi-View) and orbit it on the canvas."
            ),
            inputs=[
                IO.String.Input("glb_url", force_input=True, optional=True,
                                tooltip="URL of a .glb mesh (wire from a 3D generator)."),
            ],
            outputs=[IO.String.Output(display_name="glb_url")],
            hidden=[IO.Hidden.unique_id],
            is_output_node=True,
        )

    @classmethod
    def execute(cls, glb_url="") -> IO.NodeOutput:
        url = glb_url or ""
        # ui.text → mirrored onto data.text by the frontend, so the viewer can
        # read the URL to load even when it's the terminal node.
        return IO.NodeOutput(url, ui={"text": [url]})


class Model3DExtension(ComfyExtension):
    @override
    async def get_node_list(self) -> list[type[IO.ComfyNode]]:
        return [Model3DNode]


async def comfy_entrypoint() -> Model3DExtension:
    return Model3DExtension()
