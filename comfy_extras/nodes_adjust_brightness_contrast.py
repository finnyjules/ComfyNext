from __future__ import annotations

from typing_extensions import override
from torchvision.transforms.functional import adjust_brightness, adjust_contrast

from comfy_api.latest import ComfyExtension, IO
from comfy_extras._live_preview import save_live_preview


class AdjustBrightnessContrastNode(IO.ComfyNode):
    @classmethod
    def define_schema(cls):
        return IO.Schema(
            node_id="AdjustBrightnessContrast",
            display_name="Brightness / Contrast",
            description="Adjust image brightness and contrast.",
            category="image/color",
            inputs=[
                IO.Image.Input("image"),
                IO.Float.Input(
                    "brightness",
                    default=1.0,
                    min=0.0,
                    max=2.0,
                    step=0.05,
                    tooltip="Brightness multiplier (0 = black, 1 = unchanged, 2 = bright)",
                ),
                IO.Float.Input(
                    "contrast",
                    default=1.0,
                    min=0.0,
                    max=2.0,
                    step=0.05,
                    tooltip="Contrast multiplier (0 = solid gray, 1 = unchanged, 2 = high contrast)",
                ),
            ],
            outputs=[
                IO.Image.Output(display_name="image"),
            ],
            hidden=[IO.Hidden.unique_id],
            is_output_node=True,
        )

    @classmethod
    def execute(cls, image, brightness, contrast) -> IO.NodeOutput:
        x = image.permute(0, 3, 1, 2)
        if brightness != 1.0:
            x = adjust_brightness(x, brightness)
        if contrast != 1.0:
            x = adjust_contrast(x, contrast)
        x = x.permute(0, 2, 3, 1).clamp(0.0, 1.0)
        return IO.NodeOutput(x, ui=save_live_preview(x, str(cls.hidden.unique_id)))


class AdjustBrightnessContrastExtension(ComfyExtension):
    @override
    async def get_node_list(self) -> list[type[IO.ComfyNode]]:
        return [AdjustBrightnessContrastNode]


async def comfy_entrypoint() -> AdjustBrightnessContrastExtension:
    return AdjustBrightnessContrastExtension()
