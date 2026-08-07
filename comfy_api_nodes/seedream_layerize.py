"""Pure input-builder + result-parser for the Seedream layerize node.

Kept free of torch / ComfyUI imports so the payload shape and layer parsing are
unit-testable without a graph. The node in nodes_replicate.py wraps these with
the fal call, per-layer download, and input-dir save.
"""
from __future__ import annotations

from typing import Any

_IMAGE_SIZES = {"auto", "auto_1K", "auto_1.5K", "auto_2K"}


def seedream_layerize_input(prompt: str, image_url: str, image_size: str) -> dict:
    """Shape the request for fal bytedance/seedream/v5/pro/layerize."""
    size = image_size if image_size in _IMAGE_SIZES else "auto"
    return {
        "prompt": prompt or "",
        "image_url": image_url,
        "image_size": size,
    }


def parse_seedream_layers(result: dict) -> tuple[list[dict], int, int]:
    """Flatten fal's `layers` array into simple dicts + base image dimensions.

    Each returned layer: {url, z_index, box|None ([l,t,r,b] absolute), name, description}.
    The base layer (z_index 0) has no bounding_box -> box is None. Width/height come
    from the base layer image, falling back to result['images'][0].
    """
    raw = (result or {}).get("layers") or []
    out: list[dict] = []
    for layer in raw:
        if not isinstance(layer, dict):
            continue
        img = layer.get("image") or {}
        url = img.get("url")
        if not isinstance(url, str):
            continue
        bbox = layer.get("bounding_box") or {}
        box = bbox.get("absolute") if isinstance(bbox, dict) else None
        if not (isinstance(box, list) and len(box) == 4):
            box = None
        out.append({
            "url": url,
            "z_index": int(layer.get("z_index", 0)),
            "box": box,
            "name": str(layer.get("name") or ""),
            "description": str(layer.get("description") or ""),
            "width": int(img.get("width") or 0),
            "height": int(img.get("height") or 0),
        })
    # Base image dimensions: the z_index==0 layer, else images[0], else 0.
    base = next((l for l in out if l["z_index"] == 0 and l["width"]), None)
    if base:
        w, h = base["width"], base["height"]
    else:
        imgs = (result or {}).get("images") or []
        first = imgs[0] if imgs and isinstance(imgs[0], dict) else {}
        w, h = int(first.get("width") or 0), int(first.get("height") or 0)
    return out, w, h
