"""Audio effects to close the CapCut-parity gap on the audio side.

Comfy passes audio around as a dict {"waveform": Tensor[B, C, T], "sample_rate": int}.
Every node here accepts and returns that shape.
"""
from __future__ import annotations

import torch
from typing_extensions import override

from comfy_api.latest import ComfyExtension, IO


def _wave(audio):
    return audio["waveform"], int(audio["sample_rate"])


def _wrap(waveform, sample_rate):
    return {"waveform": waveform, "sample_rate": sample_rate}


class AudioFadeNode(IO.ComfyNode):
    """Fade in and/or out at the head and tail of a clip."""

    @classmethod
    def define_schema(cls):
        return IO.Schema(
            node_id="AudioFade",
            display_name="Audio Fade",
            description="Apply a fade-in at the start and/or fade-out at the end of a clip.",
            category="audio",
            inputs=[
                IO.Audio.Input("audio", tooltip="The clip you want to fade in or out."),
                IO.Float.Input("fade_in", default=0.5, min=0.0, max=60.0, step=0.05,
                               tooltip="How long the start of the clip ramps up from silence to full volume, in seconds. "
                                       "Set to 0 for a hard start with no fade."),
                IO.Float.Input("fade_out", default=0.5, min=0.0, max=60.0, step=0.05,
                               tooltip="How long the end of the clip ramps down to silence, in seconds. "
                                       "Set to 0 for a hard cut with no fade."),
                IO.Combo.Input("curve", options=["linear", "equal_power", "exponential"],
                               tooltip="Shape of the volume ramp. `linear` is a straight line — simple and obvious. "
                                       "`equal_power` keeps the perceived loudness steady when you crossfade two clips together "
                                       "(use this for joins). `exponential` matches how our ears hear loudness and usually feels "
                                       "the most natural for a fade on a single clip."),
            ],
            outputs=[IO.Audio.Output()],
        )

    @classmethod
    def execute(cls, audio, fade_in, fade_out, curve) -> IO.NodeOutput:
        waveform, sr = _wave(audio)
        n = waveform.shape[-1]
        if n == 0 or (fade_in <= 0 and fade_out <= 0):
            return IO.NodeOutput(audio)

        env = torch.ones(n, dtype=waveform.dtype, device=waveform.device)
        n_in = min(int(round(fade_in * sr)), n)
        n_out = min(int(round(fade_out * sr)), n)

        def ramp(length: int, rising: bool) -> torch.Tensor:
            t = torch.linspace(0.0, 1.0, length, dtype=waveform.dtype, device=waveform.device)
            if not rising:
                t = 1.0 - t
            if curve == "linear":
                return t
            if curve == "equal_power":
                # sin(pi/2 * t) — pairs with cos for constant-power crossfade.
                return torch.sin(t * (torch.pi / 2))
            # exponential — quadratic feels closer to perceptual loudness.
            return t * t

        if n_in > 0:
            env[:n_in] *= ramp(n_in, rising=True)
        if n_out > 0:
            env[-n_out:] *= ramp(n_out, rising=False)

        return IO.NodeOutput(_wrap(waveform * env, sr))


class AudioNormalizeNode(IO.ComfyNode):
    """Normalize to a target peak or RMS level in dBFS."""

    @classmethod
    def define_schema(cls):
        return IO.Schema(
            node_id="AudioNormalize",
            display_name="Audio Normalize",
            description="Scale the clip so its peak (or RMS) matches a target level in dBFS.",
            category="audio",
            inputs=[
                IO.Audio.Input("audio", tooltip="The clip to make louder or quieter."),
                IO.Combo.Input("mode", options=["peak", "rms"],
                               tooltip="How to measure 'how loud' the clip is. `peak` looks at the single loudest sample — "
                                       "best for music, prevents clipping. `rms` looks at average energy — best for dialog "
                                       "so different takes sit at a consistent perceived level."),
                IO.Float.Input("target_db", default=-1.0, min=-60.0, max=0.0, step=0.1,
                               tooltip="How loud the clip should end up. 0 dB is the maximum possible; negative numbers are quieter. "
                                       "For music aim for around -1 dB. For dialog/voiceover -20 to -16 dB is broadcast-standard."),
            ],
            outputs=[IO.Audio.Output()],
        )

    @classmethod
    def execute(cls, audio, mode, target_db) -> IO.NodeOutput:
        waveform, sr = _wave(audio)
        if waveform.numel() == 0:
            return IO.NodeOutput(audio)

        if mode == "peak":
            current = waveform.abs().max().item()
        else:
            current = waveform.pow(2).mean().sqrt().item()

        if current <= 1e-9:
            return IO.NodeOutput(audio)

        target_linear = 10.0 ** (target_db / 20.0)
        gain = target_linear / current
        return IO.NodeOutput(_wrap(waveform * gain, sr))


class AudioDuckNode(IO.ComfyNode):
    """Sidechain ducking: attenuate `audio` while `sidechain` is loud.

    Typical use: music input → audio, voiceover → sidechain. Music dips when
    the VO speaks and returns to full level during silences.
    """

    @classmethod
    def define_schema(cls):
        return IO.Schema(
            node_id="AudioDuck",
            display_name="Audio Duck",
            description="Lower the volume of one track while another is playing (sidechain compression).",
            category="audio",
            inputs=[
                IO.Audio.Input("audio", tooltip="The track that gets quieter when the sidechain plays. Usually background music."),
                IO.Audio.Input("sidechain", tooltip="The track that triggers the ducking. Usually a voiceover — when it speaks, "
                                                    "the `audio` above drops in volume; when it's silent, `audio` returns to full."),
                IO.Float.Input("threshold_db", default=-30.0, min=-60.0, max=0.0, step=0.5,
                               tooltip="How loud the sidechain has to get before the duck starts. Lower numbers (-40, -50) mean "
                                       "even quiet sounds trigger it. Higher numbers (-20, -10) mean only loud, deliberate speech does. "
                                       "-30 is a good starting point for a normal voiceover."),
                IO.Float.Input("depth_db", default=-12.0, min=-60.0, max=0.0, step=0.5,
                               tooltip="How much to drop the music when ducking. -6 dB is half as loud, -12 dB is clearly noticeable "
                                       "(the typical podcast feel), -20 dB nearly silences it. Stay between -8 and -15 for most uses."),
                IO.Float.Input("attack_ms", default=20.0, min=1.0, max=2000.0, step=1.0,
                               tooltip="How fast the duck kicks in once speech starts, in milliseconds. "
                                       "Fast (10–30 ms) catches each word clearly but can sound twitchy. "
                                       "Slow (100–300 ms) sounds smoother but may clip the first syllable."),
                IO.Float.Input("release_ms", default=300.0, min=1.0, max=5000.0, step=1.0,
                               tooltip="How fast the music comes back up after speech stops, in milliseconds. "
                                       "Too fast (<100 ms) feels jittery between words. 200–500 ms is natural for narration; "
                                       "longer for music beds where you don't want pumping."),
            ],
            outputs=[IO.Audio.Output()],
        )

    @classmethod
    def execute(cls, audio, sidechain, threshold_db, depth_db, attack_ms, release_ms) -> IO.NodeOutput:
        waveform, sr = _wave(audio)
        side_wave, side_sr = _wave(sidechain)

        # Resample sidechain to match main if rates differ. Cheap nearest-neighbor
        # is fine — we only need the envelope shape, not fidelity.
        if side_sr != sr and side_wave.numel() > 0:
            n_target = int(round(side_wave.shape[-1] * sr / side_sr))
            idx = torch.linspace(0, side_wave.shape[-1] - 1, n_target,
                                 device=side_wave.device).round().long()
            side_wave = side_wave.index_select(-1, idx)

        # Mono sidechain envelope: abs across channels then collapse to 1D over time.
        if side_wave.dim() == 3:
            side_mono = side_wave.abs().mean(dim=(0, 1))
        elif side_wave.dim() == 2:
            side_mono = side_wave.abs().mean(dim=0)
        else:
            side_mono = side_wave.abs()

        n = waveform.shape[-1]
        if side_mono.shape[0] < n:
            side_mono = torch.nn.functional.pad(side_mono, (0, n - side_mono.shape[0]))
        else:
            side_mono = side_mono[:n]

        # One-pole envelope follower with separate attack/release time constants.
        # alpha = exp(-1 / (tau * sr)) where tau is in seconds.
        a_attack = float(torch.exp(torch.tensor(-1.0 / max(attack_ms / 1000.0 * sr, 1.0))))
        a_release = float(torch.exp(torch.tensor(-1.0 / max(release_ms / 1000.0 * sr, 1.0))))

        env = torch.zeros_like(side_mono)
        prev = 0.0
        side_cpu = side_mono.detach().cpu().tolist()
        for i, x in enumerate(side_cpu):
            a = a_attack if x > prev else a_release
            prev = a * prev + (1 - a) * x
            env[i] = prev

        # Convert envelope to dB then map (threshold..0) → (0..depth_db).
        env_db = 20.0 * torch.log10(env.clamp(min=1e-9))
        over = (env_db - threshold_db).clamp(min=0.0)
        span = max(-threshold_db, 1e-6)  # how many dB above threshold maps to full duck
        amount = (over / span).clamp(max=1.0)
        gain_db = amount * depth_db  # depth_db is negative, so this attenuates
        gain = 10.0 ** (gain_db / 20.0)

        # Broadcast gain back across batch/channel dims.
        while gain.dim() < waveform.dim():
            gain = gain.unsqueeze(0)
        return IO.NodeOutput(_wrap(waveform * gain, sr))


class VideoSilenceCutNode(IO.ComfyNode):
    """Remove silent stretches from a video, keeping audio + frames synchronized.

    Detects silent runs in the audio (below `threshold_db` for at least
    `min_silence_ms`), then cuts those ranges from both the frame batch and
    the audio. Leaves `keep_padding_ms` on either side of each kept run so
    cuts don't clip the start/end of speech.
    """

    @classmethod
    def define_schema(cls):
        return IO.Schema(
            node_id="VideoSilenceCut",
            display_name="Silence Cut",
            description="Auto-remove silent gaps. Keeps audio + frames in sync.",
            category="video",
            inputs=[
                IO.Image.Input("frames", tooltip="The video frames to cut. They must be in sync with the `audio` input — "
                                                 "use Load Video → Get Video Components to get matching pairs."),
                IO.Audio.Input("audio", tooltip="The audio track used to detect silence. Cuts are applied to both `frames` and this "
                                                "audio so they stay in sync."),
                IO.Float.Input("fps", default=30.0, min=1.0, max=120.0, step=0.01,
                               tooltip="Frame rate of the source video. Must match the actual frame rate of `frames` "
                                       "or the audio and picture will drift out of sync after the cut."),
                IO.Float.Input("threshold_db", default=-40.0, min=-80.0, max=0.0, step=0.5,
                               tooltip="How quiet a section has to be to count as silence. "
                                       "-40 catches most natural pauses in speech. -50 keeps even soft breathing as 'not silent'. "
                                       "-30 only cuts true dead air. Make it lower if it's removing your speech."),
                IO.Int.Input("min_silence_ms", default=300, min=20, max=5000, step=10,
                             tooltip="How long a silence has to last before it gets cut, in milliseconds. "
                                     "Low values (100) cut every micro-pause — punchy but exhausting. "
                                     "300+ only removes breath gaps and dead air, keeping natural rhythm."),
                IO.Int.Input("keep_padding_ms", default=80, min=0, max=2000, step=10,
                             tooltip="How much silence to leave on either side of each kept chunk, in milliseconds. "
                                     "Without padding, cuts feel abrupt and can clip the start of words. "
                                     "80–150 ms sounds natural for talking-head edits."),
            ],
            outputs=[
                IO.Image.Output(display_name="frames"),
                IO.Audio.Output(display_name="audio"),
            ],
        )

    @classmethod
    def execute(cls, frames, audio, fps, threshold_db, min_silence_ms, keep_padding_ms) -> IO.NodeOutput:
        waveform, sr = _wave(audio)
        if waveform.numel() == 0 or frames.shape[0] == 0:
            return IO.NodeOutput(frames, audio)

        # Per-sample envelope (mono mean of |x|), then a short moving average
        # so a single quiet sample doesn't open a gap.
        wave_mono = waveform.abs().mean(dim=tuple(range(waveform.dim() - 1)))
        win = max(int(sr * 0.020), 1)  # 20 ms smoothing window
        if win > 1:
            kernel = torch.ones(1, 1, win, device=wave_mono.device, dtype=wave_mono.dtype) / win
            padded = torch.nn.functional.pad(wave_mono.view(1, 1, -1), (win // 2, win // 2))
            env = torch.nn.functional.conv1d(padded, kernel).view(-1)[: wave_mono.shape[0]]
        else:
            env = wave_mono

        env_db = 20.0 * torch.log10(env.clamp(min=1e-9))
        loud_mask = env_db > threshold_db
        min_silent_samples = int(sr * min_silence_ms / 1000)
        pad_samples = int(sr * keep_padding_ms / 1000)

        # Walk the mask, collapse short silent runs, expand each loud run by pad.
        keep_ranges: list[tuple[int, int]] = []
        i = 0
        n = loud_mask.shape[0]
        mask_cpu = loud_mask.cpu().tolist()
        while i < n:
            if mask_cpu[i]:
                start = i
                while i < n and mask_cpu[i]:
                    i += 1
                # Look ahead — short silent runs absorb into this range.
                j = i
                while j < n and not mask_cpu[j] and (j - i) < min_silent_samples:
                    j += 1
                if j < n and mask_cpu[j]:
                    i = j  # silence too short, keep going
                    continue
                end = i
                keep_ranges.append((max(0, start - pad_samples), min(n, end + pad_samples)))
            else:
                i += 1

        if not keep_ranges:
            # Everything was below threshold — emit a single frame of silence
            # rather than a zero-length tensor that downstream nodes can't handle.
            return IO.NodeOutput(frames[:1], _wrap(waveform[..., :1], sr))

        # Merge ranges that overlap after padding.
        merged: list[list[int]] = [list(keep_ranges[0])]
        for s, e in keep_ranges[1:]:
            if s <= merged[-1][1]:
                merged[-1][1] = max(merged[-1][1], e)
            else:
                merged.append([s, e])

        # Slice audio and frames using the same ranges (sample-indexed → frame-indexed).
        audio_chunks = [waveform[..., s:e] for s, e in merged]
        out_audio = torch.cat(audio_chunks, dim=-1)

        T = frames.shape[0]
        frame_chunks: list[torch.Tensor] = []
        for s, e in merged:
            f_start = max(0, int(round(s / sr * fps)))
            f_end = min(T, int(round(e / sr * fps)))
            if f_end > f_start:
                frame_chunks.append(frames[f_start:f_end])
        out_frames = torch.cat(frame_chunks, dim=0) if frame_chunks else frames[:1]

        return IO.NodeOutput(out_frames, _wrap(out_audio, sr))


class AudioEffectsExtension(ComfyExtension):
    @override
    async def get_node_list(self) -> list[type[IO.ComfyNode]]:
        return [AudioFadeNode, AudioNormalizeNode, AudioDuckNode, VideoSilenceCutNode]


async def comfy_entrypoint() -> AudioEffectsExtension:
    return AudioEffectsExtension()
