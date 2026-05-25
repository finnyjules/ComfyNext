"""Subject masking via MobileSAM (~50 MB).

Click a point on the subject — get a tight mask back. Works on stills and on
every frame of a video. For video, we re-apply the same click coordinates per
frame, so "track" here is the same-coordinates flavour (works well for mostly-
static subjects). True identity-tracking across motion lives in Phase 2.

MobileSAM is a distilled SAM ViT-Tiny: ~50× faster than the original ViT-H
while keeping ~90% of the mask quality, which is the right trade for an
interactive editor.
"""
from __future__ import annotations

import os

import cv2
import numpy as np
import torch
from typing_extensions import override

import folder_paths
from comfy_api.latest import ComfyExtension, IO

from comfy_extras._model_downloads import (
    ModelBundle, ModelFile, loader_cache, register_bundle,
)


_MODELS_ROOT = os.path.join(folder_paths.models_dir, "sam")
_ENCODER_PATH = os.path.join(_MODELS_ROOT, "mobile_sam.encoder.onnx")
_DECODER_PATH = os.path.join(_MODELS_ROOT, "mobile_sam.decoder.onnx")
_ENCODER_URLS = [
    "https://huggingface.co/vietanhdev/segment-anything-onnx-models/resolve/main/mobile_sam.encoder.onnx",
    "https://github.com/vietanhdev/anylabeling-assets/releases/download/v0.4.0/mobile_sam.encoder.onnx",
]
_DECODER_URLS = [
    "https://huggingface.co/vietanhdev/segment-anything-onnx-models/resolve/main/mobile_sam.decoder.onnx",
    "https://github.com/vietanhdev/anylabeling-assets/releases/download/v0.4.0/mobile_sam.decoder.onnx",
]
# Sizes are best-effort; the bundle checker falls back to "non-empty file"
# when size is 0, so the toolbox card won't redundantly re-download on
# every boot.
_ENCODER_SIZE = 0
_DECODER_SIZE = 0


register_bundle(ModelBundle(
    key="subjecttrack",
    label="Subject Mask",
    files=[
        ModelFile(name="mobile_sam.encoder.onnx", path=_ENCODER_PATH, size=_ENCODER_SIZE, urls=_ENCODER_URLS),
        ModelFile(name="mobile_sam.decoder.onnx", path=_DECODER_PATH, size=_DECODER_SIZE, urls=_DECODER_URLS),
    ],
))


# ---------------------------------------------------------------------------
# Sessions
# ---------------------------------------------------------------------------

def _providers():
    if torch.cuda.is_available():
        return ["CUDAExecutionProvider", "CPUExecutionProvider"]
    return ["CoreMLExecutionProvider", "CPUExecutionProvider"]


def _get_encoder():
    cache = loader_cache()
    if "subjecttrack:encoder" in cache:
        return cache["subjecttrack:encoder"]
    import onnxruntime as ort
    sess = ort.InferenceSession(_ENCODER_PATH, providers=_providers())
    cache["subjecttrack:encoder"] = sess
    return sess


def _get_decoder():
    cache = loader_cache()
    if "subjecttrack:decoder" in cache:
        return cache["subjecttrack:decoder"]
    import onnxruntime as ort
    sess = ort.InferenceSession(_DECODER_PATH, providers=_providers())
    cache["subjecttrack:decoder"] = sess
    return sess


# ---------------------------------------------------------------------------
# SAM preprocessing — match the original SAM/MobileSAM expectations
# ---------------------------------------------------------------------------

_SAM_INPUT = 1024  # SAM normalises both side-of-the-longest to 1024
_PIXEL_MEAN = np.array([123.675, 116.28, 103.53], dtype=np.float32).reshape(1, 1, 3)
_PIXEL_STD = np.array([58.395, 57.12, 57.375], dtype=np.float32).reshape(1, 1, 3)


def _resize_longest(rgb: np.ndarray) -> tuple[np.ndarray, float]:
    h, w = rgb.shape[:2]
    scale = _SAM_INPUT / max(h, w)
    new_h, new_w = int(round(h * scale)), int(round(w * scale))
    resized = cv2.resize(rgb, (new_w, new_h), interpolation=cv2.INTER_LINEAR)
    return resized, scale


def _preprocess(rgb_uint8: np.ndarray) -> tuple[np.ndarray, float, tuple[int, int]]:
    """Resize+pad to 1024², normalise, NCHW. Returns (input, scale, orig_hw)."""
    resized, scale = _resize_longest(rgb_uint8)
    h, w = resized.shape[:2]
    pad = np.zeros((_SAM_INPUT, _SAM_INPUT, 3), dtype=np.uint8)
    pad[:h, :w] = resized
    normed = (pad.astype(np.float32) - _PIXEL_MEAN) / _PIXEL_STD
    inp = normed.transpose(2, 0, 1)[None]
    return inp.astype(np.float32), scale, (rgb_uint8.shape[0], rgb_uint8.shape[1])


# ---------------------------------------------------------------------------
# Node
# ---------------------------------------------------------------------------

class SubjectMaskNode(IO.ComfyNode):
    """Click a point on the subject — get a mask back.

    Run on a single image or a whole video batch. The same click coordinates
    are used on every frame, which is perfect for "the subject stays roughly
    where they were" footage (talking head, locked-off shot, slow pan).
    """

    @classmethod
    def define_schema(cls):
        return IO.Schema(
            node_id="SubjectMask",
            display_name="Subject Mask",
            description="Click a point on the subject — MobileSAM segments it out as a mask "
                        "for every frame. Pair with Object Removal, Background Remove, or any "
                        "node that takes a mask.",
            category="image",
            inputs=[
                IO.Image.Input("frames", tooltip="Image or video frames to segment."),
                IO.Float.Input("point_x", default=0.5, min=0.0, max=1.0, step=0.01,
                               tooltip="Horizontal click position as a fraction of the frame width. "
                                       "0.0 = left edge, 0.5 = center, 1.0 = right edge."),
                IO.Float.Input("point_y", default=0.5, min=0.0, max=1.0, step=0.01,
                               tooltip="Vertical click position as a fraction of the frame height. "
                                       "0.0 = top, 0.5 = middle, 1.0 = bottom."),
                IO.Combo.Input("output_mode", options=["best", "largest", "smallest"], default="best",
                               tooltip="SAM returns 3 candidate masks per click — pick which one to keep. "
                                       "`best` follows SAM's own confidence score (usually right). "
                                       "`largest` picks the biggest mask (good for whole subjects). "
                                       "`smallest` picks the tightest (good for picking out one object on a person)."),
                IO.Float.Input("mask_grow", default=0.0, min=-32.0, max=32.0, step=1.0,
                               tooltip="Positive: grow the mask by this many pixels (good for hiding rough edges). "
                                       "Negative: shrink it (good for tight matting around hair). 0 = no change."),
            ],
            outputs=[
                IO.Mask.Output(display_name="mask"),
                IO.Image.Output(display_name="cutout"),
            ],
        )

    @classmethod
    def execute(cls, frames, point_x, point_y, output_mode, mask_grow) -> IO.NodeOutput:
        if not (os.path.isfile(_ENCODER_PATH) and os.path.isfile(_DECODER_PATH)):
            raise RuntimeError(
                "MobileSAM models not found. Click the Subject Mask card in the toolbox "
                "to download them (~55 MB total)."
            )

        encoder = _get_encoder()
        decoder = _get_decoder()
        enc_in = encoder.get_inputs()[0].name
        dec_inputs = [i.name for i in decoder.get_inputs()]

        T, H, W, _ = frames.shape
        # Click point in original pixel coords.
        px = float(point_x) * W
        py = float(point_y) * H

        # SAM decoder I/O — the standard 5-input export.
        # We push one positive point per call.
        point_coords = np.array([[[px, py], [0.0, 0.0]]], dtype=np.float32)  # label-1 padding
        point_labels = np.array([[1, -1]], dtype=np.float32)  # 1 = positive, -1 = "not a point"
        mask_input = np.zeros((1, 1, 256, 256), dtype=np.float32)
        has_mask_input = np.zeros((1,), dtype=np.float32)

        out_masks: list[torch.Tensor] = []
        out_cutouts: list[torch.Tensor] = []

        kernel_grow = max(0, int(round(mask_grow)))
        kernel_shrink = max(0, -int(round(mask_grow)))
        kernel = np.ones((3, 3), np.uint8)

        for t in range(T):
            rgb = (frames[t].detach().cpu().numpy() * 255.0).clip(0, 255).astype(np.uint8)
            inp, scale, (orig_h, orig_w) = _preprocess(rgb)

            embedding = encoder.run(None, {enc_in: inp})[0]

            # Decoder takes click coords in the resized space, plus the orig size.
            scaled_pts = point_coords.copy()
            scaled_pts[..., 0] *= scale
            scaled_pts[..., 1] *= scale
            orig_size = np.array([orig_h, orig_w], dtype=np.float32)

            feed = {
                dec_inputs[0]: embedding,
                dec_inputs[1]: scaled_pts,
                dec_inputs[2]: point_labels,
                dec_inputs[3]: mask_input,
                dec_inputs[4]: has_mask_input,
            }
            if len(dec_inputs) >= 6:
                feed[dec_inputs[5]] = orig_size

            outputs = decoder.run(None, feed)
            masks = outputs[0]  # [1, N, H, W] or [1, N, 256, 256] depending on export
            scores = outputs[1] if len(outputs) >= 2 else np.array([[1.0] * masks.shape[1]])

            # Choose a mask by mode.
            if masks.ndim == 4:
                m_stack = masks[0]
            else:
                m_stack = masks
            scored = scores[0] if scores.ndim == 2 else scores

            if output_mode == "largest":
                idx = int(np.argmax([(m > 0).sum() for m in m_stack]))
            elif output_mode == "smallest":
                idx = int(np.argmin([(m > 0).sum() + 1 for m in m_stack]))
            else:
                idx = int(np.argmax(scored))
            mask = m_stack[idx]

            # If the decoder returned a 256² low-res mask, upsample.
            if mask.shape != (orig_h, orig_w):
                mask = cv2.resize(mask, (orig_w, orig_h), interpolation=cv2.INTER_LINEAR)
            mask = (mask > 0).astype(np.uint8) * 255

            if kernel_grow > 0:
                mask = cv2.dilate(mask, kernel, iterations=kernel_grow)
            if kernel_shrink > 0:
                mask = cv2.erode(mask, kernel, iterations=kernel_shrink)

            mask_f = mask.astype(np.float32) / 255.0
            cutout = rgb.astype(np.float32) / 255.0 * mask_f[..., None]

            out_masks.append(torch.from_numpy(mask_f))
            out_cutouts.append(torch.from_numpy(cutout))

        return IO.NodeOutput(torch.stack(out_masks, dim=0), torch.stack(out_cutouts, dim=0))


class SubjectMaskExtension(ComfyExtension):
    @override
    async def get_node_list(self) -> list[type[IO.ComfyNode]]:
        return [SubjectMaskNode]


async def comfy_entrypoint() -> SubjectMaskExtension:
    return SubjectMaskExtension()
