"""Object removal via LaMa (Large Mask inpainting, ~196 MB).

LaMa is a Fourier-convolution inpainting model trained on big masks — much
better than diffusion at "remove this clean and leave no hint". The image +
mask flow is identical to ComfyUI's standard inpainting nodes: white in the
mask = inpaint, black = keep.
"""
from __future__ import annotations

import os

import numpy as np
import torch
from typing_extensions import override

import folder_paths
from comfy_api.latest import ComfyExtension, IO

from comfy_extras._model_downloads import (
    ModelBundle, ModelFile, loader_cache, register_bundle,
)


# Carve mirrors the official big-lama as a single fp32 ONNX, which means we
# can lean on onnxruntime (already pulled in by insightface/rembg) instead of
# bundling the PyTorch source.
_MODELS_ROOT = os.path.join(folder_paths.models_dir, "lama")
_MODEL_PATH = os.path.join(_MODELS_ROOT, "lama_fp32.onnx")
_MODEL_URLS = [
    "https://huggingface.co/Carve/LaMa-ONNX/resolve/main/lama_fp32.onnx",
]
_MODEL_SIZE = 205_653_341  # bytes, official file size


register_bundle(ModelBundle(
    key="objectremove",
    label="Object Removal",
    files=[ModelFile(name="lama_fp32.onnx", path=_MODEL_PATH, size=_MODEL_SIZE, urls=_MODEL_URLS)],
))


def _get_session():
    cache = loader_cache()
    if "objectremove:session" in cache:
        return cache["objectremove:session"]
    import onnxruntime as ort
    providers = (
        ["CoreMLExecutionProvider", "CPUExecutionProvider"]
        if not torch.cuda.is_available()
        else ["CUDAExecutionProvider", "CPUExecutionProvider"]
    )
    sess = ort.InferenceSession(_MODEL_PATH, providers=providers)
    cache["objectremove:session"] = sess
    return sess


def _round_up_to_multiple(n: int, m: int) -> int:
    return ((n + m - 1) // m) * m


class ObjectRemoveNode(IO.ComfyNode):
    """Erase content under the mask and seamlessly fill the hole.

    Works on a single image or a video batch. For video, you typically wire
    a tracked mask (see Subject Mask) so the patched region follows the
    object you want to remove.
    """

    @classmethod
    def define_schema(cls):
        return IO.Schema(
            node_id="ObjectRemove",
            display_name="Object Removal",
            description="LaMa inpainting — clean removal of distractions, watermarks, signs, "
                        "or whole subjects without diffusion-style hallucination.",
            category="image",
            inputs=[
                IO.Image.Input("frames", tooltip="The image or video frames to inpaint."),
                IO.Mask.Input("mask", tooltip="White pixels are the area to erase and regenerate; "
                                              "black pixels are preserved untouched. A single mask is "
                                              "applied to every frame; a mask batch matches the input frame-for-frame."),
                IO.Int.Input("mask_grow", default=4, min=0, max=64, step=1,
                             tooltip="Dilate the mask by this many pixels before inpainting. "
                                     "A small grow (2–8) hides edge halos around the object you're removing — "
                                     "especially if the mask was traced tightly."),
            ],
            outputs=[IO.Image.Output(display_name="frames")],
        )

    @classmethod
    def execute(cls, frames, mask, mask_grow) -> IO.NodeOutput:
        if not os.path.isfile(_MODEL_PATH):
            raise RuntimeError(
                "LaMa model not found. Click the Object Removal card in the toolbox "
                "to download it (~196 MB)."
            )

        import cv2

        sess = _get_session()
        in_name_img = sess.get_inputs()[0].name
        in_name_mask = sess.get_inputs()[1].name

        T, H, W, _ = frames.shape
        # Mask comes in as either [H, W] (single mask) or [T, H, W] (per-frame).
        # Make it always [T, H, W] for uniform indexing below.
        if mask.dim() == 2:
            mask_batch = mask.unsqueeze(0).expand(T, -1, -1).contiguous()
        else:
            mask_batch = mask
            if mask_batch.shape[0] == 1 and T > 1:
                mask_batch = mask_batch.expand(T, -1, -1).contiguous()

        # LaMa is fully-convolutional but its FFC blocks need spatial dims
        # divisible by 8 — pad up, inpaint, crop back.
        pad_H = _round_up_to_multiple(H, 8)
        pad_W = _round_up_to_multiple(W, 8)

        kernel = np.ones((3, 3), np.uint8)

        out_frames: list[torch.Tensor] = []
        for t in range(T):
            img = (frames[t].detach().cpu().numpy() * 255.0).clip(0, 255).astype(np.uint8)
            m = (mask_batch[t].detach().cpu().numpy() * 255.0).clip(0, 255).astype(np.uint8)

            if mask_grow > 0:
                m = cv2.dilate(m, kernel, iterations=int(mask_grow))

            # Pad both to model-friendly size (replicate edges; LaMa's reflective
            # padding looks weird on natural images).
            if pad_H != H or pad_W != W:
                img_p = cv2.copyMakeBorder(img, 0, pad_H - H, 0, pad_W - W, cv2.BORDER_REPLICATE)
                m_p = cv2.copyMakeBorder(m, 0, pad_H - H, 0, pad_W - W, cv2.BORDER_CONSTANT, value=0)
            else:
                img_p, m_p = img, m

            # ONNX inputs: image [1, 3, H, W] float32 [0, 1], mask [1, 1, H, W] float32 {0, 1}.
            img_t = img_p.astype(np.float32).transpose(2, 0, 1)[None] / 255.0
            mask_t = (m_p.astype(np.float32) > 127.5).astype(np.float32)[None, None]

            out = sess.run(None, {in_name_img: img_t, in_name_mask: mask_t})[0]
            # LaMa returns uint8-scaled floats [0, 255] in some exports. Normalize.
            arr = out[0].transpose(1, 2, 0)
            if arr.max() > 1.5:
                arr = arr / 255.0
            arr = np.clip(arr, 0.0, 1.0)

            # Crop back to original size and composite — only the masked pixels
            # change, so paste the inpainted region over the unmodified frame.
            arr = arr[:H, :W]
            blend = (m.astype(np.float32) / 255.0)[..., None]
            composed = arr * blend + (frames[t].detach().cpu().numpy()) * (1.0 - blend)
            out_frames.append(torch.from_numpy(composed.astype(np.float32)))

        return IO.NodeOutput(torch.stack(out_frames, dim=0))


class ObjectRemoveExtension(ComfyExtension):
    @override
    async def get_node_list(self) -> list[type[IO.ComfyNode]]:
        return [ObjectRemoveNode]


async def comfy_entrypoint() -> ObjectRemoveExtension:
    return ObjectRemoveExtension()
