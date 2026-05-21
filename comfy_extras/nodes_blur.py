from __future__ import annotations

import math
from math import ceil

import torch
import torch.nn.functional as F
from typing_extensions import override
from torchvision.transforms.functional import gaussian_blur

from comfy_api.latest import ComfyExtension, IO
from comfy_extras._live_preview import save_live_preview


def _motion_kernel(length: int, angle_deg: float) -> torch.Tensor:
    """Build a normalized line kernel at `angle_deg` with `length` pixels."""
    if length <= 1:
        return torch.tensor([[1.0]]).view(1, 1, 1, 1)
    ksize = length if length % 2 == 1 else length + 1
    kernel = torch.zeros(ksize, ksize)
    center = ksize // 2
    rad = math.radians(angle_deg)
    cos_a, sin_a = math.cos(rad), math.sin(rad)
    n_samples = max(length * 2, 4)
    for i in range(n_samples):
        t = (i / (n_samples - 1)) * length - length / 2.0
        x = center + t * cos_a
        y = center + t * sin_a
        x0, y0 = int(math.floor(x)), int(math.floor(y))
        dx, dy = x - x0, y - y0
        for xi, yi, w in (
            (x0,     y0,     (1 - dx) * (1 - dy)),
            (x0 + 1, y0,     dx       * (1 - dy)),
            (x0,     y0 + 1, (1 - dx) * dy),
            (x0 + 1, y0 + 1, dx       * dy),
        ):
            if 0 <= xi < ksize and 0 <= yi < ksize:
                kernel[yi, xi] += w
    s = kernel.sum()
    if s > 0:
        kernel = kernel / s
    return kernel.unsqueeze(0).unsqueeze(0)


def _gaussian(x: torch.Tensor, radius: float) -> torch.Tensor:
    """Gaussian blur with adaptive downsampling for large radii."""
    scale = max(1, int(radius / 4))
    if scale > 1:
        _, _, h, w = x.shape
        small = F.interpolate(x, scale_factor=1.0 / scale, mode="area")
        sigma = radius / scale
        ksize = 2 * ceil(3.0 * sigma) + 1
        blurred = gaussian_blur(small, kernel_size=ksize, sigma=sigma)
        return F.interpolate(blurred, size=(h, w), mode="bilinear", align_corners=False)
    ksize = 2 * ceil(3.0 * radius) + 1
    return gaussian_blur(x, kernel_size=ksize, sigma=radius)


def _motion(x: torch.Tensor, length: int, angle: float) -> torch.Tensor:
    """Motion blur with adaptive downsampling."""
    scale = max(1, int(length / 8))
    if scale > 1:
        _, _, h, w = x.shape
        small = F.interpolate(x, scale_factor=1.0 / scale, mode="area")
        small_len = max(2, int(round(length / scale)))
        kernel = _motion_kernel(small_len, angle).to(small.device, small.dtype)
        c = small.shape[1]
        kernel = kernel.expand(c, 1, *kernel.shape[-2:]).contiguous()
        pad = kernel.shape[-1] // 2
        small = F.pad(small, [pad] * 4, mode="reflect")
        blurred = F.conv2d(small, kernel, groups=c)
        return F.interpolate(blurred, size=(h, w), mode="bilinear", align_corners=False)
    kernel = _motion_kernel(length, angle).to(x.device, x.dtype)
    c = x.shape[1]
    kernel = kernel.expand(c, 1, *kernel.shape[-2:]).contiguous()
    pad = kernel.shape[-1] // 2
    x = F.pad(x, [pad] * 4, mode="reflect")
    return F.conv2d(x, kernel, groups=c)


def _zoom(x: torch.Tensor, strength: float) -> torch.Tensor:
    """Radial blur via averaged affine-grid samples around image center."""
    n_samples = 12
    max_zoom = 1.0 + strength * 0.4
    out = torch.zeros_like(x)
    for i in range(n_samples):
        t = i / (n_samples - 1)
        s = 1.0 + t * (max_zoom - 1.0)
        theta = torch.tensor(
            [[1.0 / s, 0.0, 0.0], [0.0, 1.0 / s, 0.0]],
            dtype=x.dtype,
            device=x.device,
        ).unsqueeze(0).expand(x.shape[0], -1, -1)
        grid = F.affine_grid(theta, x.shape, align_corners=False)
        out = out + F.grid_sample(x, grid, mode="bilinear", padding_mode="border", align_corners=False)
    return out / n_samples


class BlurNode(IO.ComfyNode):
    @classmethod
    def define_schema(cls):
        return IO.Schema(
            node_id="Blur",
            display_name="Blur",
            description="Gaussian, motion, or zoom blur.",
            category="image/filter",
            inputs=[
                IO.Image.Input("image"),
                IO.Combo.Input(
                    "type",
                    options=["gaussian", "motion", "zoom"],
                    default="gaussian",
                    tooltip="Blur algorithm.",
                ),
                IO.Float.Input(
                    "radius",
                    default=0.0,
                    min=0.0,
                    max=50.0,
                    step=0.5,
                    tooltip="Gaussian blur radius (pixels). Used when type = gaussian.",
                ),
                IO.Float.Input(
                    "angle",
                    default=0.0,
                    min=0.0,
                    max=360.0,
                    step=1.0,
                    tooltip="Motion direction in degrees. Used when type = motion.",
                ),
                IO.Float.Input(
                    "length",
                    default=0.0,
                    min=0.0,
                    max=80.0,
                    step=1.0,
                    tooltip="Motion distance in pixels. Used when type = motion.",
                ),
                IO.Float.Input(
                    "strength",
                    default=0.0,
                    min=0.0,
                    max=1.0,
                    step=0.01,
                    tooltip="Zoom blur strength. Used when type = zoom.",
                ),
            ],
            outputs=[
                IO.Image.Output(display_name="image"),
            ],
            hidden=[IO.Hidden.unique_id],
            is_output_node=True,
        )

    @classmethod
    def execute(cls, image, type, radius, angle, length, strength) -> IO.NodeOutput:
        x = image.permute(0, 3, 1, 2)
        if type == "gaussian" and radius > 0.0:
            x = _gaussian(x, radius)
        elif type == "motion" and length > 0.0:
            x = _motion(x, int(round(length)), angle)
        elif type == "zoom" and strength > 0.0:
            x = _zoom(x, strength)
        x = x.permute(0, 2, 3, 1).clamp(0.0, 1.0)
        return IO.NodeOutput(x, ui=save_live_preview(x, str(cls.hidden.unique_id)))


class BlurExtension(ComfyExtension):
    @override
    async def get_node_list(self) -> list[type[IO.ComfyNode]]:
        return [BlurNode]


async def comfy_entrypoint() -> BlurExtension:
    return BlurExtension()
