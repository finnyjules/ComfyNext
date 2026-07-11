from __future__ import annotations

import torch
from typing_extensions import override

from comfy_api.latest import ComfyExtension, IO
from comfy_extras._gradient_map import apply_duotone
from comfy_extras._live_preview import save_live_preview


def _luma(x):
    return 0.2126 * x[..., 0:1] + 0.7152 * x[..., 1:2] + 0.0722 * x[..., 2:3]


class DuotoneNode(IO.ComfyNode):
    @classmethod
    def define_schema(cls):
        return IO.Schema(
            node_id="Duotone",
            display_name="Duotone",
            description="Map luminance to two colours — classic newsprint look. "
                        "Pick a shadow + highlight, or a colour-theory palette.",
            category="image/grading",
            inputs=[
                IO.Image.Input("image"),
                IO.String.Input(
                    "duotone",
                    default='{"shadow":"#1a1a2e","highlight":"#f5f5f5"}',
                    extra_dict={"sailor_widget": "gradient_editor", "gradient_mode": "duotone"},
                    tooltip="Shadow + highlight colours (managed by the palette widget).",
                ),
            ],
            outputs=[IO.Image.Output(display_name="image")],
            hidden=[IO.Hidden.unique_id],
            is_output_node=True,
        )

    @classmethod
    def execute(cls, image, duotone) -> IO.NodeOutput:
        x = apply_duotone(image, duotone)
        return IO.NodeOutput(x, ui=save_live_preview(x, str(cls.hidden.unique_id)))


class SplitToningNode(IO.ComfyNode):
    @classmethod
    def define_schema(cls):
        return IO.Schema(
            node_id="SplitToning",
            display_name="Split Toning",
            description="Tint shadows and highlights with different colors.",
            category="image/grading",
            inputs=[
                IO.Image.Input("image"),
                IO.Float.Input("shadow_r",    default=0.20, min=0.0, max=1.0, step=0.01),
                IO.Float.Input("shadow_g",    default=0.30, min=0.0, max=1.0, step=0.01),
                IO.Float.Input("shadow_b",    default=0.55, min=0.0, max=1.0, step=0.01),
                IO.Float.Input("highlight_r", default=0.90, min=0.0, max=1.0, step=0.01),
                IO.Float.Input("highlight_g", default=0.75, min=0.0, max=1.0, step=0.01),
                IO.Float.Input("highlight_b", default=0.45, min=0.0, max=1.0, step=0.01),
                IO.Float.Input("balance", default=0.0, min=-1.0, max=1.0, step=0.01,
                              tooltip="Shift weighting toward shadows (-) or highlights (+)."),
                IO.Float.Input("intensity", default=0.5, min=0.0, max=1.0, step=0.01),
            ],
            outputs=[IO.Image.Output(display_name="image")],
            hidden=[IO.Hidden.unique_id],
            is_output_node=True,
        )

    @classmethod
    def execute(cls, image, shadow_r, shadow_g, shadow_b,
                highlight_r, highlight_g, highlight_b, balance, intensity) -> IO.NodeOutput:
        l = _luma(image).clamp(0, 1)
        # Bias luma curve by balance: <0 widens shadows, >0 widens highlights.
        shift = (balance + 1.0) * 0.5  # 0..1
        # Soft mask: 0 at shadows, 1 at highlights
        m = l.pow(max(0.1, 1.0 - balance * 0.8) if balance >= 0 else max(0.1, 1.0 + balance * 0.8))
        shadow_tint = torch.tensor([shadow_r, shadow_g, shadow_b], device=image.device, dtype=image.dtype).view(1, 1, 1, 3)
        high_tint = torch.tensor([highlight_r, highlight_g, highlight_b], device=image.device, dtype=image.dtype).view(1, 1, 1, 3)
        tinted = image * (1.0 - m) * shadow_tint * 2.0 + image * m * high_tint * 2.0
        x = (image * (1.0 - intensity) + tinted * intensity).clamp(0, 1)
        return IO.NodeOutput(x, ui=save_live_preview(x, str(cls.hidden.unique_id)))


class GradingExtension(ComfyExtension):
    @override
    async def get_node_list(self) -> list[type[IO.ComfyNode]]:
        return [DuotoneNode, SplitToningNode]


async def comfy_entrypoint() -> GradingExtension:
    return GradingExtension()
