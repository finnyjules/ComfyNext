from __future__ import annotations

"""Lens · Depth of Field — local depth-based DoF / virtual lens.

Estimates depth once (Depth Anything V2, cached), then renders a tweakable
shallow-focus look: tap-to-focus (the `focus_point` String widget is written by
the preview click, like MaskExtractor's `points`), aperture, bokeh shape +
highlights, chromatic aberration, vignette, lens presets, and a focal-length
compression look. Live-preview effect (type:"temp"); export via a downstream
Image node.
"""

import json

import torch
from typing_extensions import override

from comfy_api.latest import ComfyExtension, IO
from comfy_extras._live_preview import save_live_preview
from comfy_extras._depth import estimate_depth
from comfy_extras import _lens


class LensBlurNode(IO.ComfyNode):
    @classmethod
    def define_schema(cls):
        return IO.Schema(
            node_id="LensBlur",
            display_name="Lens · Depth of Field",
            description=(
                "Depth-based depth of field. Click the preview to focus, then set "
                "aperture and lens character. Estimates depth locally (Depth Anything "
                "V2) — downloads ~100 MB on first use."
            ),
            category="image/lens",
            inputs=[
                IO.Image.Input("image", tooltip="The image to apply the lens to."),
                IO.Image.Input("depth", optional=True,
                               tooltip="Optional: wire a depth map to override auto-estimation."),
                IO.String.Input("focus_point", default='{"x":0.5,"y":0.5}',
                                tooltip="Click the preview to focus. Managed by the UI."),
                IO.Float.Input("focus_offset", default=0.0, min=-1.0, max=1.0, step=0.01,
                               tooltip="Pull focus nearer/farther from the tapped point."),
                IO.Float.Input("aperture", default=0.4, min=0.0, max=1.0, step=0.01,
                               tooltip="Blur strength — higher = shallower depth of field."),
                IO.Combo.Input("lens_preset", options=_lens.PRESETS, default="Custom",
                               tooltip="A lens look. Sets the character below; your edits override."),
                IO.Combo.Input("bokeh_shape", options=["circular", "hexagonal", "anamorphic"],
                               default="circular"),
                IO.Float.Input("highlight_bokeh", default=0.3, min=0.0, max=1.0, step=0.01),
                IO.Float.Input("chromatic_aberration", default=0.0, min=0.0, max=1.0, step=0.01),
                IO.Float.Input("vignette", default=0.0, min=0.0, max=1.0, step=0.01),
                IO.Float.Input("focal_length", default=0.0, min=-1.0, max=1.0, step=0.01,
                               tooltip="Compression look: negative = wide, positive = telephoto."),
            ],
            outputs=[IO.Image.Output(display_name="image")],
            hidden=[IO.Hidden.unique_id],
            is_output_node=True,
        )

    @classmethod
    def execute(cls, image=None, depth=None, focus_point='{"x":0.5,"y":0.5}', focus_offset=0.0,
                aperture=0.4, lens_preset="Custom", bokeh_shape="circular", highlight_bokeh=0.3,
                chromatic_aberration=0.0, vignette=0.0, focal_length=0.0) -> IO.NodeOutput:
        uid = str(cls.hidden.unique_id)
        if image is None:
            blank = torch.zeros(1, 16, 16, 3)
            return IO.NodeOutput(blank, ui=save_live_preview(blank, uid))

        img = image[0] if image.ndim == 4 else image
        h, w, _ = img.shape

        # Depth: wired (resized to image) or auto-estimated (cached).
        if depth is not None:
            d = depth[0] if depth.ndim == 4 else depth
            if d.ndim == 3:
                d = d.mean(dim=-1)
            d = torch.nn.functional.interpolate(
                d.view(1, 1, *d.shape), size=(h, w), mode="bilinear", align_corners=False
            ).view(h, w).clamp(0, 1)
        else:
            d = estimate_depth(image)

        # Focus plane from the tapped point + offset.
        try:
            fp = json.loads(focus_point or "{}")
            fx = float(fp.get("x", 0.5)); fy = float(fp.get("y", 0.5))
        except (json.JSONDecodeError, TypeError, ValueError):
            fx, fy = 0.5, 0.5
        px = min(w - 1, max(0, int(fx * w)))
        py = min(h - 1, max(0, int(fy * h)))
        focus = float(d[py, px]) + float(focus_offset)
        focus = max(0.0, min(1.0, focus))

        params = _lens.resolve_params(lens_preset, {
            "bokeh_shape": bokeh_shape,
            "highlight_bokeh": highlight_bokeh,
            "chromatic_aberration": chromatic_aberration,
            "vignette": vignette,
            "focal_length": focal_length,
        })

        result = image
        result = _lens.focal_compression(result, d, params["focal_length"], center=(fx, fy))
        coc = _lens.circle_of_confusion(d, focus, float(aperture))
        result = _lens.render_dof(result, coc, bokeh_shape=params["bokeh_shape"],
                                  highlight_bokeh=params["highlight_bokeh"])
        result = _lens.chromatic_aberration(result, params["chromatic_aberration"])
        result = _lens.vignette(result, params["vignette"])
        return IO.NodeOutput(result, ui=save_live_preview(result, uid))


class LensExtension(ComfyExtension):
    @override
    async def get_node_list(self) -> list[type[IO.ComfyNode]]:
        return [LensBlurNode]


async def comfy_entrypoint() -> LensExtension:
    return LensExtension()
