"""Background removal via rembg (ISNet General Use, ~179 MB).

ISNet is the sweet-spot for everyday subjects: faster than BiRefNet, much
better than U2Net. Output is the original frames with a clean alpha mask;
we also surface the mask separately for downstream compositing.
"""
from __future__ import annotations

import os

import numpy as np
import torch
from typing_extensions import override

from comfy_api.latest import ComfyExtension, IO

from comfy_extras._live_preview import save_live_preview
from comfy_extras._model_downloads import (
    ModelBundle, ModelFile, loader_cache, register_bundle,
)


# rembg looks here by default — keep the same path so a manual rembg install
# would find our file too.
_REMBG_HOME = os.path.expanduser("~/.u2net")
_MODEL_PATH = os.path.join(_REMBG_HOME, "isnet-general-use.onnx")
_MODEL_URLS = [
    "https://github.com/danielgatis/rembg/releases/download/v0.0.0/isnet-general-use.onnx",
]
_MODEL_SIZE = 178_648_008


register_bundle(ModelBundle(
    key="bgremove",
    label="Background Remove",
    files=[ModelFile(name="isnet-general-use.onnx", path=_MODEL_PATH, size=_MODEL_SIZE, urls=_MODEL_URLS)],
))


def _get_session():
    cache = loader_cache()
    if "bgremove:session" in cache:
        return cache["bgremove:session"]
    from rembg import new_session
    sess = new_session("isnet-general-use")
    cache["bgremove:session"] = sess
    return sess


class BackgroundRemoveNode(IO.ComfyNode):
    """Remove the background from a still or every frame of a video."""

    @classmethod
    def define_schema(cls):
        return IO.Schema(
            node_id="BackgroundRemove",
            display_name="Background Remove",
            description="Knock out the background. Works on single images and video frames.",
            category="image",
            # Emit the result so the frontend captures it (data.images) — lets the
            # output preview anywhere it's wired (e.g. composited in a Frame),
            # matching every other image-producing node here.
            is_output_node=True,
            inputs=[
                IO.Image.Input("frames", tooltip="The image or video frames to remove the background from."),
                IO.Combo.Input("output", options=["transparent", "premultiplied", "matte_only"],
                               default="transparent",
                               tooltip="`transparent`: keeps the subject's original colors with a soft alpha — best for compositing later. "
                                       "`premultiplied`: same but the subject's colors are pre-multiplied by alpha "
                                       "(needed by some video tools). "
                                       "`matte_only`: returns a pure black/white image — useful as a mask source."),
                IO.Float.Input("edge_softness", default=0.0, min=0.0, max=10.0, step=0.5,
                               tooltip="Blur the alpha edge by this many pixels. 0 = sharp cut. "
                                       "1–3 hides minor halos around hair / fur. Higher values look airbrushed."),
            ],
            outputs=[
                IO.Image.Output(display_name="frames"),
                IO.Mask.Output(display_name="mask"),
            ],
            hidden=[IO.Hidden.unique_id],
        )

    @classmethod
    def execute(cls, frames, output, edge_softness) -> IO.NodeOutput:
        if not os.path.isfile(_MODEL_PATH):
            raise RuntimeError(
                "ISNet model not found. Click the Background Remove card in the toolbox "
                "to download it (~179 MB)."
            )

        from rembg import remove
        from PIL import Image as PILImage, ImageFilter

        session = _get_session()

        out_frames: list[torch.Tensor] = []
        out_masks: list[torch.Tensor] = []
        preview_frames: list[torch.Tensor] = []
        for t in range(frames.shape[0]):
            arr = (frames[t].detach().cpu().numpy() * 255.0).clip(0, 255).astype(np.uint8)
            pil = PILImage.fromarray(arr, mode="RGB")
            # rembg returns RGBA when `post_process_mask=True` cleans edges.
            cut = remove(pil, session=session, post_process_mask=True)
            if cut.mode != "RGBA":
                cut = cut.convert("RGBA")

            alpha = cut.split()[3]
            if edge_softness > 0:
                alpha = alpha.filter(ImageFilter.GaussianBlur(radius=float(edge_softness)))
            rgb = cut.convert("RGB")
            alpha_np = np.asarray(alpha, dtype=np.float32) / 255.0
            rgb_np = np.asarray(rgb, dtype=np.float32) / 255.0

            if output == "premultiplied":
                rgb_np = rgb_np * alpha_np[..., None]
                rgba_np = np.concatenate([rgb_np, alpha_np[..., None]], axis=-1)
                out_frames.append(torch.from_numpy(rgba_np[..., :3]).float())
            elif output == "matte_only":
                m3 = np.stack([alpha_np] * 3, axis=-1)
                out_frames.append(torch.from_numpy(m3).float())
            else:  # transparent
                # Emit straight RGBA (4-channel) so alpha flows through the IMAGE
                # wire — the Compositor folds an embedded 4th channel into its
                # coverage, so a cut-out composites cleanly live (no lock needed).
                # premultiplied / matte_only stay 3-channel for tools that want them.
                rgba_np = np.concatenate([rgb_np, alpha_np[..., None]], axis=-1)
                out_frames.append(torch.from_numpy(rgba_np).float())

            out_masks.append(torch.from_numpy(alpha_np).float())

            # RGBA preview so the result reads as truly transparent wherever it's
            # wired (e.g. composited in a Frame). The IMAGE output stays 3-channel;
            # this is purely the node-body / downstream preview.
            if output == "matte_only":
                prev = np.concatenate(
                    [np.stack([alpha_np] * 3, axis=-1), np.ones_like(alpha_np)[..., None]],
                    axis=-1,
                )
            else:
                prev = np.concatenate([rgb_np, alpha_np[..., None]], axis=-1)
            preview_frames.append(torch.from_numpy(prev).float())

        return IO.NodeOutput(
            torch.stack(out_frames, dim=0),
            torch.stack(out_masks, dim=0),
            ui=save_live_preview(torch.stack(preview_frames, dim=0), str(cls.hidden.unique_id)),
        )


class BGRemoveExtension(ComfyExtension):
    @override
    async def get_node_list(self) -> list[type[IO.ComfyNode]]:
        return [BackgroundRemoveNode]


async def comfy_entrypoint() -> BGRemoveExtension:
    return BGRemoveExtension()
