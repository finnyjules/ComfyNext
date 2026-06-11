"""Shader-effects catalog: loading, validation, param resolution, frame planning.

The catalog (shader_effects/ at repo root) is the single source of truth for both
the browser preview (served via /comfynext/shader_effects) and server rendering.
Rendering lives in render_effect() (added alongside; reuses nodes_glsl machinery).
"""
from __future__ import annotations

import json
import os
from dataclasses import dataclass, field

CATALOG_DIR = os.path.join(os.path.dirname(os.path.dirname(os.path.abspath(__file__))), "shader_effects")
ASSETS_DIR = os.path.join(CATALOG_DIR, "assets")


@dataclass
class EffectParam:
    uniform: str
    label: str
    type: str
    min: float
    max: float
    default: float
    step: float


@dataclass
class Effect:
    id: str
    name: str
    category: str
    animated: bool
    passes: int
    center_param: list[str] | None
    textures: list[dict]
    params: list[EffectParam]
    source: str


@dataclass
class Catalog:
    version: int
    effects: dict[str, Effect] = field(default_factory=dict)


_catalog: Catalog | None = None


def load_catalog(refresh: bool = False) -> Catalog:
    global _catalog
    if _catalog is not None and not refresh:
        return _catalog

    manifest_path = os.path.join(CATALOG_DIR, "manifest.json")
    with open(manifest_path, "r", encoding="utf-8") as f:
        manifest = json.load(f)

    effects: dict[str, Effect] = {}
    for entry in manifest["effects"]:
        eid = entry["id"]
        if eid in effects:
            raise ValueError(f"shader_effects manifest: duplicate effect id {eid!r}")
        frag_path = os.path.join(CATALOG_DIR, f"{eid}.frag")
        if not os.path.isfile(frag_path):
            raise ValueError(f"shader_effects manifest: missing shader file for {eid!r}")
        with open(frag_path, "r", encoding="utf-8") as f:
            source = f.read()
        params = [EffectParam(**p) for p in entry["params"]]
        for p in params:
            if not (p.min <= p.default <= p.max):
                raise ValueError(f"shader_effects {eid!r}: default for {p.uniform} outside [min, max]")
        effects[eid] = Effect(
            id=eid,
            name=entry["name"],
            category=entry["category"],
            animated=entry["animated"],
            passes=entry.get("passes", 1),
            center_param=entry.get("centerParam"),
            textures=entry.get("textures", []),
            params=params,
            source=source,
        )

    _catalog = Catalog(version=manifest["version"], effects=effects)
    return _catalog


def resolve_params(effect: Effect, params_json: str) -> dict[str, float]:
    """Defaults merged with user JSON; clamped to [min, max]; unknown keys dropped."""
    try:
        user = json.loads(params_json) if params_json.strip() else {}
        if not isinstance(user, dict):
            raise ValueError
    except (json.JSONDecodeError, ValueError):
        raise ValueError(f"ShaderEffect {effect.id!r}: params is not a valid JSON object")

    out: dict[str, float] = {}
    for p in effect.params:
        v = user.get(p.uniform, p.default)
        try:
            v = float(v)
        except (TypeError, ValueError):
            v = p.default
        out[p.uniform] = min(max(v, p.min), p.max)
    return out


def frame_plan(batch_size: int, time: float, duration: float, fps: int) -> list[tuple[int, float]]:
    """(input_frame_index, u_time) per output frame.

    Batch input: u_time advances per input frame, duration ignored.
    Still + duration: duration*fps frames from a single input frame.
    Still + no duration: one frame at `time`.
    """
    fps = max(1, int(fps))
    if batch_size > 1:
        return [(i, time + i / fps) for i in range(batch_size)]
    if duration > 0:
        return [(0, time + i / fps) for i in range(max(1, round(duration * fps)))]
    return [(0, time)]
