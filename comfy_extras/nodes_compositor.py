from __future__ import annotations

import math

import torch
import torch.nn.functional as F
from typing_extensions import override

from comfy_api.latest import ComfyExtension, IO
from comfy_extras._live_preview import save_live_preview


_BLEND_MODES = [
    "normal", "multiply", "screen", "overlay", "soft_light", "hard_light",
    "difference", "lighten", "darken", "add",
]


def _blend(base: torch.Tensor, top: torch.Tensor, mode: str) -> torch.Tensor:
    a, b = base, top
    if mode == "normal":     return b
    if mode == "multiply":   return a * b
    if mode == "screen":     return 1.0 - (1.0 - a) * (1.0 - b)
    if mode == "overlay":
        return torch.where(a < 0.5, 2.0 * a * b, 1.0 - 2.0 * (1.0 - a) * (1.0 - b))
    if mode == "soft_light": return (1.0 - 2.0 * b) * a * a + 2.0 * b * a
    if mode == "hard_light":
        return torch.where(b < 0.5, 2.0 * a * b, 1.0 - 2.0 * (1.0 - a) * (1.0 - b))
    if mode == "difference": return (a - b).abs()
    if mode == "lighten":    return torch.maximum(a, b)
    if mode == "darken":     return torch.minimum(a, b)
    if mode == "add":        return (a + b).clamp(0.0, 1.0)
    return b


def _fit_to_canvas(layer: torch.Tensor, canvas_h: int, canvas_w: int) -> torch.Tensor:
    """Resize a layer to fit within canvas while preserving aspect, centered."""
    b, c, h, w = layer.shape
    if (h, w) == (canvas_h, canvas_w):
        return layer
    canvas_aspect = canvas_w / canvas_h
    layer_aspect = w / h
    if layer_aspect > canvas_aspect:
        new_w = canvas_w
        new_h = max(1, int(canvas_w / layer_aspect))
    else:
        new_h = canvas_h
        new_w = max(1, int(canvas_h * layer_aspect))
    resized = F.interpolate(layer, size=(new_h, new_w), mode="bilinear", align_corners=False)
    pad_h = canvas_h - new_h
    pad_w = canvas_w - new_w
    pad_top = pad_h // 2
    pad_bottom = pad_h - pad_top
    pad_left = pad_w // 2
    pad_right = pad_w - pad_left
    return F.pad(resized, [pad_left, pad_right, pad_top, pad_bottom], mode="constant", value=0)


def _transform(layer: torch.Tensor, x_off: float, y_off: float, rotation: float, scale: float):
    """Apply (translate, rotate, scale) to a layer-sized tensor.

    Returns (rgb, alpha) where alpha is 1 where the source mapped within the
    layer and 0 outside.
    """
    b, c, h, w = layer.shape
    device, dtype = layer.device, layer.dtype
    rad = math.radians(rotation)
    cos_a, sin_a = math.cos(rad), math.sin(rad)
    s = max(0.01, float(scale))
    # Inverse affine: output (qx, qy) → input pixel.
    # input_x = (cos_a * (qx - x_off) + sin_a * (qy - y_off)) / s
    # input_y = (-sin_a * (qx - x_off) + cos_a * (qy - y_off)) / s
    m00 = cos_a / s
    m01 = sin_a / s
    m02 = (-x_off * cos_a - y_off * sin_a) / s
    m10 = -sin_a / s
    m11 = cos_a / s
    m12 = (x_off * sin_a - y_off * cos_a) / s
    theta = torch.tensor([[m00, m01, m02], [m10, m11, m12]], dtype=dtype, device=device).unsqueeze(0).expand(b, -1, -1)
    grid = F.affine_grid(theta, (b, c, h, w), align_corners=False)
    rgb = F.grid_sample(layer, grid, mode="bilinear", padding_mode="zeros", align_corners=False)
    ones = torch.ones(b, 1, h, w, dtype=dtype, device=device)
    alpha = F.grid_sample(ones, grid, mode="bilinear", padding_mode="zeros", align_corners=False)
    return rgb, alpha


def _layer_inputs(idx: int, optional: bool):
    """Build the per-layer input declarations for layer N."""
    return [
        IO.Image.Input(f"layer{idx}", optional=optional,
                       tooltip=f"Layer {idx}{' (sets canvas size)' if idx == 1 else ''}"),
        IO.Float.Input(f"layer{idx}_x",        default=0.0, min=-1.5, max=1.5, step=0.01,
                       tooltip="Horizontal offset in canvas units (-1 = full canvas width)."),
        IO.Float.Input(f"layer{idx}_y",        default=0.0, min=-1.5, max=1.5, step=0.01,
                       tooltip="Vertical offset in canvas units."),
        IO.Float.Input(f"layer{idx}_rotation", default=0.0, min=-180.0, max=180.0, step=1.0),
        IO.Float.Input(f"layer{idx}_scale",    default=1.0, min=0.1, max=3.0, step=0.05),
        IO.Float.Input(f"layer{idx}_opacity",  default=1.0, min=0.0, max=1.0, step=0.01),
        IO.Combo.Input(f"layer{idx}_blend",    options=_BLEND_MODES, default="normal"),
    ]


_MAX_LAYERS = 16


class CompositorNode(IO.ComfyNode):
    @classmethod
    def define_schema(cls):
        inputs = []
        for i in range(1, _MAX_LAYERS + 1):
            inputs.extend(_layer_inputs(i, optional=(i > 1)))
        return IO.Schema(
            node_id="Compositor",
            display_name="Compositor",
            description=f"Stack up to {_MAX_LAYERS} image layers with transform, opacity, and blend. "
                        "Unused slots are inert — connect as many as your composition needs.",
            category="image/composite",
            inputs=inputs,
            outputs=[IO.Image.Output(display_name="image")],
            hidden=[IO.Hidden.unique_id],
            is_output_node=True,
        )

    @classmethod
    def execute(cls, **kwargs) -> IO.NodeOutput:
        # Gather provided layers in order. Unconnected slots return None and
        # are skipped — the composite uses only the layers that have an image.
        layers = []
        for i in range(1, _MAX_LAYERS + 1):
            img = kwargs.get(f"layer{i}")
            if img is None:
                continue
            layers.append({
                "image": img,
                "x":   float(kwargs.get(f"layer{i}_x", 0.0)),
                "y":   float(kwargs.get(f"layer{i}_y", 0.0)),
                "rot": float(kwargs.get(f"layer{i}_rotation", 0.0)),
                "scl": float(kwargs.get(f"layer{i}_scale", 1.0)),
                "op":  float(kwargs.get(f"layer{i}_opacity", 1.0)),
                "blend": kwargs.get(f"layer{i}_blend", "normal"),
            })

        if not layers:
            # Nothing connected — return a tiny black image.
            blank = torch.zeros(1, 16, 16, 3)
            return IO.NodeOutput(blank, ui=save_live_preview(blank, str(cls.hidden.unique_id)))

        base = layers[0]["image"]
        _, ch, cw, _ = base.shape
        canvas_h, canvas_w = ch, cw

        # Render the base layer (still subject to its own transform).
        b1 = base.permute(0, 3, 1, 2)
        rgb, alpha = _transform(b1, layers[0]["x"], layers[0]["y"], layers[0]["rot"], layers[0]["scl"])
        # Start composite: base on a black canvas modulated by its own opacity.
        result = rgb * (alpha * layers[0]["op"])

        for layer in layers[1:]:
            t = layer["image"].permute(0, 3, 1, 2)
            t = _fit_to_canvas(t, canvas_h, canvas_w)
            top_rgb, top_alpha = _transform(t, layer["x"], layer["y"], layer["rot"], layer["scl"])
            a = (top_alpha * layer["op"]).clamp(0.0, 1.0)
            blended = _blend(result, top_rgb, layer["blend"])
            result = result * (1.0 - a) + blended * a

        out = result.permute(0, 2, 3, 1).clamp(0.0, 1.0)
        return IO.NodeOutput(out, ui=save_live_preview(out, str(cls.hidden.unique_id)))


class CompositorExtension(ComfyExtension):
    @override
    async def get_node_list(self) -> list[type[IO.ComfyNode]]:
        return [CompositorNode]


async def comfy_entrypoint() -> CompositorExtension:
    return CompositorExtension()
