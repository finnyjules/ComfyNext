"""Image / video upscale via Real-ESRGAN x2 (~64 MB).

Spandrel loads the .pth and gives us a clean forward function regardless of
arch. We tile big inputs so 4K → 8K doesn't blow up memory.
"""
from __future__ import annotations

import os

import torch
import torch.nn.functional as F
from typing_extensions import override

import folder_paths
from comfy_api.latest import ComfyExtension, IO

from comfy_extras._model_downloads import (
    ModelBundle, ModelFile, loader_cache, register_bundle,
)


_MODELS_ROOT = os.path.join(folder_paths.models_dir, "upscale_models")
_MODEL_PATH = os.path.join(_MODELS_ROOT, "RealESRGAN_x2plus.pth")
_MODEL_URLS = [
    "https://github.com/xinntao/Real-ESRGAN/releases/download/v0.2.1/RealESRGAN_x2plus.pth",
]
_MODEL_SIZE = 67_061_725


register_bundle(ModelBundle(
    key="upscale",
    label="Upscale",
    files=[ModelFile(name="RealESRGAN_x2plus.pth", path=_MODEL_PATH, size=_MODEL_SIZE, urls=_MODEL_URLS)],
))


def _device() -> torch.device:
    if torch.cuda.is_available():
        return torch.device("cuda")
    if torch.backends.mps.is_available():
        return torch.device("mps")
    return torch.device("cpu")


def _get_model():
    cache = loader_cache()
    if "upscale:model" in cache:
        return cache["upscale:model"]
    from spandrel import ModelLoader
    model = ModelLoader().load_from_file(_MODEL_PATH).model
    model.eval().to(_device())
    cache["upscale:model"] = model
    return model


def _tiled_forward(model, image: torch.Tensor, tile: int, overlap: int, scale: int) -> torch.Tensor:
    """image is [1, 3, H, W] in [0, 1]. Returns [1, 3, H*scale, W*scale]."""
    if tile <= 0 or (image.shape[-2] <= tile and image.shape[-1] <= tile):
        with torch.no_grad():
            return model(image).clamp(0, 1)

    _, c, h, w = image.shape
    out_h, out_w = h * scale, w * scale
    out = torch.zeros((1, c, out_h, out_w), dtype=image.dtype, device=image.device)
    weight = torch.zeros((1, 1, out_h, out_w), dtype=image.dtype, device=image.device)

    step = tile - overlap
    y_starts = list(range(0, max(h - tile, 0) + 1, step))
    if y_starts[-1] + tile < h:
        y_starts.append(h - tile)
    x_starts = list(range(0, max(w - tile, 0) + 1, step))
    if x_starts[-1] + tile < w:
        x_starts.append(w - tile)

    for y in y_starts:
        for x in x_starts:
            patch = image[:, :, y:y + tile, x:x + tile]
            with torch.no_grad():
                up = model(patch).clamp(0, 1)
            sy, sx = y * scale, x * scale
            out[:, :, sy:sy + up.shape[-2], sx:sx + up.shape[-1]] += up
            weight[:, :, sy:sy + up.shape[-2], sx:sx + up.shape[-1]] += 1.0

    return out / weight.clamp(min=1.0)


class UpscaleNode(IO.ComfyNode):
    """2× upscale via Real-ESRGAN. Works on stills and per-frame on video."""

    @classmethod
    def define_schema(cls):
        return IO.Schema(
            node_id="UpscaleImage",
            display_name="Upscale (2×)",
            description="Real-ESRGAN x2: doubles each dimension while sharpening detail.",
            category="image",
            inputs=[
                IO.Image.Input("frames", tooltip="The image or video frames to upscale. Output is 2× wider and 2× taller."),
                IO.Int.Input("tile_size", default=512, min=0, max=2048, step=64,
                             tooltip="Process the image in patches of this size, then stitch. "
                                     "Smaller (256) uses less VRAM but is slower. "
                                     "0 disables tiling — only safe for small inputs."),
            ],
            outputs=[IO.Image.Output(display_name="frames")],
        )

    @classmethod
    def execute(cls, frames, tile_size) -> IO.NodeOutput:
        if not os.path.isfile(_MODEL_PATH):
            raise RuntimeError(
                "Real-ESRGAN model not found. Click the Upscale card in the toolbox "
                "to download it (~64 MB)."
            )

        model = _get_model()
        device = _device()
        scale = int(getattr(model, "scale", 2))

        out_frames: list[torch.Tensor] = []
        for t in range(frames.shape[0]):
            # frames are [T, H, W, 3] in [0, 1]. Model wants [1, 3, H, W].
            img = frames[t].permute(2, 0, 1).unsqueeze(0).to(device).float()
            up = _tiled_forward(model, img, tile=int(tile_size), overlap=32, scale=scale)
            out_frames.append(up.squeeze(0).permute(1, 2, 0).cpu())

        return IO.NodeOutput(torch.stack(out_frames, dim=0))


class UpscaleExtension(ComfyExtension):
    @override
    async def get_node_list(self) -> list[type[IO.ComfyNode]]:
        return [UpscaleNode]


async def comfy_entrypoint() -> UpscaleExtension:
    return UpscaleExtension()
