"""Pure Replicate reference / token / output helpers — the money-path logic.

This module deliberately depends on *only* the standard library and
``folder_paths``. It does NOT import torch, aiohttp, or anything that pulls in
``server`` — so it can be imported and unit-tested in isolation (the full
``nodes_replicate`` module can't, because its transitive imports reach
ComfyUI's ``server`` which only resolves correctly under ``main.py``).

Everything here is the decision logic that sits between a user's LoRA / token /
training output and a real, billable Replicate API call:

  * which API token to use, and where it comes from
  * how to read a trained-LoRA sidecar and turn it into a runnable model ref
  * how to tell a Replicate model ref apart from an HF/CivitAI/URL weights ref
  * how to pull the output URL(s) out of a finished prediction

``nodes_replicate`` re-imports these names, so it remains the public surface;
this file is just the testable home for the pure parts. Keep it free of heavy
imports so the unit tests stay fast and importable.
"""
from __future__ import annotations

import json
import os

import folder_paths


# ---------- Auth ------------------------------------------------------------
#
# The token can come from any of these (in priority order):
#   1. REPLICATE_API_TOKEN env (canonical Replicate convention)
#   2. NUXT_REPLICATE_TOKEN env (set by Nuxt — same credential, different
#      name historically used by the cloud-train server endpoints)
#   3. NUXT_REPLICATE_TOKEN in frontend/.env (Nuxt loads this at boot; Python
#      doesn't, so we read it manually as a fallback so the user only has to
#      configure their token in one place)

_TOKEN_CACHE: str | None = None


def _read_token_from_dotenv() -> str | None:
    """Look for NUXT_REPLICATE_TOKEN= in frontend/.env (closest to this file's
    project root). Returns None if the file is missing or the key isn't there."""
    here = os.path.dirname(os.path.abspath(__file__))
    # Walk up to project root (the dir with `frontend/`).
    for _ in range(6):
        candidate = os.path.join(here, "frontend", ".env")
        if os.path.isfile(candidate):
            try:
                with open(candidate, "r", encoding="utf-8") as f:
                    for line in f:
                        line = line.strip()
                        if not line or line.startswith("#"):
                            continue
                        if "=" not in line:
                            continue
                        k, _, v = line.partition("=")
                        if k.strip() in ("NUXT_REPLICATE_TOKEN", "REPLICATE_API_TOKEN"):
                            v = v.strip().strip('"').strip("'")
                            if v:
                                return v
            except OSError:
                pass
            return None
        parent = os.path.dirname(here)
        if parent == here:
            break
        here = parent
    return None


def _get_token() -> str:
    global _TOKEN_CACHE
    if _TOKEN_CACHE:
        return _TOKEN_CACHE
    for env_name in ("REPLICATE_API_TOKEN", "NUXT_REPLICATE_TOKEN"):
        token = os.environ.get(env_name, "").strip()
        if token:
            _TOKEN_CACHE = token
            return token
    token = _read_token_from_dotenv()
    if token:
        _TOKEN_CACHE = token
        return token
    raise RuntimeError(
        "Replicate API token not found. Set REPLICATE_API_TOKEN (or "
        "NUXT_REPLICATE_TOKEN) in your shell, or add NUXT_REPLICATE_TOKEN="
        "<token> to frontend/.env. See https://replicate.com/account/api-tokens"
    )


# ---------- LoRA sidecar lookup --------------------------------------------

def _read_lora_sidecar(lora_name: str) -> dict | None:
    """Load the sidecar JSON for a local LoRA filename (written at training time
    by frontend/server/api/cloud-train/status). Returns None if absent/unreadable."""
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
                    return json.load(f) or {}
            except (OSError, json.JSONDecodeError):
                return None
    return None


def _resolve_trained_model(lora_name: str) -> str | None:
    """Return the user's own trained Replicate model as `<owner>/<model>` (no
    version) from the sidecar's `replicate_model`, if present.

    These are full runnable Flux models with the LoRA *baked in* — we run them
    DIRECTLY rather than feeding flux-dev-lora a `lora_weights` ref. That's the
    only thing that works for them: the destination models are private, and
    flux-dev-lora fetches `lora_weights` anonymously (can't reach private
    weights). Running our own model uses the API token, so privacy is preserved.
    """
    meta = _read_lora_sidecar(lora_name)
    ref = (meta or {}).get("replicate_model")
    if not ref or not isinstance(ref, str):
        return None
    ref = ref.strip()
    if "://" in ref:
        return None
    owner_model = ref.split(":", 1)[0].strip()  # drop ':<version>' → run latest
    return owner_model or None


def _is_replicate_model_ref(value: str) -> bool:
    """True if `value` looks like a runnable Replicate model ref — `<owner>/<model>`
    or `<owner>/<model>/<version>` (or `:<version>`) — rather than a URL / HF /
    CivitAI / .safetensors weights reference. Used so the cloud trainer can hand
    the inference node a trained model ref via `lora_url` and we run it directly
    (the trained models are private; flux-dev-lora can't fetch their weights)."""
    s = (value or "").strip()
    if not s or "://" in s:
        return False
    low = s.lower()
    if low.endswith(".safetensors"):
        return False
    if "huggingface.co" in low or "civitai.com" in low or low.startswith("hf.co/"):
        return False
    parts = [p for p in s.split("/") if p]
    return len(parts) in (2, 3)


def _bare_owner_model(value: str) -> str:
    """`<owner>/<model>:<hash>` or `<owner>/<model>/<version>` → `<owner>/<model>`."""
    s = (value or "").strip().split(":", 1)[0]
    parts = [p for p in s.split("/") if p]
    return "/".join(parts[:2])


def _resolve_lora_url(lora_name: str) -> str | None:
    """Map a local LoRA filename to a flux-dev-lora `lora_weights` reference.

    Prefers `replicate_model` (slash form), falling back to the legacy
    `replicate_url` (a *.tar*, which flux-dev-lora can't actually parse). This
    is the EXTERNAL-weights path; for our own trained models prefer
    `_resolve_trained_model` and run them directly. Returns None if no sidecar.
    """
    meta = _read_lora_sidecar(lora_name)
    if meta is None:
        return None
    model_ref = meta.get("replicate_model")
    if model_ref:
        return _replicate_model_to_lora_ref(model_ref)
    return meta.get("replicate_url")


def _replicate_model_to_lora_ref(model_ref: str) -> str:
    """Turn a Replicate model ref `<owner>/<model>:<hash>` into the slash form
    `<owner>/<model>/<hash>` that flux-dev-lora's `lora_weights` accepts."""
    model_ref = (model_ref or "").strip()
    if "://" in model_ref:  # already a URL — not a model ref, leave alone
        return model_ref
    if ":" in model_ref and "/" in model_ref:
        owner_model, _, version = model_ref.rpartition(":")
        if version:
            return f"{owner_model}/{version}"
    return model_ref


def _normalize_lora_ref(ref: str) -> str:
    """Coerce a user-pasted LoRA reference into a form flux-dev-lora recognizes.

    The model's source detection is picky: it wants 'huggingface.co/<owner>/<model>'
    (NOT a scheme-prefixed URL), and it reads a bare '<owner>/<model>' as a
    *Replicate* model. People most often paste the HuggingFace page URL, so we
    strip the scheme for known hosts and normalize hf.co → huggingface.co. We do
    NOT touch a bare 'owner/model' — that's genuinely ambiguous (could be a real
    Replicate model), so the tooltip tells users to add the huggingface.co/ prefix.
    """
    ref = (ref or "").strip()
    if not ref:
        return ref
    low = ref.lower()
    for scheme in ("https://", "http://"):
        if low.startswith(scheme):
            ref = ref[len(scheme):]
            low = ref.lower()
            break
    if low.startswith("hf.co/"):
        ref = "huggingface.co/" + ref[len("hf.co/"):]
    return ref


# ---------- Prediction output parsing --------------------------------------

def _first_output_url(pred: dict) -> str:
    output = pred.get("output")
    if isinstance(output, list) and output:
        return output[0]
    if isinstance(output, str):
        return output
    raise RuntimeError(f"Replicate returned no output (status={pred.get('status')})")


def _all_output_urls(pred: dict) -> list[str]:
    output = pred.get("output")
    if isinstance(output, list):
        return [o for o in output if isinstance(o, str)]
    if isinstance(output, str):
        return [output]
    return []
