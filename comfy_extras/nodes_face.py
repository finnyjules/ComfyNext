"""Face swap node. Model weights are managed by `_model_downloads`.

Pipeline (industry-standard since 2022): InsightFace `buffalo_l` detects and
embeds faces → `inswapper_128.onnx` runs the swap on aligned 128² crops →
result is pasted back into the original frame.
"""
from __future__ import annotations

import os
from typing import Any

import numpy as np
import torch
from typing_extensions import override

import folder_paths
from comfy_api.latest import ComfyExtension, IO
from comfy_extras._live_preview import save_live_preview

from comfy_extras._model_downloads import (
    ModelBundle, ModelFile, loader_cache, register_bundle,
)


# ---------------------------------------------------------------------------
# Model registry
# ---------------------------------------------------------------------------

# We put inswapper alongside other insightface bundles under models/insightface/
# so users can spot it next to the auto-downloaded buffalo_l package.
_MODELS_ROOT = os.path.join(folder_paths.models_dir, "insightface")


# Multiple mirrors so a single one going 401/404 doesn't break the feature.
# All host the same official file; we try them in order until one streams bytes.
_INSWAPPER_URLS = [
    "https://huggingface.co/datasets/Gourieff/ReActor/resolve/main/models/inswapper_128.onnx",
    "https://huggingface.co/ezioruan/inswapper_128.onnx/resolve/main/inswapper_128.onnx",
    "https://github.com/facefusion/facefusion-assets/releases/download/models-3.0.0/inswapper_128.onnx",
]
_INSWAPPER_PATH = os.path.join(_MODELS_ROOT, "inswapper_128.onnx")
_INSWAPPER_SIZE = 554_253_681  # bytes, official file size


# Register with the shared download infra. Touching this module is enough — the
# toolbox can then query /comfynext/models/status?key=faceswap.
register_bundle(ModelBundle(
    key="faceswap",
    label="Face Swap",
    files=[ModelFile(
        name="inswapper_128.onnx",
        path=_INSWAPPER_PATH,
        size=_INSWAPPER_SIZE,
        urls=_INSWAPPER_URLS,
    )],
    # buffalo_l (detection + embedding) is auto-fetched by insightface on its
    # first `prepare()` call. Wire it as a prepare step so the toolbox progress
    # toast doesn't disappear before insightface has finished initialising.
    prepare_fn=lambda: _get_analyzer(),
))


# ---------------------------------------------------------------------------
# Lazy model loading
# ---------------------------------------------------------------------------

_FACE_CACHE: dict[str, Any] = {}


def _get_analyzer():
    """InsightFace face detector + embedder (buffalo_l auto-downloads)."""
    if "analyzer" in _FACE_CACHE:
        return _FACE_CACHE["analyzer"]
    from insightface.app import FaceAnalysis
    providers = ["CoreMLExecutionProvider", "CPUExecutionProvider"] \
        if not torch.cuda.is_available() else ["CUDAExecutionProvider", "CPUExecutionProvider"]
    app = FaceAnalysis(name="buffalo_l", providers=providers)
    app.prepare(ctx_id=0, det_size=(640, 640))
    _FACE_CACHE["analyzer"] = app
    return app


def _get_swapper():
    if "swapper" in _FACE_CACHE:
        return _FACE_CACHE["swapper"]
    from insightface.model_zoo import get_model
    providers = ["CoreMLExecutionProvider", "CPUExecutionProvider"] \
        if not torch.cuda.is_available() else ["CUDAExecutionProvider", "CPUExecutionProvider"]
    swapper = get_model(_INSWAPPER_PATH, providers=providers)
    _FACE_CACHE["swapper"] = swapper
    return swapper


# ---------------------------------------------------------------------------
# Image conversion helpers
# ---------------------------------------------------------------------------

def _tensor_to_bgr(image: torch.Tensor) -> np.ndarray:
    """[H, W, 3] float in [0, 1] (RGB) → [H, W, 3] uint8 (BGR for OpenCV/insightface)."""
    arr = (image.detach().cpu().numpy() * 255.0).clip(0, 255).astype(np.uint8)
    return arr[..., ::-1].copy()  # RGB → BGR


def _bgr_to_tensor(bgr: np.ndarray) -> torch.Tensor:
    """[H, W, 3] uint8 BGR → [H, W, 3] float in [0, 1] RGB."""
    rgb = bgr[..., ::-1].astype(np.float32) / 255.0
    return torch.from_numpy(rgb.copy())


def _bbox_iou(a, b) -> float:
    ax1, ay1, ax2, ay2 = a
    bx1, by1, bx2, by2 = b
    inter_w = max(0.0, min(ax2, bx2) - max(ax1, bx1))
    inter_h = max(0.0, min(ay2, by2) - max(ay1, by1))
    inter = inter_w * inter_h
    if inter <= 0:
        return 0.0
    a_area = (ax2 - ax1) * (ay2 - ay1)
    b_area = (bx2 - bx1) * (by2 - by1)
    return inter / (a_area + b_area - inter)


# ---------------------------------------------------------------------------
# FaceSwap node
# ---------------------------------------------------------------------------

class FaceSwapNode(IO.ComfyNode):
    """Swap a reference face onto every frame of a target.

    Works on a single image or a video batch. For video, the same target face
    is tracked across frames via bbox-IoU against the previous pick, so the
    identity doesn't wobble when a second face appears or the main subject
    moves.
    """

    @classmethod
    def define_schema(cls):
        return IO.Schema(
            node_id="FaceSwap",
            display_name="Face Swap",
            description="Replace a face in the target with the face from a reference image. "
                        "Please don't use on real people without their consent, or on minors.",
            category="image",
            inputs=[
                IO.Image.Input("source_face", tooltip="Reference photo of the face you want to USE. "
                                                       "Crop close, well-lit, looking roughly at camera works best."),
                IO.Image.Input("target_frames", tooltip="The image or video frames where the face will be REPLACED. "
                                                        "A video batch is processed frame-by-frame with identity tracking."),
                IO.Int.Input("face_index", default=0, min=-1, max=20, step=1,
                             tooltip="Which face in the target to swap when several are detected. "
                                     "`0` = largest face (the typical main subject). `1, 2, …` = additional faces sorted by size. "
                                     "`-1` = swap every detected face with the same source identity."),
                IO.Float.Input("threshold", default=0.5, min=0.1, max=0.95, step=0.05,
                               tooltip="How confident the detector has to be that something is a face. "
                                       "Lower (0.3) catches profiles and partial faces but also more false positives. "
                                       "Higher (0.7+) only swaps clear, frontal faces."),
            ],
            outputs=[
                IO.Image.Output(display_name="frames"),
                IO.Mask.Output(display_name="swap_mask"),
            ],
            hidden=[IO.Hidden.unique_id],
            # Emit the result so the frontend captures it (data.images) — lets the
            # output preview on the node and composite anywhere it's wired (Frame).
            is_output_node=True,
        )

    @classmethod
    def execute(cls, source_face, target_frames, face_index, threshold) -> IO.NodeOutput:
        if not os.path.isfile(_INSWAPPER_PATH):
            raise RuntimeError(
                "inswapper_128.onnx not found. Click the Face Swap card in the toolbox "
                "to download it (~530 MB)."
            )

        analyzer = _get_analyzer()
        # Detector confidence is set at prepare-time but read at runtime — bump
        # the threshold on the in-memory model.
        analyzer.det_model.det_thresh = float(threshold)
        swapper = _get_swapper()

        # 1) Pull the source identity (use the largest face in source_face[0]).
        source_bgr = _tensor_to_bgr(source_face[0])
        source_faces = analyzer.get(source_bgr)
        if not source_faces:
            raise RuntimeError("No face found in source_face. Try a closer crop or better lighting.")
        source_face_obj = max(source_faces, key=lambda f: (f.bbox[2] - f.bbox[0]) * (f.bbox[3] - f.bbox[1]))

        # 2) Walk the target batch. For video stability, lock onto the face
        # whose bbox best matches the one we picked in the previous frame.
        out_frames: list[torch.Tensor] = []
        out_masks: list[torch.Tensor] = []
        last_bbox: list[float] | None = None

        for t in range(target_frames.shape[0]):
            tgt_bgr = _tensor_to_bgr(target_frames[t])
            tgt_faces = analyzer.get(tgt_bgr)
            mask = torch.zeros(tgt_bgr.shape[:2], dtype=torch.float32)

            if not tgt_faces:
                out_frames.append(_bgr_to_tensor(tgt_bgr))
                out_masks.append(mask)
                last_bbox = None
                continue

            # Sort by area (largest first) so face_index=0 means the main subject.
            tgt_faces.sort(key=lambda f: (f.bbox[2] - f.bbox[0]) * (f.bbox[3] - f.bbox[1]), reverse=True)

            if face_index == -1:
                to_swap = tgt_faces
            elif last_bbox is not None:
                # Video tracking: prefer the face that best matches last frame's pick.
                best_iou, best_face = 0.0, tgt_faces[0]
                for f in tgt_faces:
                    iou = _bbox_iou(last_bbox, f.bbox.tolist())
                    if iou > best_iou:
                        best_iou, best_face = iou, f
                to_swap = [best_face] if best_iou > 0.1 else [tgt_faces[min(face_index, len(tgt_faces) - 1)]]
            else:
                idx = min(max(face_index, 0), len(tgt_faces) - 1)
                to_swap = [tgt_faces[idx]]

            result = tgt_bgr
            for face in to_swap:
                result = swapper.get(result, face, source_face_obj, paste_back=True)
                x1, y1, x2, y2 = (int(v) for v in face.bbox)
                x1, y1 = max(0, x1), max(0, y1)
                x2, y2 = min(mask.shape[1], x2), min(mask.shape[0], y2)
                mask[y1:y2, x1:x2] = 1.0

            last_bbox = to_swap[0].bbox.tolist() if len(to_swap) == 1 else None
            out_frames.append(_bgr_to_tensor(result))
            out_masks.append(mask)

        frames_out = torch.stack(out_frames, dim=0)
        masks_out = torch.stack(out_masks, dim=0)
        return IO.NodeOutput(
            frames_out, masks_out,
            ui=save_live_preview(frames_out, str(cls.hidden.unique_id)),
        )


# ---------------------------------------------------------------------------
# Extension registration
# ---------------------------------------------------------------------------

class FaceExtension(ComfyExtension):
    @override
    async def get_node_list(self) -> list[type[IO.ComfyNode]]:
        return [FaceSwapNode]


async def comfy_entrypoint() -> FaceExtension:
    return FaceExtension()
