#!/usr/bin/env python
"""Bake voice-preview clips for the "Generate speech" node.

Generates one short sample clip per MiniMax system voice via Replicate
(minimax/speech-02-hd) and writes them to
``frontend/public/voice-samples/<voice_id>.mp3``. Those static clips power the
voice gallery's preview buttons — see frontend/app/lib/voiceCatalog.ts.

Run ONCE; commit the resulting mp3s. Re-runs are cheap: a voice whose clip
already exists is skipped unless ``--force`` is given.

Usage:
    .venv/bin/python scripts/bake_voice_samples.py            # bake missing clips
    .venv/bin/python scripts/bake_voice_samples.py --force    # re-bake everything
    .venv/bin/python scripts/bake_voice_samples.py --voices Wise_Woman Abbess

Requires REPLICATE_API_TOKEN (or NUXT_REPLICATE_TOKEN, or frontend/.env), the
same credential the node uses. Cost: ~$0.30 per voice (~$5 for all 17).
"""
from __future__ import annotations

import argparse
import ast
import asyncio
import sys
import time
from pathlib import Path

REPO_ROOT = Path(__file__).resolve().parent.parent
sys.path.insert(0, str(REPO_ROOT))

OUTPUT_DIR = REPO_ROOT / "frontend" / "public" / "voice-samples"
NODES_FILE = REPO_ROOT / "comfy_api_nodes" / "nodes_replicate.py"
REPLICATE_API_BASE = "https://api.replicate.com/v1"

# The single line every voice speaks. Short (~2s) keeps cost + file size down.
SAMPLE_TEXT = "Hi there — this is what I sound like."

# Per-voice cost on Replicate for this short clip (rough; for the cost guard log).
APPROX_USD_PER_VOICE = 0.30


def _load_minimax_voices() -> list[str]:
    """Read `_MINIMAX_VOICES` straight from nodes_replicate.py source (AST, no
    import) so the canonical list can't drift, while sidestepping that module's
    heavy ComfyUI-server import chain."""
    tree = ast.parse(NODES_FILE.read_text())
    for node in tree.body:
        if isinstance(node, ast.Assign):
            for tgt in node.targets:
                if isinstance(tgt, ast.Name) and tgt.id == "_MINIMAX_VOICES":
                    return list(ast.literal_eval(node.value))
    raise RuntimeError(f"_MINIMAX_VOICES not found in {NODES_FILE}")


def _build_input(voice_id: str) -> dict:
    """Mirror MiniMaxSpeechRemoteNode.execute's input for a neutral sample."""
    return {
        "text": SAMPLE_TEXT,
        "voice_id": voice_id,
        "speed": 1.0,
        "volume": 1.0,
        "pitch": 0,
        "sample_rate": 32000,
        "bitrate": 128000,
        "channel": "mono",
        "english_normalization": True,
    }


async def _run_prediction(model: str, input_dict: dict, poll_deadline_sec: int = 300) -> dict:
    """Minimal Replicate runner: POST to the model-aliased predictions endpoint,
    then poll to terminal status. A trimmed copy of nodes_replicate._run_prediction
    (official-model path only) so the script avoids that module's heavy imports."""
    import aiohttp
    from comfy_api_nodes.replicate_refs import _get_token

    headers = {"Authorization": f"Token {_get_token()}", "Content-Type": "application/json"}
    async with aiohttp.ClientSession() as session:
        async with session.post(
            f"{REPLICATE_API_BASE}/models/{model}/predictions",
            headers=headers, json={"input": input_dict},
        ) as r:
            if r.status not in (200, 201):
                raise RuntimeError(f"create HTTP {r.status}: {await r.text()}")
            pred = await r.json()
        prediction_id = pred["id"]
        deadline = time.time() + poll_deadline_sec
        while time.time() < deadline:
            await asyncio.sleep(1.5)
            async with session.get(
                f"{REPLICATE_API_BASE}/predictions/{prediction_id}", headers=headers,
            ) as r:
                if r.status != 200:
                    continue
                pred = await r.json()
            status = pred.get("status")
            if status == "succeeded":
                return pred
            if status in ("failed", "canceled"):
                raise RuntimeError(f"Replicate: {pred.get('error') or status}")
    raise RuntimeError(f"timed out after {poll_deadline_sec}s (id={prediction_id})")


async def _download(url: str, dest: Path) -> int:
    import aiohttp

    async with aiohttp.ClientSession() as session:
        async with session.get(url) as r:
            if r.status != 200:
                raise RuntimeError(f"download HTTP {r.status} for {url}")
            data = await r.read()
    dest.write_bytes(data)
    return len(data)


async def _bake_one(voice_id: str, dest: Path) -> None:
    from comfy_api_nodes.replicate_refs import _first_output_url

    pred = await _run_prediction("minimax/speech-02-hd", _build_input(voice_id))
    url = _first_output_url(pred)
    size = await _download(url, dest)
    print(f"  ✓ {voice_id:<20} {size / 1024:6.1f} KB  → {dest.relative_to(REPO_ROOT)}")


async def _main(voice_ids: list[str], force: bool) -> int:
    from comfy_api_nodes.replicate_refs import _get_token

    # Fail fast + friendly if no credential — no partial spend surprise.
    try:
        _get_token()
    except RuntimeError as e:
        print(f"error: {e}", file=sys.stderr)
        return 1

    OUTPUT_DIR.mkdir(parents=True, exist_ok=True)

    todo = [v for v in voice_ids if force or not (OUTPUT_DIR / f"{v}.mp3").exists()]
    skipped = len(voice_ids) - len(todo)
    if skipped:
        print(f"Skipping {skipped} voice(s) that already have a clip "
              f"(use --force to re-bake).")
    if not todo:
        print("Nothing to bake — all clips present.")
        return 0

    print(f"Baking {len(todo)} clip(s) · est. ~${len(todo) * APPROX_USD_PER_VOICE:.2f} "
          f"on Replicate (minimax/speech-02-hd).")

    failures: list[str] = []
    for voice_id in todo:
        dest = OUTPUT_DIR / f"{voice_id}.mp3"
        try:
            await _bake_one(voice_id, dest)
        except Exception as e:  # keep going; a partial run resumes next time
            failures.append(voice_id)
            print(f"  ✗ {voice_id:<20} {e}", file=sys.stderr)

    done = len(todo) - len(failures)
    print(f"\nDone: {done}/{len(todo)} baked into {OUTPUT_DIR.relative_to(REPO_ROOT)}.")
    if failures:
        print(f"Failed: {', '.join(failures)} — re-run to retry just these.",
              file=sys.stderr)
        return 1
    return 0


def main() -> int:
    _MINIMAX_VOICES = _load_minimax_voices()

    parser = argparse.ArgumentParser(description=__doc__,
                                     formatter_class=argparse.RawDescriptionHelpFormatter)
    parser.add_argument("--force", action="store_true",
                        help="re-bake even voices that already have a clip")
    parser.add_argument("--voices", nargs="+", metavar="VOICE_ID",
                        help="bake only these voice ids (default: all 17)")
    args = parser.parse_args()

    voice_ids = args.voices or list(_MINIMAX_VOICES)
    unknown = [v for v in voice_ids if v not in _MINIMAX_VOICES]
    if unknown:
        print(f"error: unknown voice id(s): {', '.join(unknown)}\n"
              f"valid: {', '.join(_MINIMAX_VOICES)}", file=sys.stderr)
        return 2

    return asyncio.run(_main(voice_ids, args.force))


if __name__ == "__main__":
    raise SystemExit(main())
