from __future__ import annotations

from typing_extensions import override
from torchvision.transforms.functional import adjust_hue, adjust_saturation, adjust_brightness

from comfy_api.latest import ComfyExtension, IO
from comfy_extras._live_preview import save_live_preview


class AdjustColorNode(IO.ComfyNode):
    @classmethod
    def define_schema(cls):
        return IO.Schema(
            node_id="AdjustColor",
            display_name="Adjust Color",
            description="Shift hue, saturation, and lightness of an image.",
            category="image/color",
            inputs=[
                IO.Image.Input("image"),
                IO.Float.Input(
                    "hue",
                    default=0.0,
                    min=-180.0,
                    max=180.0,
                    step=1.0,
                    tooltip="Hue shift, in degrees",
                ),
                IO.Float.Input(
                    "saturation",
                    default=1.0,
                    min=0.0,
                    max=2.0,
                    step=0.05,
                    tooltip="Saturation multiplier (0 = grayscale, 1 = unchanged)",
                ),
                IO.Float.Input(
                    "lightness",
                    default=1.0,
                    min=0.0,
                    max=2.0,
                    step=0.05,
                    tooltip="Lightness multiplier (0 = black, 1 = unchanged)",
                ),
            ],
            outputs=[
                IO.Image.Output(display_name="image"),
            ],
            hidden=[IO.Hidden.unique_id],
            is_output_node=True,
        )

    @classmethod
    def execute(cls, image, hue, saturation, lightness) -> IO.NodeOutput:
        # ComfyUI images are [B, H, W, C] in [0, 1]; torchvision wants [B, C, H, W].
        x = image.permute(0, 3, 1, 2)
        if hue != 0.0:
            x = adjust_hue(x, hue / 360.0)
        if saturation != 1.0:
            x = adjust_saturation(x, saturation)
        if lightness != 1.0:
            x = adjust_brightness(x, lightness)
        x = x.permute(0, 2, 3, 1).clamp(0.0, 1.0)
        return IO.NodeOutput(x, ui=save_live_preview(x, str(cls.hidden.unique_id)))


class AdjustColorExtension(ComfyExtension):
    @override
    async def get_node_list(self) -> list[type[IO.ComfyNode]]:
        return [AdjustColorNode]


async def comfy_entrypoint() -> AdjustColorExtension:
    return AdjustColorExtension()
