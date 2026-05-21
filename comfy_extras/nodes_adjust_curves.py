from __future__ import annotations

from typing_extensions import override

from comfy_api.latest import ComfyExtension, IO
from comfy_extras._live_preview import save_live_preview


class AdjustCurvesNode(IO.ComfyNode):
    @classmethod
    def define_schema(cls):
        return IO.Schema(
            node_id="AdjustCurves",
            display_name="Curves",
            description="Shape the tone curve with shadow lift, midtone gamma, and highlight gain.",
            category="image/color",
            inputs=[
                IO.Image.Input("image"),
                IO.Float.Input(
                    "blacks",
                    default=0.0,
                    min=-0.5,
                    max=0.5,
                    step=0.01,
                    tooltip="Black point shift. Negative crushes shadows, positive lifts them.",
                ),
                IO.Float.Input(
                    "midtones",
                    default=1.0,
                    min=0.2,
                    max=1.8,
                    step=0.05,
                    tooltip="Midtone gamma. Above 1 brightens midtones, below 1 darkens them.",
                ),
                IO.Float.Input(
                    "whites",
                    default=1.0,
                    min=0.0,
                    max=2.0,
                    step=0.05,
                    tooltip="White point gain. Scales highlights.",
                ),
            ],
            outputs=[
                IO.Image.Output(display_name="image"),
            ],
            hidden=[IO.Hidden.unique_id],
            is_output_node=True,
        )

    @classmethod
    def execute(cls, image, blacks, midtones, whites) -> IO.NodeOutput:
        x = image
        if blacks != 0.0:
            x = x + blacks
        x = x.clamp(0.0, 1.0)
        if midtones != 1.0:
            x = x.pow(1.0 / midtones)
        if whites != 1.0:
            x = x * whites
        x = x.clamp(0.0, 1.0)
        return IO.NodeOutput(x, ui=save_live_preview(x, str(cls.hidden.unique_id)))


class AdjustCurvesExtension(ComfyExtension):
    @override
    async def get_node_list(self) -> list[type[IO.ComfyNode]]:
        return [AdjustCurvesNode]


async def comfy_entrypoint() -> AdjustCurvesExtension:
    return AdjustCurvesExtension()
