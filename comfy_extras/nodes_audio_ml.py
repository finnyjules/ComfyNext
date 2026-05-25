"""ML-backed audio nodes (Whisper, Demucs).

Kept separate from `nodes_audio_effects.py` so the effects file stays
dependency-free. Whisper/Demucs are managed by their own caching libraries,
so the bundle registration uses `ready_check_fn` instead of explicit file URLs.
"""
from __future__ import annotations

import io as _io
import os

import numpy as np
import torch
import torchaudio
from typing_extensions import override

import folder_paths
from comfy_api.latest import ComfyExtension, IO

from comfy_extras._model_downloads import ModelBundle, register_bundle


_WHISPER_CACHE: dict[str, object] = {}

# Route Whisper + Demucs downloads to predictable subdirectories under
# `models/` so users can find the weights, swap them, etc.
_WHISPER_CACHE_DIR = os.path.join(folder_paths.models_dir, "whisper")
_DEMUCS_CACHE_DIR = os.path.join(folder_paths.models_dir, "demucs")
os.makedirs(_WHISPER_CACHE_DIR, exist_ok=True)
os.makedirs(_DEMUCS_CACHE_DIR, exist_ok=True)

# The toolbox card pre-installs the small default (`base` for Whisper, `htdemucs`
# for Demucs). Larger Whisper models / alternate Demucs variants still
# auto-download on first use of that combo box value.
_WHISPER_DEFAULT_SIZE = "base"
_DEMUCS_DEFAULT_MODEL = "htdemucs"


def _whisper_ready() -> bool:
    """True iff the default Whisper model directory has snapshot files on disk."""
    cache_root = os.path.join(_WHISPER_CACHE_DIR, f"models--Systran--faster-whisper-{_WHISPER_DEFAULT_SIZE}")
    if not os.path.isdir(cache_root):
        return False
    snapshots = os.path.join(cache_root, "snapshots")
    if not os.path.isdir(snapshots):
        return False
    for rev in os.listdir(snapshots):
        rev_dir = os.path.join(snapshots, rev)
        if os.path.isfile(os.path.join(rev_dir, "model.bin")):
            return True
    return False


def _demucs_ready() -> bool:
    """True iff the default Demucs model is in the torch hub cache."""
    # Demucs uses torch.hub by default, which honours TORCH_HOME / XDG_CACHE_HOME.
    # We set TORCH_HOME to our models/demucs at prepare time, so look there first,
    # then fall back to the standard locations for users who already have it.
    candidates = [
        os.path.join(_DEMUCS_CACHE_DIR, "hub", "checkpoints"),
        os.path.expanduser("~/.cache/torch/hub/checkpoints"),
    ]
    for d in candidates:
        if os.path.isdir(d) and any(f.endswith(".th") for f in os.listdir(d)):
            return True
    return False


def _prepare_whisper() -> None:
    """Force-download the default faster-whisper model into our cache dir."""
    from faster_whisper import WhisperModel
    device = "cuda" if torch.cuda.is_available() else "cpu"
    compute_type = "float16" if device == "cuda" else "int8"
    WhisperModel(_WHISPER_DEFAULT_SIZE, device=device, compute_type=compute_type,
                 download_root=_WHISPER_CACHE_DIR)


def _prepare_demucs() -> None:
    """Force-download the default Demucs model into our cache dir."""
    # Route torch.hub at our cache so the .th file lands somewhere predictable.
    os.environ["TORCH_HOME"] = _DEMUCS_CACHE_DIR
    from demucs.pretrained import get_model
    m = get_model(_DEMUCS_DEFAULT_MODEL)
    m.eval()


register_bundle(ModelBundle(
    key="whisper",
    label="Speech Transcribe",
    files=[],                        # library-managed download — see ready_check_fn
    prepare_fn=_prepare_whisper,
    ready_check_fn=_whisper_ready,
))

register_bundle(ModelBundle(
    key="demucs",
    label="Vocal Separator",
    files=[],
    prepare_fn=_prepare_demucs,
    ready_check_fn=_demucs_ready,
))


def _audio_to_mono16k(audio) -> np.ndarray:
    """Whisper expects float32 mono PCM at 16 kHz."""
    waveform: torch.Tensor = audio["waveform"]
    sr = int(audio["sample_rate"])
    # waveform is [B, C, T] — take batch 0, mix down to mono.
    if waveform.dim() == 3:
        wav = waveform[0]
    else:
        wav = waveform
    if wav.dim() == 2 and wav.shape[0] > 1:
        wav = wav.mean(dim=0, keepdim=True)
    if sr != 16000:
        wav = torchaudio.functional.resample(wav, sr, 16000)
    return wav.squeeze(0).contiguous().cpu().numpy().astype(np.float32)


def _format_srt_time(seconds: float) -> str:
    ms = int(round(seconds * 1000))
    h, ms = divmod(ms, 3_600_000)
    m, ms = divmod(ms, 60_000)
    s, ms = divmod(ms, 1000)
    return f"{h:02d}:{m:02d}:{s:02d},{ms:03d}"


class WhisperTranscribeNode(IO.ComfyNode):
    """Transcribe an audio clip with Whisper. Outputs both a CaptionTrack-format
    string (`start_frame end_frame text` per line) and a standard SRT string.
    """

    @classmethod
    def define_schema(cls):
        return IO.Schema(
            node_id="WhisperTranscribe",
            display_name="Whisper Transcribe",
            description="Speech-to-text via faster-whisper. Feed the caption_track output "
                        "directly into a Caption Track node.",
            category="audio",
            inputs=[
                IO.Audio.Input("audio", tooltip="Drop a clip of speech here. Whisper handles dozens of languages; background music usually doesn't trip it up."),
                IO.Combo.Input(
                    "model_size",
                    options=["tiny", "base", "small", "medium", "large-v3"],
                    default="base",
                    tooltip="Which Whisper model to use. Bigger models transcribe more accurately but take more memory and time. "
                            "`tiny` is for quick previews; `base` is the everyday choice; `large-v3` for final captions where every word matters.",
                ),
                IO.String.Input(
                    "language",
                    default="auto",
                    tooltip="Spoken language. `auto` lets Whisper detect it. If you already know it, set a 2-letter code "
                            "(`en` English, `fr` French, `es` Spanish, `de` German, `ja` Japanese, etc.) — it'll be faster and more accurate.",
                ),
                IO.Float.Input(
                    "fps", default=30.0, min=1.0, max=120.0, step=0.01,
                    tooltip="Frame rate of the video you're captioning. Whisper outputs timestamps in seconds — this converts them "
                            "into frame numbers so the Caption Track node lines up exactly with your footage.",
                ),
            ],
            outputs=[
                IO.String.Output(display_name="caption_track"),
                IO.String.Output(display_name="srt"),
                IO.String.Output(display_name="text"),
            ],
        )

    @classmethod
    def execute(cls, audio, model_size, language, fps) -> IO.NodeOutput:
        from faster_whisper import WhisperModel

        key = f"{model_size}"
        model = _WHISPER_CACHE.get(key)
        if model is None:
            # CPU on Mac (no CUDA), int8 keeps memory + speed reasonable.
            device = "cuda" if torch.cuda.is_available() else "cpu"
            compute_type = "float16" if device == "cuda" else "int8"
            model = WhisperModel(
                model_size, device=device, compute_type=compute_type,
                download_root=_WHISPER_CACHE_DIR,
            )
            _WHISPER_CACHE[key] = model

        samples = _audio_to_mono16k(audio)
        lang_arg = None if language.strip().lower() in ("", "auto") else language.strip()
        segments, _info = model.transcribe(samples, language=lang_arg, vad_filter=True)

        caption_lines: list[str] = []
        srt_chunks: list[str] = []
        all_text: list[str] = []
        for i, seg in enumerate(segments, start=1):
            text = seg.text.strip()
            if not text:
                continue
            start_f = int(round(seg.start * fps))
            end_f = max(int(round(seg.end * fps)), start_f + 1)
            caption_lines.append(f"{start_f} {end_f} {text}")
            srt_chunks.append(
                f"{i}\n{_format_srt_time(seg.start)} --> {_format_srt_time(seg.end)}\n{text}\n"
            )
            all_text.append(text)

        return IO.NodeOutput(
            "\n".join(caption_lines),
            "\n".join(srt_chunks),
            " ".join(all_text),
        )


class VocalSeparatorNode(IO.ComfyNode):
    """Split a song into vocals + instrumental using Demucs (4-stem htdemucs).

    Emits both stems so the same node covers karaoke (use `instrumental`) and
    a-cappella (use `vocals`) workflows.
    """

    @classmethod
    def define_schema(cls):
        return IO.Schema(
            node_id="VocalSeparator",
            display_name="Vocal Separator",
            description="Demucs source separation — outputs vocals and instrumental stems.",
            category="audio",
            inputs=[
                IO.Audio.Input("audio", tooltip="Drop a song here. Stereo gives the cleanest separation; mono works but will sound a bit thinner."),
                IO.Combo.Input(
                    "model",
                    options=["htdemucs", "htdemucs_ft", "mdx_extra"],
                    default="htdemucs",
                    tooltip="Which separation model to use. `htdemucs` is the default and works well for almost everything. "
                            "`htdemucs_ft` is slightly cleaner but ~4× slower — use it for a final pass. "
                            "`mdx_extra` is an older lighter model — try it if the others are too slow on your machine.",
                ),
                IO.Int.Input(
                    "shifts", default=1, min=0, max=10, step=1,
                    tooltip="How many times to re-process the song with tiny offsets and average the results — more passes means a cleaner "
                            "separation but takes longer. 0 is fastest (rough preview), 1 is the default sweet spot, 5+ is for "
                            "archival-quality work where you need the absolute best.",
                ),
            ],
            outputs=[
                IO.Audio.Output(display_name="vocals"),
                IO.Audio.Output(display_name="instrumental"),
            ],
        )

    @classmethod
    def execute(cls, audio, model, shifts) -> IO.NodeOutput:
        from demucs.apply import apply_model
        from demucs.pretrained import get_model

        key = f"demucs:{model}"
        sep_model = _WHISPER_CACHE.get(key)
        if sep_model is None:
            # Use the same cache dir the toolbox card pre-populated, so we read
            # already-downloaded weights instead of fetching them again.
            os.environ.setdefault("TORCH_HOME", _DEMUCS_CACHE_DIR)
            sep_model = get_model(model)
            sep_model.eval()
            _WHISPER_CACHE[key] = sep_model

        waveform: torch.Tensor = audio["waveform"]
        sr = int(audio["sample_rate"])
        target_sr = int(sep_model.samplerate)

        # Demucs wants [C, T] at its native rate (44.1kHz for htdemucs). Take
        # batch 0 and resample if needed.
        wav = waveform[0] if waveform.dim() == 3 else waveform
        if wav.dim() == 1:
            wav = wav.unsqueeze(0)
        if wav.shape[0] == 1:
            # Mono → fake stereo so the stereo-trained model is happy.
            wav = wav.repeat(2, 1)
        elif wav.shape[0] > 2:
            wav = wav[:2]
        if sr != target_sr:
            wav = torchaudio.functional.resample(wav, sr, target_sr)

        device = "cuda" if torch.cuda.is_available() else "cpu"
        with torch.no_grad():
            stems = apply_model(
                sep_model, wav.unsqueeze(0).to(device),
                device=device, shifts=shifts, split=True, progress=False,
            )[0].cpu()  # [S, C, T]

        sources = list(sep_model.sources)
        vocal_idx = sources.index("vocals")
        vocals = stems[vocal_idx]
        instrumental = stems.sum(dim=0) - vocals  # sum of all non-vocal stems

        return IO.NodeOutput(
            {"waveform": vocals.unsqueeze(0), "sample_rate": target_sr},
            {"waveform": instrumental.unsqueeze(0), "sample_rate": target_sr},
        )


class AudioMLExtension(ComfyExtension):
    @override
    async def get_node_list(self) -> list[type[IO.ComfyNode]]:
        return [WhisperTranscribeNode, VocalSeparatorNode]


async def comfy_entrypoint() -> AudioMLExtension:
    return AudioMLExtension()
