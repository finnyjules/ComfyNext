"""Replicate API nodes — BYOK suite for ComfyNext.

A parallel set to Comfy's official partner nodes, but pointed at Replicate
instead of Comfy's /proxy/ infrastructure. Goal: one API token
(REPLICATE_API_TOKEN), no Comfy billing dependency, distribution-ready.

Nodes shipped here:
- FluxLoRARemoteNode    — Flux Dev + user LoRA (resolves trained LoRA sidecar)
- FluxProRemoteNode     — Flux 1.1 Pro image gen
- FluxKontextRemoteNode — Flux Kontext Pro image edit
- KlingVideoRemoteNode  — Kling 2.1 text/image-to-video
- ClarityUpscaleRemoteNode — Clarity upscaler

All nodes route through one shared `_run_prediction` helper that handles
auth, version lookup, polling and error mapping.
"""
from __future__ import annotations

import asyncio
import base64
import io
import json
import os
import time

import aiohttp
import numpy as np
import torch
from PIL import Image
from typing_extensions import override

import folder_paths
from comfy_api.latest import ComfyExtension, IO
from comfy_api_nodes.util.download_helpers import (
    download_url_to_image_tensor,
    download_url_to_video_output,
)


REPLICATE_API_BASE = "https://api.replicate.com/v1"
_DEFAULT_POLL_DEADLINE_SEC = 5 * 60      # most image gen finishes well under this
_VIDEO_POLL_DEADLINE_SEC = 30 * 60       # Kling can take several minutes


# ---------- Auth ------------------------------------------------------------

def _get_token() -> str:
    token = os.environ.get("REPLICATE_API_TOKEN", "").strip()
    if not token:
        raise RuntimeError(
            "REPLICATE_API_TOKEN environment variable not set. "
            "Export it (or add to your shell profile) before starting ComfyUI."
        )
    return token


# ---------- LoRA sidecar lookup --------------------------------------------

def _resolve_lora_url(lora_name: str) -> str | None:
    """Map a local LoRA filename to the Replicate CDN URL recorded in its
    sidecar JSON at training time (see frontend/server/api/cloud-train/status).
    Returns None if no sidecar exists."""
    if not lora_name or lora_name == "[None]":
        return None
    for loras_dir in folder_paths.get_folder_paths("loras"):
        sidecar = os.path.join(
            loras_dir,
            os.path.splitext(lora_name)[0] + ".json",
        )
        if os.path.isfile(sidecar):
            try:
                with open(sidecar, "r", encoding="utf-8") as f:
                    return (json.load(f) or {}).get("replicate_url")
            except (OSError, json.JSONDecodeError):
                return None
    return None


# ---------- Image tensor → data URL ----------------------------------------

def _image_tensor_to_data_url(tensor: torch.Tensor) -> str:
    """Convert a Comfy IMAGE tensor (first frame) to a PNG data URL Replicate
    can accept as an input string."""
    if tensor is None:
        raise ValueError("input image is required")
    # [B, H, W, C] → take first frame, scale, convert to uint8
    if tensor.dim() == 4:
        tensor = tensor[0]
    arr = (tensor.clamp(0, 1) * 255.0).round().to(torch.uint8).cpu().numpy()
    if arr.ndim == 3 and arr.shape[2] in (1, 3, 4):
        img = Image.fromarray(arr)
    else:
        raise ValueError(f"unexpected image tensor shape: {tuple(tensor.shape)}")
    buf = io.BytesIO()
    img.save(buf, format="PNG")
    b64 = base64.b64encode(buf.getvalue()).decode("ascii")
    return f"data:image/png;base64,{b64}"


# ---------- Shared prediction runner ----------------------------------------

async def _run_prediction(
    model: str,
    input_dict: dict,
    *,
    poll_deadline_sec: int = _DEFAULT_POLL_DEADLINE_SEC,
) -> dict:
    """Start a Replicate prediction for `model`, poll until terminal status,
    return the final prediction dict on success."""
    token = _get_token()
    headers = {"Authorization": f"Token {token}"}

    async with aiohttp.ClientSession() as session:
        # Look up latest version of the model.
        async with session.get(
            f"{REPLICATE_API_BASE}/models/{model}",
            headers=headers,
        ) as r:
            if r.status != 200:
                raise RuntimeError(
                    f"Could not look up {model}: HTTP {r.status} — {await r.text()}"
                )
            model_info = await r.json()
        version_id = (model_info.get("latest_version") or {}).get("id")
        if not version_id:
            raise RuntimeError(f"No latest_version for {model}")

        # Kick off prediction.
        async with session.post(
            f"{REPLICATE_API_BASE}/predictions",
            headers={**headers, "Content-Type": "application/json"},
            json={"version": version_id, "input": input_dict},
        ) as r:
            if r.status not in (200, 201):
                raise RuntimeError(
                    f"Replicate predictions API HTTP {r.status}: {await r.text()}"
                )
            pred = await r.json()
        prediction_id = pred["id"]

        # Poll until done. starting → processing → succeeded/failed/canceled.
        deadline = time.time() + poll_deadline_sec
        while time.time() < deadline:
            await asyncio.sleep(1.5)
            async with session.get(
                f"{REPLICATE_API_BASE}/predictions/{prediction_id}",
                headers=headers,
            ) as r:
                if r.status != 200:
                    continue
                pred = await r.json()
            status = pred.get("status")
            if status == "succeeded":
                return pred
            if status in ("failed", "canceled"):
                err = pred.get("error") or f"prediction {status}"
                raise RuntimeError(f"Replicate: {err}")

    raise RuntimeError(
        f"Replicate prediction timed out after {poll_deadline_sec}s (id={prediction_id})"
    )


def _first_output_url(pred: dict) -> str:
    output = pred.get("output")
    if isinstance(output, list) and output:
        return output[0]
    if isinstance(output, str):
        return output
    raise RuntimeError(f"Replicate returned no output (status={pred.get('status')})")


# =============================================================================
# Node: Flux Dev + LoRA inference (companion to the cloud trainer)
# =============================================================================

_FLUX_LORA_ASPECT_RATIOS = [
    "1:1", "16:9", "21:9", "3:2", "2:3", "4:5", "5:4", "3:4", "4:3", "9:16", "9:21",
]


class FluxLoRARemoteNode(IO.ComfyNode):
    @classmethod
    def define_schema(cls):
        return IO.Schema(
            node_id="FluxLoRARemoteNode",
            display_name="Flux Dev + LoRA (Replicate)",
            category="api node/image/Replicate",
            description=(
                "Run Flux Dev with a LoRA on Replicate's GPU. Picks the LoRA "
                "by filename from models/loras/ (the cloud trainer writes a "
                "sidecar JSON with the public URL), or use the `lora_url` "
                "override for LoRAs hosted elsewhere. Requires "
                "REPLICATE_API_TOKEN in the environment."
            ),
            inputs=[
                IO.String.Input(
                    "prompt",
                    multiline=True,
                    default="",
                    tooltip="Text prompt. Include your LoRA's trigger word for character/style LoRAs.",
                ),
                IO.Combo.Input(
                    "lora_name",
                    options=folder_paths.get_filename_list("loras") + ["[None]"],
                    default="[None]",
                    tooltip=(
                        "Pick a locally-trained LoRA. Only works if it has a sidecar "
                        ".json with replicate_url (created automatically by the cloud trainer)."
                    ),
                ),
                IO.String.Input(
                    "lora_url",
                    default="",
                    multiline=False,
                    tooltip=(
                        "Override: HuggingFace path (e.g. 'alvdansen/flux-koda') "
                        "or direct URL to a .safetensors. Wins over lora_name when set. "
                        "Leave empty to use lora_name instead."
                    ),
                ),
                IO.Float.Input(
                    "lora_scale",
                    default=1.0, min=0.0, max=3.0, step=0.05,
                    tooltip="LoRA strength. 1.0 is the trained level.",
                ),
                IO.Combo.Input(
                    "aspect_ratio",
                    options=_FLUX_LORA_ASPECT_RATIOS,
                    default="1:1",
                ),
                IO.Combo.Input(
                    "megapixels",
                    options=["1", "0.25"],
                    default="1",
                    tooltip="Output size. 1 ≈ 1024px on the long edge; 0.25 ≈ 512px.",
                ),
                IO.Int.Input(
                    "num_inference_steps",
                    default=28, min=4, max=50,
                    tooltip="More steps = better detail, slower. 28 is the Flux Dev sweet spot.",
                ),
                IO.Float.Input(
                    "guidance",
                    default=3.5, min=0.0, max=20.0, step=0.1,
                    tooltip="Flux Dev's prompt adherence. 3.5 is the canonical default.",
                ),
                IO.Int.Input(
                    "seed",
                    default=0, min=0, max=0xFFFFFFFF,
                    tooltip="0 = random each run. Set a specific value for reproducible A/B tests.",
                ),
            ],
            outputs=[
                IO.Image.Output(),
                IO.String.Output(display_name="info"),
            ],
            price_badge=IO.PriceBadge(
                expr='{"type":"usd","usd":0.04,"format":{"approximate":true}}',
            ),
        )

    @classmethod
    async def execute(
        cls,
        prompt: str, lora_name: str, lora_url: str, lora_scale: float,
        aspect_ratio: str, megapixels: str,
        num_inference_steps: int, guidance: float,
        seed: int,
    ):
        # Resolution: explicit lora_url wins, then sidecar lookup by name.
        resolved_lora = (lora_url or "").strip() or _resolve_lora_url(lora_name)

        input_dict: dict = {
            "prompt": prompt,
            "aspect_ratio": aspect_ratio,
            "megapixels": megapixels,
            "num_inference_steps": num_inference_steps,
            "guidance": guidance,
            "num_outputs": 1,
            "output_format": "png",
            "disable_safety_checker": False,
        }
        if seed and seed > 0:
            input_dict["seed"] = seed
        if resolved_lora:
            input_dict["lora_weights"] = resolved_lora
            input_dict["lora_scale"] = lora_scale

        pred = await _run_prediction("black-forest-labs/flux-dev-lora", input_dict)
        tensor = await download_url_to_image_tensor(_first_output_url(pred), cls=cls)

        # Surface what was actually sent so the user can sanity-check via a
        # Preview as Text node. Confirms whether a LoRA was applied and which.
        actual_seed = pred.get("input", {}).get("seed", "random")
        logs_tail = (pred.get("logs") or "").strip().split("\n")[-3:]
        info_lines = [
            f"lora: {resolved_lora or '(none — vanilla Flux Dev)'}",
            f"scale: {lora_scale if resolved_lora else 'n/a'}",
            f"seed: {actual_seed}",
            f"aspect: {aspect_ratio} @ {megapixels}MP",
            "logs: " + " | ".join(logs_tail) if logs_tail else "",
        ]
        return IO.NodeOutput(tensor, "\n".join(line for line in info_lines if line))


# =============================================================================
# Node: Flux 1.1 Pro
# =============================================================================

_FLUX_PRO_ASPECT_RATIOS = [
    "1:1", "16:9", "21:9", "3:2", "2:3", "4:5", "5:4", "3:4", "4:3", "9:16", "9:21", "custom",
]


class FluxProRemoteNode(IO.ComfyNode):
    @classmethod
    def define_schema(cls):
        return IO.Schema(
            node_id="FluxProRemoteNode",
            display_name="Flux 1.1 Pro (Replicate)",
            category="api node/image/Replicate",
            description=(
                "Flux 1.1 Pro on Replicate. Top-tier image quality, ~$0.04 per image, "
                "~5–10 s. Requires REPLICATE_API_TOKEN."
            ),
            inputs=[
                IO.String.Input("prompt", multiline=True, default="",
                                tooltip="What to generate."),
                IO.Combo.Input(
                    "aspect_ratio",
                    options=_FLUX_PRO_ASPECT_RATIOS,
                    default="1:1",
                    tooltip="Pick 'custom' to use the width/height fields.",
                ),
                IO.Int.Input("width",  default=1024, min=256, max=1440, step=32,
                             tooltip="Only used when aspect_ratio == 'custom'.",
                             advanced=True),
                IO.Int.Input("height", default=1024, min=256, max=1440, step=32,
                             tooltip="Only used when aspect_ratio == 'custom'.",
                             advanced=True),
                IO.Int.Input("safety_tolerance", default=2, min=1, max=6,
                             tooltip="1 = strict, 6 = permissive.",
                             advanced=True),
                IO.Boolean.Input("prompt_upsampling", default=False,
                                 tooltip="Let Replicate rewrite your prompt for better results.",
                                 advanced=True),
                IO.Combo.Input("output_format", options=["png", "jpg"], default="png", advanced=True),
                IO.Int.Input("seed", default=0, min=0, max=0xFFFFFFFF,
                             tooltip="0 = random."),
            ],
            outputs=[IO.Image.Output()],
            price_badge=IO.PriceBadge(expr='{"type":"usd","usd":0.04}'),
        )

    @classmethod
    async def execute(cls, prompt, aspect_ratio, width, height,
                      safety_tolerance, prompt_upsampling, output_format, seed):
        input_dict: dict = {
            "prompt": prompt,
            "aspect_ratio": aspect_ratio,
            "safety_tolerance": safety_tolerance,
            "prompt_upsampling": prompt_upsampling,
            "output_format": output_format,
            "output_quality": 95,
        }
        if aspect_ratio == "custom":
            input_dict["width"] = width
            input_dict["height"] = height
        if seed and seed > 0:
            input_dict["seed"] = seed
        pred = await _run_prediction("black-forest-labs/flux-1.1-pro", input_dict)
        tensor = await download_url_to_image_tensor(_first_output_url(pred), cls=cls)
        return IO.NodeOutput(tensor)


# =============================================================================
# Node: Flux Kontext Pro (image edit)
# =============================================================================

_FLUX_KONTEXT_ASPECT_RATIOS = [
    "match_input_image", "1:1", "16:9", "9:16", "4:3", "3:4", "3:2", "2:3",
]


class FluxKontextRemoteNode(IO.ComfyNode):
    @classmethod
    def define_schema(cls):
        return IO.Schema(
            node_id="FluxKontextRemoteNode",
            display_name="Flux Kontext Pro · Edit (Replicate)",
            category="api node/image/Replicate",
            description=(
                "Flux Kontext Pro image editing — give it an image and a "
                "natural-language instruction ('make her hair blue', 'remove "
                "the background', 'add a cat on the couch'). ~$0.04 per edit."
            ),
            inputs=[
                IO.Image.Input("input_image", tooltip="Source image to edit."),
                IO.String.Input(
                    "prompt", multiline=True, default="",
                    tooltip="Edit instruction in natural language.",
                ),
                IO.Combo.Input(
                    "aspect_ratio",
                    options=_FLUX_KONTEXT_ASPECT_RATIOS,
                    default="match_input_image",
                    tooltip="match_input_image keeps the source's ratio.",
                ),
                IO.Int.Input("safety_tolerance", default=2, min=1, max=6, advanced=True),
                IO.Boolean.Input("prompt_upsampling", default=False, advanced=True),
                IO.Combo.Input("output_format", options=["png", "jpg"], default="png", advanced=True),
                IO.Int.Input("seed", default=0, min=0, max=0xFFFFFFFF,
                             tooltip="0 = random."),
            ],
            outputs=[IO.Image.Output()],
            price_badge=IO.PriceBadge(expr='{"type":"usd","usd":0.04}'),
        )

    @classmethod
    async def execute(cls, input_image, prompt, aspect_ratio,
                      safety_tolerance, prompt_upsampling, output_format, seed):
        input_dict: dict = {
            "prompt": prompt,
            "input_image": _image_tensor_to_data_url(input_image),
            "aspect_ratio": aspect_ratio,
            "safety_tolerance": safety_tolerance,
            "prompt_upsampling": prompt_upsampling,
            "output_format": output_format,
        }
        if seed and seed > 0:
            input_dict["seed"] = seed
        pred = await _run_prediction("black-forest-labs/flux-kontext-pro", input_dict)
        tensor = await download_url_to_image_tensor(_first_output_url(pred), cls=cls)
        return IO.NodeOutput(tensor)


# =============================================================================
# Node: Kling 2.1 video
# =============================================================================

class KlingVideoRemoteNode(IO.ComfyNode):
    @classmethod
    def define_schema(cls):
        return IO.Schema(
            node_id="KlingVideoRemoteNode",
            display_name="Kling 2.1 Video (Replicate)",
            category="api node/video/Replicate",
            description=(
                "Kling 2.1 text-to-video or image-to-video. ~$0.35 for 5s, "
                "~$0.70 for 10s. Generation takes a few minutes."
            ),
            inputs=[
                IO.String.Input(
                    "prompt", multiline=True, default="",
                    tooltip="What should happen in the video.",
                ),
                IO.Image.Input(
                    "start_image", optional=True,
                    tooltip="Optional first frame — turns this into image-to-video.",
                ),
                IO.Combo.Input(
                    "aspect_ratio",
                    options=["16:9", "9:16", "1:1"],
                    default="16:9",
                    tooltip="Ignored when start_image is provided.",
                ),
                IO.Combo.Input(
                    "duration",
                    options=["5", "10"],
                    default="5",
                    tooltip="Seconds. Longer = roughly 2× the cost.",
                ),
                IO.String.Input(
                    "negative_prompt", default="",
                    tooltip="What to avoid (blur, glitches, distortion, etc.).",
                    advanced=True,
                ),
                IO.Float.Input(
                    "cfg_scale", default=0.5, min=0.0, max=1.0, step=0.05,
                    tooltip="Prompt adherence vs. naturalness.",
                    advanced=True,
                ),
            ],
            outputs=[IO.Video.Output()],
            price_badge=IO.PriceBadge(
                expr='{"type":"usd","usd":0.35,"format":{"approximate":true}}',
            ),
        )

    @classmethod
    async def execute(cls, prompt, start_image, aspect_ratio, duration,
                      negative_prompt, cfg_scale):
        input_dict: dict = {
            "prompt": prompt,
            "duration": int(duration),
            "cfg_scale": cfg_scale,
        }
        if negative_prompt:
            input_dict["negative_prompt"] = negative_prompt
        if start_image is not None:
            input_dict["start_image"] = _image_tensor_to_data_url(start_image)
        else:
            input_dict["aspect_ratio"] = aspect_ratio
        pred = await _run_prediction(
            "kwaivgi/kling-v2.1",
            input_dict,
            poll_deadline_sec=_VIDEO_POLL_DEADLINE_SEC,
        )
        video = await download_url_to_video_output(_first_output_url(pred), cls=cls)
        return IO.NodeOutput(video)


# =============================================================================
# Node: Clarity upscaler
# =============================================================================

class ClarityUpscaleRemoteNode(IO.ComfyNode):
    @classmethod
    def define_schema(cls):
        return IO.Schema(
            node_id="ClarityUpscaleRemoteNode",
            display_name="Clarity Upscale (Replicate)",
            category="api node/image/Replicate",
            description=(
                "philz1337x/clarity-upscaler — high-quality detail-enhancing "
                "upscale. Adds plausible detail; not pixel-perfect. ~$0.05–0.20 "
                "per image depending on input size and scale factor."
            ),
            inputs=[
                IO.Image.Input("image", tooltip="Image to upscale."),
                IO.String.Input(
                    "prompt", multiline=True,
                    default="masterpiece, best quality, highres",
                    tooltip="Style prompt — the upscaler uses this to invent detail.",
                ),
                IO.Float.Input(
                    "scale_factor",
                    default=2.0, min=1.0, max=10.0, step=0.5,
                    tooltip="Output is scale_factor × input dimensions.",
                ),
                IO.Float.Input(
                    "creativity",
                    default=0.35, min=0.0, max=1.0, step=0.05,
                    tooltip="0 = preserve original, 1 = reinvent. 0.3–0.4 is the sweet spot.",
                ),
                IO.Float.Input(
                    "resemblance",
                    default=0.6, min=0.0, max=3.0, step=0.05,
                    tooltip="How tightly to stick to the source. Higher = closer to input.",
                ),
                IO.String.Input(
                    "negative_prompt", default="(worst quality, low quality, normal quality:2)",
                    tooltip="What to avoid in the upscaled image.",
                    advanced=True,
                ),
                IO.Int.Input(
                    "num_inference_steps", default=18, min=10, max=50,
                    advanced=True,
                ),
                IO.Int.Input("seed", default=0, min=0, max=0xFFFFFFFF,
                             tooltip="0 = random."),
            ],
            outputs=[IO.Image.Output()],
            price_badge=IO.PriceBadge(
                expr='{"type":"usd","usd":0.10,"format":{"approximate":true}}',
            ),
        )

    @classmethod
    async def execute(cls, image, prompt, scale_factor, creativity, resemblance,
                      negative_prompt, num_inference_steps, seed):
        input_dict: dict = {
            "image": _image_tensor_to_data_url(image),
            "prompt": prompt,
            "scale_factor": scale_factor,
            "creativity": creativity,
            "resemblance": resemblance,
            "negative_prompt": negative_prompt,
            "num_inference_steps": num_inference_steps,
            "output_format": "png",
        }
        if seed and seed > 0:
            input_dict["seed"] = seed
        pred = await _run_prediction("philz1337x/clarity-upscaler", input_dict)
        tensor = await download_url_to_image_tensor(_first_output_url(pred), cls=cls)
        return IO.NodeOutput(tensor)


# ---------- Extension registration -----------------------------------------

class ReplicateExtension(ComfyExtension):
    @override
    async def get_node_list(self) -> list[type[IO.ComfyNode]]:
        return [
            FluxLoRARemoteNode,
            FluxProRemoteNode,
            FluxKontextRemoteNode,
            KlingVideoRemoteNode,
            ClarityUpscaleRemoteNode,
        ]


async def comfy_entrypoint() -> ReplicateExtension:
    return ReplicateExtension()
