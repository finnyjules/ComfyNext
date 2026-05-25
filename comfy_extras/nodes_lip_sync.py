"""Lip sync via Wav2Lip GAN (~140 MB).

Re-syncs the mouth region of a talking-head video to a new audio track —
the workhorse model for "make this person say that".

Pipeline:
  1. InsightFace detects the face once per frame, we expand to a square crop
     around the mouth/jaw region.
  2. Audio → mel spectrogram (80 mel bins, 200-sample hop @ 16kHz). Each
     output video frame consumes a 16-frame mel window.
  3. The model gets paired (masked face, reference face) crops plus the mel
     window; it predicts the bottom-half pixels (mouth + jaw).
  4. The predicted region is alpha-blended back into the original frame.
"""
from __future__ import annotations

import os
from typing import Any

import cv2
import numpy as np
import torch
import torchaudio
from typing_extensions import override

import folder_paths
from comfy_api.latest import ComfyExtension, IO

from comfy_extras._model_downloads import (
    ModelBundle, ModelFile, loader_cache, register_bundle,
)


_MODELS_ROOT = os.path.join(folder_paths.models_dir, "wav2lip")
_MODEL_PATH = os.path.join(_MODELS_ROOT, "wav2lip_gan.onnx")
_MODEL_URLS = [
    "https://huggingface.co/maitruclam/wav2lip-onnx/resolve/main/wav2lip_gan.onnx",
    "https://huggingface.co/numz/wav2lip_studio/resolve/main/wav2lip_gan.onnx",
]
_MODEL_SIZE = 0  # mirror sizes vary slightly — accept any non-empty file


register_bundle(ModelBundle(
    key="lipsync",
    label="Lip Sync",
    files=[ModelFile(name="wav2lip_gan.onnx", path=_MODEL_PATH, size=_MODEL_SIZE, urls=_MODEL_URLS)],
    prepare_fn=lambda: _get_analyzer(),  # warm InsightFace alongside the download
))


# ---------------------------------------------------------------------------
# Lazy loaders
# ---------------------------------------------------------------------------

_LIPSYNC_CACHE: dict[str, Any] = {}


def _get_analyzer():
    if "analyzer" in _LIPSYNC_CACHE:
        return _LIPSYNC_CACHE["analyzer"]
    from insightface.app import FaceAnalysis
    providers = (
        ["CoreMLExecutionProvider", "CPUExecutionProvider"]
        if not torch.cuda.is_available()
        else ["CUDAExecutionProvider", "CPUExecutionProvider"]
    )
    app = FaceAnalysis(name="buffalo_l", providers=providers, allowed_modules=["detection"])
    app.prepare(ctx_id=0, det_size=(640, 640))
    _LIPSYNC_CACHE["analyzer"] = app
    return app


def _get_session():
    if "session" in _LIPSYNC_CACHE:
        return _LIPSYNC_CACHE["session"]
    import onnxruntime as ort
    providers = (
        ["CoreMLExecutionProvider", "CPUExecutionProvider"]
        if not torch.cuda.is_available()
        else ["CUDAExecutionProvider", "CPUExecutionProvider"]
    )
    sess = ort.InferenceSession(_MODEL_PATH, providers=providers)
    _LIPSYNC_CACHE["session"] = sess
    return sess


# ---------------------------------------------------------------------------
# Mel spectrogram — match Wav2Lip's training config exactly
# ---------------------------------------------------------------------------
# Source: Wav2Lip/audio.py — sample_rate=16000, n_fft=800, hop=200, win=800,
# n_mels=80, fmin=55, fmax=7600, dynamic-range-compressed log.

_W2L_SR = 16000
_W2L_HOP = 200
_W2L_WIN = 800
_W2L_N_FFT = 800
_W2L_N_MELS = 80
_W2L_FMIN = 55
_W2L_FMAX = 7600
_MEL_CHUNK_SIZE = 16        # mel frames per video frame
_MEL_FRAMES_PER_VIDEO_SECOND = _W2L_SR / _W2L_HOP  # = 80 mel frames/sec


def _audio_to_mel(audio) -> np.ndarray:
    """Wav2Lip-flavoured log-mel spectrogram. Output: [80, T_mel]."""
    waveform: torch.Tensor = audio["waveform"]
    sr = int(audio["sample_rate"])
    wav = waveform[0] if waveform.dim() == 3 else waveform
    if wav.dim() == 2 and wav.shape[0] > 1:
        wav = wav.mean(dim=0, keepdim=True)
    if sr != _W2L_SR:
        wav = torchaudio.functional.resample(wav, sr, _W2L_SR)
    wav = wav.squeeze(0).cpu().numpy().astype(np.float32)

    # Mel filterbank — slaney scale matches librosa default.
    mel = torchaudio.transforms.MelSpectrogram(
        sample_rate=_W2L_SR, n_fft=_W2L_N_FFT, win_length=_W2L_WIN,
        hop_length=_W2L_HOP, f_min=_W2L_FMIN, f_max=_W2L_FMAX, n_mels=_W2L_N_MELS,
        power=1.0, mel_scale="slaney", norm="slaney",
    )(torch.from_numpy(wav)).numpy()

    # Dynamic-range compressed log (matches Wav2Lip audio.py `_amp_to_db`).
    min_level = np.exp(-100 / 20 * np.log(10))
    mel = 20 * np.log10(np.maximum(min_level, mel)) - 20
    mel = np.clip((mel + 100) / 100, 0, 1)  # normalise to [0, 1] as in training
    mel = mel * 8 - 4                       # re-scale to Wav2Lip's [-4, 4] range
    return mel.astype(np.float32)


# ---------------------------------------------------------------------------
# Face crop / paste helpers
# ---------------------------------------------------------------------------

_FACE_SIZE = 96  # Wav2Lip processes 96² crops


def _face_crop_box(bbox: np.ndarray, h: int, w: int, pad_ratio: float = 0.15) -> tuple[int, int, int, int]:
    """Expand the detected face box into a square with a little padding."""
    x1, y1, x2, y2 = bbox
    cx = (x1 + x2) / 2
    cy = (y1 + y2) / 2
    side = max(x2 - x1, y2 - y1) * (1 + pad_ratio)
    half = side / 2
    nx1 = int(max(0, cx - half))
    ny1 = int(max(0, cy - half))
    nx2 = int(min(w, cx + half))
    ny2 = int(min(h, cy + half))
    return nx1, ny1, nx2, ny2


def _make_paste_mask(size: int) -> np.ndarray:
    """Soft alpha mask for blending the lip-region prediction back in."""
    m = np.zeros((size, size), dtype=np.float32)
    # Lower 65% of the crop is what Wav2Lip predicts (mouth + jaw).
    m[int(size * 0.35):] = 1.0
    return cv2.GaussianBlur(m, (15, 15), 7)


# ---------------------------------------------------------------------------
# Node
# ---------------------------------------------------------------------------

class LipSyncNode(IO.ComfyNode):
    """Re-sync a talking head's mouth to a new audio track."""

    @classmethod
    def define_schema(cls):
        return IO.Schema(
            node_id="LipSync",
            display_name="Lip Sync",
            description="Wav2Lip — re-syncs the mouth region of a person to a new audio clip. "
                        "Works best on clear, frontal head-and-shoulders shots.",
            category="video",
            inputs=[
                IO.Image.Input("frames", tooltip="Video frames of a talking head. Frontal angle, "
                                                  "well-lit, mouth visible the whole time works best."),
                IO.Audio.Input("audio", tooltip="The audio to sync to. Clear speech without heavy music "
                                                 "or noise gives the cleanest lip movement."),
                IO.Float.Input("fps", default=25.0, min=1.0, max=120.0, step=0.01,
                               tooltip="Frame rate of the input video. Wav2Lip was trained at 25 fps — "
                                       "the model's mel/frame alignment assumes that. "
                                       "Set this to match your clip's actual fps for in-sync output."),
                IO.Float.Input("smoothing", default=0.5, min=0.0, max=1.0, step=0.05,
                               tooltip="Blend the predicted mouth with the original frame's mouth. "
                                       "0 = full replacement (most accurate sync, can flicker on subtle audio). "
                                       "1 = original mouth (no sync). 0.5 is the default sweet spot."),
            ],
            outputs=[IO.Image.Output(display_name="frames")],
        )

    @classmethod
    def execute(cls, frames, audio, fps, smoothing) -> IO.NodeOutput:
        if not os.path.isfile(_MODEL_PATH):
            raise RuntimeError(
                "Wav2Lip model not found. Click the Lip Sync card in the toolbox "
                "to download it (~140 MB)."
            )

        analyzer = _get_analyzer()
        session = _get_session()
        inputs = session.get_inputs()
        # Wav2Lip ONNX exports name inputs as either (mel, vid) or (audio_sequences,
        # video_sequences) depending on the export — index instead of name.
        in_mel = inputs[0].name
        in_vid = inputs[1].name

        T, H, W, _ = frames.shape
        mel = _audio_to_mel(audio)              # [80, T_mel]
        mel_frames_per_video_frame = _MEL_FRAMES_PER_VIDEO_SECOND / float(fps)
        paste_mask = _make_paste_mask(_FACE_SIZE)

        # Pre-detect faces once per frame for speed; track the best-matching box.
        face_boxes: list[tuple[int, int, int, int] | None] = []
        for t in range(T):
            rgb = (frames[t].detach().cpu().numpy() * 255.0).clip(0, 255).astype(np.uint8)
            bgr = rgb[..., ::-1].copy()
            faces = analyzer.get(bgr)
            if not faces:
                face_boxes.append(None)
                continue
            faces.sort(key=lambda f: (f.bbox[2] - f.bbox[0]) * (f.bbox[3] - f.bbox[1]), reverse=True)
            face_boxes.append(_face_crop_box(faces[0].bbox, H, W))

        out_frames: list[torch.Tensor] = []

        for t in range(T):
            rgb = (frames[t].detach().cpu().numpy() * 255.0).clip(0, 255).astype(np.uint8)
            box = face_boxes[t]

            if box is None:
                # No face detected — pass the frame through unchanged.
                out_frames.append(torch.from_numpy(rgb.astype(np.float32) / 255.0))
                continue

            x1, y1, x2, y2 = box
            crop = rgb[y1:y2, x1:x2]
            if crop.size == 0:
                out_frames.append(torch.from_numpy(rgb.astype(np.float32) / 255.0))
                continue

            face = cv2.resize(crop, (_FACE_SIZE, _FACE_SIZE), interpolation=cv2.INTER_LINEAR)
            # Reference = clean face, Input = face with lower half masked out.
            masked = face.copy()
            masked[_FACE_SIZE // 2:] = 0
            # Channel order: NCHW float32 [0, 1]. Concat: [masked | reference].
            paired = np.concatenate([masked, face], axis=2).astype(np.float32) / 255.0
            vid_in = paired.transpose(2, 0, 1)[None]  # [1, 6, 96, 96]

            # Mel slice — centred on this video frame.
            mel_center = t * mel_frames_per_video_frame
            mel_start = int(round(mel_center)) - _MEL_CHUNK_SIZE // 2
            mel_end = mel_start + _MEL_CHUNK_SIZE
            if mel_start < 0:
                pad_left = -mel_start
                mel_start = 0
            else:
                pad_left = 0
            if mel_end > mel.shape[1]:
                pad_right = mel_end - mel.shape[1]
                mel_end = mel.shape[1]
            else:
                pad_right = 0
            mel_slice = mel[:, mel_start:mel_end]
            if pad_left or pad_right:
                mel_slice = np.pad(mel_slice, ((0, 0), (pad_left, pad_right)), mode="edge")
            mel_in = mel_slice[None, None].astype(np.float32)  # [1, 1, 80, 16]

            pred = session.run(None, {in_mel: mel_in, in_vid: vid_in.astype(np.float32)})[0]
            pred = pred[0].transpose(1, 2, 0)
            pred = (pred * 255.0).clip(0, 255).astype(np.uint8)

            # Resize predicted crop back to the face box and paste with the mask.
            pred_full = cv2.resize(pred, (x2 - x1, y2 - y1), interpolation=cv2.INTER_LINEAR)
            mask_full = cv2.resize(paste_mask, (x2 - x1, y2 - y1), interpolation=cv2.INTER_LINEAR)
            mask_full *= (1.0 - float(smoothing))

            region = rgb[y1:y2, x1:x2].astype(np.float32)
            blended = pred_full.astype(np.float32) * mask_full[..., None] + region * (1.0 - mask_full[..., None])
            rgb_out = rgb.copy()
            rgb_out[y1:y2, x1:x2] = blended.astype(np.uint8)

            out_frames.append(torch.from_numpy(rgb_out.astype(np.float32) / 255.0))

        return IO.NodeOutput(torch.stack(out_frames, dim=0))


class LipSyncExtension(ComfyExtension):
    @override
    async def get_node_list(self) -> list[type[IO.ComfyNode]]:
        return [LipSyncNode]


async def comfy_entrypoint() -> LipSyncExtension:
    return LipSyncExtension()
