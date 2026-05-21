from __future__ import annotations

from typing_extensions import override

from comfy_api.latest import ComfyExtension, IO
from comfy_extras._live_preview import save_live_preview


class AdjustLevelsNode(IO.ComfyNode):
    @classmethod
    def define_schema(cls):
        return IO.Schema(
            node_id="AdjustLevels",
            display_name="Levels",
            description="Remap input tonal range with black point, gamma, and white point.",
            category="image/color",
            inputs=[
                IO.Image.Input("image"),
                IO.Float.Input(
                    "black",
                    default=0.0,
                    min=0.0,
                    max=1.0,
                    step=0.01,
                    tooltip="Input black point. Pixels below this are clipped to black.",
                ),
                IO.Float.Input(
                    "gamma",
                    default=1.0,
                    min=0.2,
                    max=1.8,
                    step=0.05,
                    tooltip="Midtone gamma. Above 1 brightens midtones, below 1 darkens them.",
                ),
                IO.Float.Input(
                    "white",
                    default=1.0,
                    min=0.0,
                    max=1.0,
                    step=0.01,
                    tooltip="Input white point. Pixels above this are clipped to white.",
                ),
            ],
            outputs=[
                IO.Image.Output(display_name="image"),
            ],
            hidden=[IO.Hidden.unique_id],
            is_output_node=True,
        )

    @classmethod
    def execute(cls, image, black, gamma, white) -> IO.NodeOutput:
        # Guard against zero-width input range.
        in_white = max(white, black + 1e-6)
        x = ((image - black) / (in_white - black)).clamp(0.0, 1.0)
        if gamma != 1.0:
            x = x.pow(1.0 / gamma)
        x = x.clamp(0.0, 1.0)
        return IO.NodeOutput(x, ui=save_live_preview(x, str(cls.hidden.unique_id)))


class AdjustLevelsExtension(ComfyExtension):
    @override
    async def get_node_list(self) -> list[type[IO.ComfyNode]]:
        return [AdjustLevelsNode]


async def comfy_entrypoint() -> AdjustLevelsExtension:
    return AdjustLevelsExtension()
