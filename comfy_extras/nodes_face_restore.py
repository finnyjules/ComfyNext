"""Face restoration via CodeFormer (~360 MB).

CodeFormer is the current best-in-class for repairing blurry, compressed,
or AI-mangled faces. The pipeline mirrors industry-standard face restorers:
detect faces with InsightFace, align each to 512² using the 5-keypoint
FFHQ template, run CodeFormer, paste back over the original frame with a
soft elliptical blend.

Pairs especially well with our `FaceSwap` and `Upscale` nodes — chain them
and the output looks studio-grade.
"""
from __future__ import annotations

import os
from typing import Any

import cv2
import numpy as np
import torch
from typing_extensions import override

import folder_paths
from comfy_api.latest import ComfyExtension, IO

from comfy_extras._model_downloads import (
    ModelBundle, ModelFile, loader_cache, register_bundle,
)


# We co-locate the CodeFormer ONNX under models/face_restore so it sits next
# to whatever else we'll add later (GFPGAN, RestoreFormer, etc.).
_MODELS_ROOT = os.path.join(folder_paths.models_dir, "face_restore")
_MODEL_PATH = os.path.join(_MODELS_ROOT, "codeformer.onnx")
_MODEL_URLS = [
    "https://huggingface.co/maitruclam/comfyui-faceswap-models/resolve/main/codeformer-v0.1.0.onnx",
    "https://huggingface.co/spaces/sczhou/CodeFormer/resolve/main/codeformer.onnx",
]
_MODEL_SIZE = 376_322_336  # bytes, the v0.1.0 ONNX export


register_bundle(ModelBundle(
    key="facerestore",
    label="Face Restoration",
    files=[ModelFile(name="codeformer.onnx", path=_MODEL_PATH, size=_MODEL_SIZE, urls=_MODEL_URLS)],
    # Face detection rides on InsightFace's buffalo_l — kick off its lazy load
    # here so the progress toast covers both downloads.
    prepare_fn=lambda: _get_analyzer(),
))


# ---------------------------------------------------------------------------
# Lazy model loading
# ---------------------------------------------------------------------------

_RESTORE_CACHE: dict[str, Any] = {}


def _get_analyzer():
    """InsightFace face detector (buffalo_l). Shared with FaceSwap if already loaded."""
    if "analyzer" in _RESTORE_CACHE:
        return _RESTORE_CACHE["analyzer"]
    from insightface.app import FaceAnalysis
    providers = (
        ["CoreMLExecutionProvider", "CPUExecutionProvider"]
        if not torch.cuda.is_available()
        else ["CUDAExecutionProvider", "CPUExecutionProvider"]
    )
    app = FaceAnalysis(name="buffalo_l", providers=providers, allowed_modules=["detection", "landmark_2d_106"])
    app.prepare(ctx_id=0, det_size=(640, 640))
    _RESTORE_CACHE["analyzer"] = app
    return app


def _get_session():
    if "session" in _RESTORE_CACHE:
        return _RESTORE_CACHE["session"]
    import onnxruntime as ort
    providers = (
        ["CoreMLExecutionProvider", "CPUExecutionProvider"]
        if not torch.cuda.is_available()
        else ["CUDAExecutionProvider", "CPUExecutionProvider"]
    )
    sess = ort.InferenceSession(_MODEL_PATH, providers=providers)
    _RESTORE_CACHE["session"] = sess
    return sess


# ---------------------------------------------------------------------------
# Helpers — alignment + paste-back
# ---------------------------------------------------------------------------

# FFHQ-style 5-point landmark template for a 512×512 aligned face.
# Source: insightface.utils.face_align.arcface_dst, rescaled from 112 → 512.
_FFHQ_512 = np.array([
    [192.98, 239.95],
    [318.90, 240.19],
    [256.63, 314.01],
    [201.26, 371.41],
    [313.08, 371.15],
], dtype=np.float32)


def _align_face(bgr: np.ndarray, kps: np.ndarray) -> tuple[np.ndarray, np.ndarray]:
    """Crop + align the face to 512² using its 5 keypoints.

    Returns (aligned_bgr, M) where M is the 2×3 affine for warpAffine — we keep
    it so the restored crop can be warped back into the original frame.
    """
    M, _ = cv2.estimateAffinePartial2D(kps.astype(np.float32), _FFHQ_512, method=cv2.LMEDS)
    if M is None:
        return None, None  # alignment failed, skip this face
    aligned = cv2.warpAffine(bgr, M, (512, 512), flags=cv2.INTER_LINEAR, borderMode=cv2.BORDER_REPLICATE)
    return aligned, M


def _make_face_mask() -> np.ndarray:
    """Soft elliptical mask (512², float32 [0, 1]) for blending the restored
    face into the source frame without a visible seam."""
    mask = np.zeros((512, 512), dtype=np.float32)
    cv2.ellipse(mask, (256, 286), (190, 240), 0, 0, 360, 1.0, -1)
    mask = cv2.GaussianBlur(mask, (51, 51), 25)
    return mask


_FACE_MASK = _make_face_mask()


# ---------------------------------------------------------------------------
# Node
# ---------------------------------------------------------------------------

class FaceRestoreNode(IO.ComfyNode):
    """Repair blurry / compressed / AI-mangled faces.

    Runs on stills and on video batches. Every detected face is restored —
    use `face_index` to limit to one if multiple faces appear and you only
    want to touch the main subject.
    """

    @classmethod
    def define_schema(cls):
        return IO.Schema(
            node_id="FaceRestore",
            display_name="Face Restoration",
            description="CodeFormer face restoration — sharpens facial detail, removes JPEG-style "
                        "artefacts, fixes the muddy look of low-resolution or AI-generated faces.",
            category="image",
            inputs=[
                IO.Image.Input("frames", tooltip="Image or video frames to restore."),
                IO.Float.Input("fidelity", default=0.7, min=0.0, max=1.0, step=0.05,
                               tooltip="0.0 = max realism (CodeFormer hallucinates clean detail, identity may drift slightly). "
                                       "1.0 = max fidelity (stays close to the input pixels, less aggressive restoration). "
                                       "0.7 is the sweet spot for AI-generated faces; 0.5 for very degraded source material."),
                IO.Int.Input("face_index", default=-1, min=-1, max=20, step=1,
                             tooltip="Which face to restore. `-1` restores all detected faces (typical for group shots). "
                                     "`0` is the largest face only (main subject). `1, 2, …` pick smaller faces in size order."),
                IO.Float.Input("threshold", default=0.5, min=0.1, max=0.95, step=0.05,
                               tooltip="Detector confidence. Lower (0.3) picks up profile and partial faces but can false-positive on busy backgrounds. "
                                       "Higher (0.7+) only touches clearly-visible frontal faces."),
            ],
            outputs=[
                IO.Image.Output(display_name="frames"),
                IO.Mask.Output(display_name="restored_mask"),
            ],
        )

    @classmethod
    def execute(cls, frames, fidelity, face_index, threshold) -> IO.NodeOutput:
        if not os.path.isfile(_MODEL_PATH):
            raise RuntimeError(
                "CodeFormer model not found. Click the Face Restoration card in the toolbox "
                "to download it (~360 MB)."
            )

        analyzer = _get_analyzer()
        analyzer.det_model.det_thresh = float(threshold)
        session = _get_session()
        in_names = [i.name for i in session.get_inputs()]
        # Some CodeFormer ONNX exports take a separate fidelity weight; others
        # have it baked. Detect by input count.
        has_weight_input = len(in_names) >= 2

        out_frames: list[torch.Tensor] = []
        out_masks: list[torch.Tensor] = []

        for t in range(frames.shape[0]):
            rgb = (frames[t].detach().cpu().numpy() * 255.0).clip(0, 255).astype(np.uint8)
            bgr = rgb[..., ::-1].copy()
            faces = analyzer.get(bgr)

            mask_full = np.zeros(bgr.shape[:2], dtype=np.float32)

            if not faces:
                out_frames.append(torch.from_numpy(rgb.astype(np.float32) / 255.0))
                out_masks.append(torch.from_numpy(mask_full))
                continue

            faces.sort(key=lambda f: (f.bbox[2] - f.bbox[0]) * (f.bbox[3] - f.bbox[1]), reverse=True)
            if face_index == -1:
                to_restore = faces
            else:
                idx = min(max(face_index, 0), len(faces) - 1)
                to_restore = [faces[idx]]

            result = bgr.copy()
            for face in to_restore:
                aligned, M = _align_face(bgr, face.kps)
                if aligned is None:
                    continue

                # ONNX expects RGB float32 [-1, 1], NCHW.
                aligned_rgb = aligned[..., ::-1].astype(np.float32) / 127.5 - 1.0
                inp = aligned_rgb.transpose(2, 0, 1)[None]

                feeds = {in_names[0]: inp.astype(np.float32)}
                if has_weight_input:
                    feeds[in_names[1]] = np.array([float(fidelity)], dtype=np.double)

                try:
                    restored = session.run(None, feeds)[0]
                except Exception:
                    # Some exports want float32 for the weight input.
                    if has_weight_input:
                        feeds[in_names[1]] = np.array([float(fidelity)], dtype=np.float32)
                        restored = session.run(None, feeds)[0]
                    else:
                        raise

                # Back to BGR uint8.
                restored = restored[0].transpose(1, 2, 0)
                restored = ((restored + 1.0) * 127.5).clip(0, 255).astype(np.uint8)
                restored_bgr = restored[..., ::-1]

                # Warp the restored face back to the original frame.
                inv_M = cv2.invertAffineTransform(M)
                warped = cv2.warpAffine(restored_bgr, inv_M, (bgr.shape[1], bgr.shape[0]),
                                        flags=cv2.INTER_LINEAR, borderMode=cv2.BORDER_REPLICATE)
                warped_mask = cv2.warpAffine(_FACE_MASK, inv_M, (bgr.shape[1], bgr.shape[0]),
                                             flags=cv2.INTER_LINEAR, borderMode=cv2.BORDER_CONSTANT)

                wm = warped_mask[..., None]
                result = (warped.astype(np.float32) * wm + result.astype(np.float32) * (1.0 - wm)).astype(np.uint8)
                mask_full = np.maximum(mask_full, warped_mask)

            out_rgb = result[..., ::-1].astype(np.float32) / 255.0
            out_frames.append(torch.from_numpy(out_rgb))
            out_masks.append(torch.from_numpy(mask_full))

        return IO.NodeOutput(torch.stack(out_frames, dim=0), torch.stack(out_masks, dim=0))


class FaceRestoreExtension(ComfyExtension):
    @override
    async def get_node_list(self) -> list[type[IO.ComfyNode]]:
        return [FaceRestoreNode]


async def comfy_entrypoint() -> FaceRestoreExtension:
    return FaceRestoreExtension()
