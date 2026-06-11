"""ShaderEffect: Unicorn Studio-style GLSL effects with a live WebGL node preview.

The browser renders the same .frag sources (served by the routes below) in the
node body; this module is the server half that produces real IMAGE output.
Design: docs/plans/2026-06-10-shader-effects-design.md
"""
from __future__ import annotations

import os

import numpy as np
import torch
from typing_extensions import override

from comfy_api.latest import ComfyExtension, IO
from comfy_extras._live_preview import save_live_preview
from comfy_extras._shader_effects import (
    ASSETS_DIR,
    frame_plan,
    load_catalog,
    render_effect,
    resolve_params,
)


def _effect_ids() -> list[str]:
    try:
        return list(load_catalog().effects.keys())
    except Exception:
        return []


def _load_effect_textures(effect) -> tuple[dict[str, np.ndarray], dict[str, float]]:
    """Load catalog texture assets for an effect. Returns (textures, extra_uniforms)."""
    from PIL import Image as PILImage

    textures: dict[str, np.ndarray] = {}
    extra_uniforms: dict[str, float] = {}
    for t in effect.textures:
        path = os.path.join(ASSETS_DIR, t["file"])
        img = PILImage.open(path).convert("RGBA")
        arr = np.asarray(img, dtype=np.float32) / 255.0
        textures[t["uniform"]] = arr
        for k, v in t.get("extraUniforms", {}).items():
            extra_uniforms[k] = float(v)
    return textures, extra_uniforms


class ShaderEffect(IO.ComfyNode):
    @classmethod
    def define_schema(cls):
        return IO.Schema(
            node_id="ShaderEffect",
            display_name="Shader Effect",
            description="Real-time shader effects (distortion, dither, halftone…) with a live animated preview. Runs locally on the GPU.",
            category="image/effects",
            inputs=[
                IO.Image.Input("image"),
                IO.Combo.Input("effect", options=_effect_ids() or ["noise_distortion"]),
                IO.String.Input("params", default="{}", multiline=True),
                IO.Float.Input("time", default=0.0, min=0.0, max=3600.0, step=0.05),
                IO.Float.Input("duration", default=0.0, min=0.0, max=60.0, step=0.5),
                IO.Int.Input("fps", default=24, min=1, max=60, step=1),
                IO.Int.Input("seed", default=42, min=0, max=2 ** 31 - 1, step=1),
            ],
            outputs=[IO.Image.Output(display_name="image")],
            hidden=[IO.Hidden.unique_id],
            is_output_node=True,
        )

    @classmethod
    def execute(cls, image, effect, params, time, duration, fps, seed) -> IO.NodeOutput:
        catalog = load_catalog()
        if effect not in catalog.effects:
            raise ValueError(f"ShaderEffect: unknown effect {effect!r}")
        eff = catalog.effects[effect]

        uniforms = resolve_params(eff, params)
        textures, extra_uniforms = _load_effect_textures(eff)
        uniforms.update(extra_uniforms)

        np_img = image.cpu().numpy().astype(np.float32)
        b, h, w, _ = np_img.shape
        plan = frame_plan(b, float(time), float(duration), int(fps))

        jobs = [
            {
                "image": np.ascontiguousarray(np_img[fi]),
                "uniforms": {**uniforms, "u_time": t, "u_seed": float(seed % 10000)},
            }
            for fi, t in plan
        ]
        outs = render_effect(eff.source, w, h, jobs, extra_textures=textures)
        out = torch.from_numpy(np.stack([o[..., :3] for o in outs])).clamp(0, 1)
        return IO.NodeOutput(out, ui=save_live_preview(out, str(cls.hidden.unique_id)))


class ShaderEffectsExtension(ComfyExtension):
    @override
    async def get_node_list(self) -> list[type[IO.ComfyNode]]:
        return [ShaderEffect]


async def comfy_entrypoint() -> ShaderEffectsExtension:
    return ShaderEffectsExtension()
