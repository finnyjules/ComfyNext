from __future__ import annotations

import math

import torch
import torch.nn.functional as F
from typing_extensions import override

from comfy_api.latest import ComfyExtension, IO
from comfy_extras._live_preview import save_live_preview


def _base_grid(shape, device, dtype):
    b, c, h, w = shape
    yy, xx = torch.meshgrid(
        torch.linspace(-1.0, 1.0, h, device=device, dtype=dtype),
        torch.linspace(-1.0, 1.0, w, device=device, dtype=dtype),
        indexing="ij",
    )
    return xx, yy  # each [H, W]


def _sample(t: torch.Tensor, gx: torch.Tensor, gy: torch.Tensor) -> torch.Tensor:
    grid = torch.stack([gx, gy], dim=-1).unsqueeze(0).expand(t.shape[0], -1, -1, -1)
    return F.grid_sample(t, grid, mode="bilinear", padding_mode="border", align_corners=False)


class PinchNode(IO.ComfyNode):
    @classmethod
    def define_schema(cls):
        return IO.Schema(
            node_id="Pinch",
            display_name="Pinch / Spherize",
            description="Bulge or pinch the image around its center.",
            category="image/distortion",
            inputs=[
                IO.Image.Input("image"),
                IO.Float.Input("amount", default=0.0, min=-1.0, max=1.0, step=0.01,
                              tooltip="Negative = pinch, positive = bulge."),
            ],
            outputs=[IO.Image.Output(display_name="image")],
            hidden=[IO.Hidden.unique_id],
            is_output_node=True,
        )

    @classmethod
    def execute(cls, image, amount) -> IO.NodeOutput:
        if amount == 0.0:
            x = image.clamp(0.0, 1.0)
        else:
            t = image.permute(0, 3, 1, 2)
            xx, yy = _base_grid(t.shape, t.device, t.dtype)
            r = torch.sqrt(xx * xx + yy * yy).clamp(1e-6, 1.4142)
            # Remap radius via power; amount>0 bulges (sub-linear), amount<0 pinches.
            power = 1.0 + amount  # 0..2
            new_r = r.pow(power)
            scale = (new_r / r).clamp(0.0, 4.0)
            gx, gy = xx * scale, yy * scale
            t = _sample(t, gx, gy)
            x = t.permute(0, 2, 3, 1).clamp(0.0, 1.0)
        return IO.NodeOutput(x, ui=save_live_preview(x, str(cls.hidden.unique_id)))


class TwirlNode(IO.ComfyNode):
    @classmethod
    def define_schema(cls):
        return IO.Schema(
            node_id="Twirl",
            display_name="Twirl",
            description="Rotate pixels around the image center proportionally to distance.",
            category="image/distortion",
            inputs=[
                IO.Image.Input("image"),
                IO.Float.Input("angle", default=0.0, min=-360.0, max=360.0, step=1.0,
                              tooltip="Maximum rotation at the center, in degrees."),
            ],
            outputs=[IO.Image.Output(display_name="image")],
            hidden=[IO.Hidden.unique_id],
            is_output_node=True,
        )

    @classmethod
    def execute(cls, image, angle) -> IO.NodeOutput:
        if angle == 0.0:
            x = image.clamp(0.0, 1.0)
        else:
            t = image.permute(0, 3, 1, 2)
            xx, yy = _base_grid(t.shape, t.device, t.dtype)
            r = torch.sqrt(xx * xx + yy * yy)
            falloff = (1.0 - r.clamp(0.0, 1.0)).pow(2.0)
            theta = math.radians(angle) * falloff
            cos_t = torch.cos(theta)
            sin_t = torch.sin(theta)
            gx = xx * cos_t - yy * sin_t
            gy = xx * sin_t + yy * cos_t
            t = _sample(t, gx, gy)
            x = t.permute(0, 2, 3, 1).clamp(0.0, 1.0)
        return IO.NodeOutput(x, ui=save_live_preview(x, str(cls.hidden.unique_id)))


class WaveNode(IO.ComfyNode):
    @classmethod
    def define_schema(cls):
        return IO.Schema(
            node_id="Wave",
            display_name="Wave",
            description="Sinusoidal pixel displacement.",
            category="image/distortion",
            inputs=[
                IO.Image.Input("image"),
                IO.Float.Input("amplitude", default=0.0, min=0.0, max=0.2, step=0.005,
                              tooltip="Wave height (fraction of image size)."),
                IO.Float.Input("wavelength", default=0.2, min=0.02, max=1.0, step=0.01,
                              tooltip="Wave period (fraction of image size)."),
                IO.Combo.Input("axis", options=["horizontal", "vertical", "both"], default="horizontal"),
            ],
            outputs=[IO.Image.Output(display_name="image")],
            hidden=[IO.Hidden.unique_id],
            is_output_node=True,
        )

    @classmethod
    def execute(cls, image, amplitude, wavelength, axis) -> IO.NodeOutput:
        if amplitude <= 0.0:
            x = image.clamp(0.0, 1.0)
        else:
            t = image.permute(0, 3, 1, 2)
            xx, yy = _base_grid(t.shape, t.device, t.dtype)
            k = 2.0 * math.pi / max(0.01, wavelength)
            dx = amplitude * torch.sin(k * yy) if axis in ("horizontal", "both") else 0.0
            dy = amplitude * torch.sin(k * xx) if axis in ("vertical", "both") else 0.0
            gx = xx + dx
            gy = yy + dy
            t = _sample(t, gx, gy)
            x = t.permute(0, 2, 3, 1).clamp(0.0, 1.0)
        return IO.NodeOutput(x, ui=save_live_preview(x, str(cls.hidden.unique_id)))


class LensCorrectionNode(IO.ComfyNode):
    @classmethod
    def define_schema(cls):
        return IO.Schema(
            node_id="LensCorrection",
            display_name="Lens Correction",
            description="Barrel ↔ pincushion radial distortion.",
            category="image/distortion",
            inputs=[
                IO.Image.Input("image"),
                IO.Float.Input("distortion", default=0.0, min=-0.5, max=0.5, step=0.01,
                              tooltip="Negative = barrel correction, positive = pincushion."),
            ],
            outputs=[IO.Image.Output(display_name="image")],
            hidden=[IO.Hidden.unique_id],
            is_output_node=True,
        )

    @classmethod
    def execute(cls, image, distortion) -> IO.NodeOutput:
        if distortion == 0.0:
            x = image.clamp(0.0, 1.0)
        else:
            t = image.permute(0, 3, 1, 2)
            xx, yy = _base_grid(t.shape, t.device, t.dtype)
            r2 = xx * xx + yy * yy
            factor = 1.0 + distortion * r2
            gx, gy = xx * factor, yy * factor
            t = _sample(t, gx, gy)
            x = t.permute(0, 2, 3, 1).clamp(0.0, 1.0)
        return IO.NodeOutput(x, ui=save_live_preview(x, str(cls.hidden.unique_id)))


class DistortionExtension(ComfyExtension):
    @override
    async def get_node_list(self) -> list[type[IO.ComfyNode]]:
        return [PinchNode, TwirlNode, WaveNode, LensCorrectionNode]


async def comfy_entrypoint() -> DistortionExtension:
    return DistortionExtension()
