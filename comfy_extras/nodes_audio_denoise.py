"""Audio denoise via spectral gating (noisereduce).

No model download — runs entirely from analytical FFT statistics. Excellent
for hiss, room hum, fan noise, wind; reasonable on speech. Heavier ML
denoisers (DeepFilterNet, Facebook denoiser) exist but pull in Rust toolchain
or conflicting dependency versions — not worth it for the marginal quality
bump in a video-editor context.
"""
from __future__ import annotations

import numpy as np
import torch
from typing_extensions import override

from comfy_api.latest import ComfyExtension, IO


class AudioDenoiseNode(IO.ComfyNode):
    @classmethod
    def define_schema(cls):
        return IO.Schema(
            node_id="AudioDenoise",
            display_name="Audio Denoise",
            description="Remove background noise (hiss, hum, room tone, fans) from a clip.",
            category="audio",
            inputs=[
                IO.Audio.Input("audio", tooltip="The clip to clean up. Works best on voiceover and dialog. "
                                                 "If the noise comes and goes, set Stationary off."),
                IO.Float.Input("strength", default=1.0, min=0.0, max=1.0, step=0.05,
                               tooltip="How aggressively to reduce noise. 1.0 is the default and works for most clips. "
                                       "Lower (0.5) is gentler and keeps more room ambience. "
                                       "Setting to 0 disables the effect."),
                IO.Combo.Input("noise_type", options=["stationary", "non_stationary"], default="stationary",
                               tooltip="`stationary` is for steady noise (hiss, hum, fan) — fast and very effective. "
                                       "`non_stationary` is for noise that varies in time (passing traffic, wind gusts) — "
                                       "slower but adapts as the clip plays."),
            ],
            outputs=[IO.Audio.Output()],
        )

    @classmethod
    def execute(cls, audio, strength, noise_type) -> IO.NodeOutput:
        import noisereduce as nr

        waveform: torch.Tensor = audio["waveform"]
        sr = int(audio["sample_rate"])
        if strength <= 0.0 or waveform.numel() == 0:
            return IO.NodeOutput(audio)

        # noisereduce wants [channels, samples] numpy float32.
        wav = waveform[0] if waveform.dim() == 3 else waveform
        np_wave = wav.detach().cpu().numpy().astype(np.float32)

        cleaned = nr.reduce_noise(
            y=np_wave, sr=sr,
            stationary=(noise_type == "stationary"),
            prop_decrease=float(strength),
        )

        out = torch.from_numpy(cleaned).to(waveform.dtype)
        if waveform.dim() == 3:
            out = out.unsqueeze(0)
        return IO.NodeOutput({"waveform": out, "sample_rate": sr})


class AudioDenoiseExtension(ComfyExtension):
    @override
    async def get_node_list(self) -> list[type[IO.ComfyNode]]:
        return [AudioDenoiseNode]


async def comfy_entrypoint() -> AudioDenoiseExtension:
    return AudioDenoiseExtension()
