from __future__ import annotations

from typing_extensions import override

from comfy_api.latest import ComfyExtension, IO
from comfy_extras._live_preview import save_live_preview


class AdjustExposureNode(IO.ComfyNode):
    @classmethod
    def define_schema(cls):
        return IO.Schema(
            node_id="AdjustExposure",
            display_name="Exposure",
            description="Shift image exposure in stops (EV).",
            category="image/color",
            inputs=[
                IO.Image.Input("image"),
                IO.Float.Input(
                    "exposure",
                    default=0.0,
                    min=-3.0,
                    max=3.0,
                    step=0.1,
                    tooltip="Exposure in stops. +1 EV doubles brightness, -1 EV halves it.",
                ),
            ],
            outputs=[
                IO.Image.Output(display_name="image"),
            ],
            hidden=[IO.Hidden.unique_id],
            is_output_node=True,
        )

    @classmethod
    def execute(cls, image, exposure) -> IO.NodeOutput:
        if exposure == 0.0:
            x = image.clamp(0.0, 1.0)
        else:
            x = (image * (2.0 ** exposure)).clamp(0.0, 1.0)
        return IO.NodeOutput(x, ui=save_live_preview(x, str(cls.hidden.unique_id)))


class AdjustExposureExtension(ComfyExtension):
    @override
    async def get_node_list(self) -> list[type[IO.ComfyNode]]:
        return [AdjustExposureNode]


async def comfy_entrypoint() -> AdjustExposureExtension:
    return AdjustExposureExtension()
