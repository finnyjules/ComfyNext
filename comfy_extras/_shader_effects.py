"""Shader-effects catalog: loading, validation, param resolution, frame planning.

The catalog (shader_effects/ at repo root) is the single source of truth for both
the browser preview (served via /comfynext/shader_effects) and server rendering.
Rendering lives in render_effect() (added alongside; reuses nodes_glsl machinery).
"""
from __future__ import annotations

import json
import os
from dataclasses import dataclass, field

import numpy as np

CATALOG_DIR = os.path.join(os.path.dirname(os.path.dirname(os.path.abspath(__file__))), "shader_effects")
ASSETS_DIR = os.path.join(CATALOG_DIR, "assets")


@dataclass
class EffectParam:
    uniform: str
    label: str
    type: str
    default: float
    min: float = 0.0
    max: float = 0.0
    step: float = 0.0
    options: list[dict] | None = None


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
    generative: bool = False


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
            if p.type == "enum":
                values = [o["value"] for o in (p.options or [])]
                if not values:
                    raise ValueError(f"shader_effects {eid!r}: enum {p.uniform} has no options")
                if p.default not in values:
                    raise ValueError(f"shader_effects {eid!r}: enum default for {p.uniform} not an option")
            elif not (p.min <= p.default <= p.max):
                raise ValueError(f"shader_effects {eid!r}: default for {p.uniform} outside [min, max]")
        effects[eid] = Effect(
            id=eid,
            name=entry["name"],
            category=entry["category"],
            animated=entry["animated"],
            passes=entry.get("passes", 1),
            generative=entry.get("generative", False),
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
        user = json.loads(params_json) if params_json and params_json.strip() else {}
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
        if p.type == "enum":
            values = [float(o["value"]) for o in (p.options or [])]
            out[p.uniform] = v if v in values else float(p.default)
        else:
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


MAX_RENDER_DIM = 8192


def render_effect(
    fragment_code: str,
    width: int,
    height: int,
    jobs: list[dict],
    extra_textures: dict[str, "np.ndarray"] | None = None,
    passes: int = 1,
) -> list["np.ndarray"]:
    """Render `fragment_code` once per job. Compiles once; per-job image + uniforms.

    jobs: [{"image": (H, W, 3|4) float32 [0,1] or None, "uniforms": {name: float}}]
    A job with image=None reuses the previously uploaded frame; the FIRST job must
    therefore carry an image (the input texture is otherwise uninitialized).
    extra_textures: {uniform_name: (H, W, 4) float32} — bound NEAREST on units 2+.
    passes: ping-pong passes per job. Pass 0 reads the source via u_image0; pass k>0
    reads the previous pass output. u_source (unit 1) always holds the original input;
    u_pass / u_passCount expose the index/count. Intermediates are RGBA8 to match the
    browser renderer exactly. Returns one (height, width, 4) float32 array per job.
    """
    from comfy_extras.nodes_glsl import (
        GLContext,
        VERTEX_SHADER,
        _convert_es_to_desktop,
        _create_program,
        _import_opengl,
    )

    if not jobs:
        return []
    if width > MAX_RENDER_DIM or height > MAX_RENDER_DIM:
        raise ValueError(f"ShaderEffect: render size {width}x{height} exceeds {MAX_RENDER_DIM}")
    if jobs[0].get("image") is None:
        raise ValueError("ShaderEffect: the first job must include an image")

    n_passes = max(1, int(passes))
    ctx = GLContext()
    ctx.make_current()
    gl = _import_opengl()

    fragment_source = _convert_es_to_desktop(fragment_code)
    extra_textures = extra_textures or {}

    program = None
    fbo = None
    out_tex = None
    in_tex = None
    extra_tex_ids = []
    pp_tex = []
    pp_fbo = []
    try:
        program = _create_program(VERTEX_SHADER, fragment_source)
        gl.glUseProgram(program)

        # Final output FBO (single-pass renders here; RGBA32F for clean readback).
        fbo = gl.glGenFramebuffers(1)
        gl.glBindFramebuffer(gl.GL_FRAMEBUFFER, fbo)
        out_tex = gl.glGenTextures(1)
        gl.glBindTexture(gl.GL_TEXTURE_2D, out_tex)
        gl.glTexImage2D(gl.GL_TEXTURE_2D, 0, gl.GL_RGBA32F, width, height, 0, gl.GL_RGBA, gl.GL_FLOAT, None)
        gl.glTexParameteri(gl.GL_TEXTURE_2D, gl.GL_TEXTURE_MIN_FILTER, gl.GL_LINEAR)
        gl.glTexParameteri(gl.GL_TEXTURE_2D, gl.GL_TEXTURE_MAG_FILTER, gl.GL_LINEAR)
        gl.glFramebufferTexture2D(gl.GL_FRAMEBUFFER, gl.GL_COLOR_ATTACHMENT0, gl.GL_TEXTURE_2D, out_tex, 0)
        gl.glDrawBuffers(1, [gl.GL_COLOR_ATTACHMENT0])
        if gl.glCheckFramebufferStatus(gl.GL_FRAMEBUFFER) != gl.GL_FRAMEBUFFER_COMPLETE:
            raise RuntimeError("ShaderEffect: framebuffer incomplete")

        # Ping-pong RGBA8 textures for multi-pass (match browser 8-bit intermediates).
        if n_passes > 1:
            for _ in range(2):
                t = gl.glGenTextures(1)
                pp_tex.append(t)
                gl.glBindTexture(gl.GL_TEXTURE_2D, t)
                gl.glTexImage2D(gl.GL_TEXTURE_2D, 0, gl.GL_RGBA8, width, height, 0, gl.GL_RGBA, gl.GL_UNSIGNED_BYTE, None)
                for pn in (gl.GL_TEXTURE_MIN_FILTER, gl.GL_TEXTURE_MAG_FILTER):
                    gl.glTexParameteri(gl.GL_TEXTURE_2D, pn, gl.GL_LINEAR)
                for pn in (gl.GL_TEXTURE_WRAP_S, gl.GL_TEXTURE_WRAP_T):
                    gl.glTexParameteri(gl.GL_TEXTURE_2D, pn, gl.GL_CLAMP_TO_EDGE)
                f = gl.glGenFramebuffers(1)
                pp_fbo.append(f)
                gl.glBindFramebuffer(gl.GL_FRAMEBUFFER, f)
                gl.glFramebufferTexture2D(gl.GL_FRAMEBUFFER, gl.GL_COLOR_ATTACHMENT0, gl.GL_TEXTURE_2D, t, 0)
                gl.glDrawBuffers(1, [gl.GL_COLOR_ATTACHMENT0])
                if gl.glCheckFramebufferStatus(gl.GL_FRAMEBUFFER) != gl.GL_FRAMEBUFFER_COMPLETE:
                    raise RuntimeError("ShaderEffect: ping-pong framebuffer incomplete")

        # Source texture: unit 0 = u_image0 (pass 0), unit 1 = u_source (persistent).
        in_tex = gl.glGenTextures(1)
        gl.glActiveTexture(gl.GL_TEXTURE0)
        gl.glBindTexture(gl.GL_TEXTURE_2D, in_tex)
        for pn in (gl.GL_TEXTURE_MIN_FILTER, gl.GL_TEXTURE_MAG_FILTER):
            gl.glTexParameteri(gl.GL_TEXTURE_2D, pn, gl.GL_LINEAR)
        for pn in (gl.GL_TEXTURE_WRAP_S, gl.GL_TEXTURE_WRAP_T):
            gl.glTexParameteri(gl.GL_TEXTURE_2D, pn, gl.GL_CLAMP_TO_EDGE)
        loc = gl.glGetUniformLocation(program, "u_image0")
        if loc >= 0:
            gl.glUniform1i(loc, 0)
        gl.glActiveTexture(gl.GL_TEXTURE1)
        gl.glBindTexture(gl.GL_TEXTURE_2D, in_tex)
        sloc = gl.glGetUniformLocation(program, "u_source")
        if sloc >= 0:
            gl.glUniform1i(sloc, 1)

        # Extra textures on units 2+ (NEAREST: glyph atlases sampled exactly).
        for i, (uname, arr) in enumerate(sorted(extra_textures.items())):
            unit = 2 + i
            tex = gl.glGenTextures(1)
            extra_tex_ids.append(tex)
            gl.glActiveTexture(gl.GL_TEXTURE0 + unit)
            gl.glBindTexture(gl.GL_TEXTURE_2D, tex)
            for pn in (gl.GL_TEXTURE_MIN_FILTER, gl.GL_TEXTURE_MAG_FILTER):
                gl.glTexParameteri(gl.GL_TEXTURE_2D, pn, gl.GL_NEAREST)
            for pn in (gl.GL_TEXTURE_WRAP_S, gl.GL_TEXTURE_WRAP_T):
                gl.glTexParameteri(gl.GL_TEXTURE_2D, pn, gl.GL_CLAMP_TO_EDGE)
            th, tw, _ = arr.shape
            gl.glTexImage2D(gl.GL_TEXTURE_2D, 0, gl.GL_RGBA32F, tw, th, 0, gl.GL_RGBA, gl.GL_FLOAT,
                            np.ascontiguousarray(arr[::-1, :, :]))
            uloc = gl.glGetUniformLocation(program, uname)
            if uloc >= 0:
                gl.glUniform1i(uloc, unit)

        loc = gl.glGetUniformLocation(program, "u_resolution")
        if loc >= 0:
            gl.glUniform2f(loc, float(width), float(height))
        pcloc = gl.glGetUniformLocation(program, "u_passCount")
        if pcloc >= 0:
            gl.glUniform1f(pcloc, float(n_passes))
        ploc = gl.glGetUniformLocation(program, "u_pass")

        gl.glViewport(0, 0, width, height)
        gl.glDisable(gl.GL_BLEND)

        outputs = []
        for job in jobs:
            img = job.get("image")
            if img is not None:
                h, w, c = img.shape
                if c == 3:
                    upload = np.empty((h, w, 4), dtype=np.float32)
                    upload[:, :, :3] = img[::-1, :, :]
                    upload[:, :, 3] = 1.0
                else:
                    upload = np.ascontiguousarray(img[::-1, :, :], dtype=np.float32)
                gl.glActiveTexture(gl.GL_TEXTURE0)
                gl.glBindTexture(gl.GL_TEXTURE_2D, in_tex)
                gl.glTexImage2D(gl.GL_TEXTURE_2D, 0, gl.GL_RGBA32F, w, h, 0, gl.GL_RGBA, gl.GL_FLOAT, upload)

            for uname, val in job.get("uniforms", {}).items():
                uloc = gl.glGetUniformLocation(program, uname)
                if uloc >= 0:
                    gl.glUniform1f(uloc, float(val))

            if n_passes == 1:
                if ploc >= 0:
                    gl.glUniform1f(ploc, 0.0)
                gl.glActiveTexture(gl.GL_TEXTURE0)
                gl.glBindTexture(gl.GL_TEXTURE_2D, in_tex)
                gl.glBindFramebuffer(gl.GL_FRAMEBUFFER, fbo)
                gl.glClearColor(0, 0, 0, 0)
                gl.glClear(gl.GL_COLOR_BUFFER_BIT)
                gl.glDrawArrays(gl.GL_TRIANGLES, 0, 3)
                gl.glBindTexture(gl.GL_TEXTURE_2D, out_tex)
                data = gl.glGetTexImage(gl.GL_TEXTURE_2D, 0, gl.GL_RGBA, gl.GL_FLOAT)
                out = np.frombuffer(data, dtype=np.float32).reshape(height, width, 4)
                outputs.append(out[::-1, :, :].copy())
                gl.glActiveTexture(gl.GL_TEXTURE0)
                gl.glBindTexture(gl.GL_TEXTURE_2D, in_tex)
            else:
                for k in range(n_passes):
                    if ploc >= 0:
                        gl.glUniform1f(ploc, float(k))
                    gl.glActiveTexture(gl.GL_TEXTURE0)
                    src = in_tex if k == 0 else pp_tex[(k - 1) % 2]
                    gl.glBindTexture(gl.GL_TEXTURE_2D, src)
                    gl.glBindFramebuffer(gl.GL_FRAMEBUFFER, pp_fbo[k % 2])
                    gl.glClearColor(0, 0, 0, 0)
                    gl.glClear(gl.GL_COLOR_BUFFER_BIT)
                    gl.glDrawArrays(gl.GL_TRIANGLES, 0, 3)
                final_tex = pp_tex[(n_passes - 1) % 2]
                gl.glBindTexture(gl.GL_TEXTURE_2D, final_tex)
                data = gl.glGetTexImage(gl.GL_TEXTURE_2D, 0, gl.GL_RGBA, gl.GL_FLOAT)
                out = np.frombuffer(data, dtype=np.float32).reshape(height, width, 4)
                outputs.append(out[::-1, :, :].copy())
                gl.glActiveTexture(gl.GL_TEXTURE0)
                gl.glBindTexture(gl.GL_TEXTURE_2D, in_tex)

        return outputs
    finally:
        gl.glBindFramebuffer(gl.GL_FRAMEBUFFER, 0)
        gl.glUseProgram(0)
        if in_tex is not None:
            gl.glDeleteTextures(int(in_tex))
        if out_tex is not None:
            gl.glDeleteTextures(int(out_tex))
        for tex in extra_tex_ids:
            gl.glDeleteTextures(int(tex))
        for tex in pp_tex:
            gl.glDeleteTextures(int(tex))
        if fbo is not None:
            gl.glDeleteFramebuffers(1, [fbo])
        for f in pp_fbo:
            gl.glDeleteFramebuffers(1, [f])
        if program is not None:
            gl.glDeleteProgram(program)
