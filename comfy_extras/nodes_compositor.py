from __future__ import annotations

import json
import logging
import math
from fractions import Fraction

import numpy as np
import torch
import torch.nn.functional as F
from PIL import Image as PILImage, ImageOps
from typing_extensions import override

import folder_paths
from comfy_api.latest import ComfyExtension, IO, InputImpl, Types
from comfy_extras._live_preview import save_live_preview


_BLEND_MODES = [
    "normal", "multiply", "screen", "overlay", "soft_light", "hard_light",
    "difference", "lighten", "darken", "add",
]


def _blend(base: torch.Tensor, top: torch.Tensor, mode: str) -> torch.Tensor:
    a, b = base, top
    if mode == "normal":     return b
    if mode == "multiply":   return a * b
    if mode == "screen":     return 1.0 - (1.0 - a) * (1.0 - b)
    if mode == "overlay":
        return torch.where(a < 0.5, 2.0 * a * b, 1.0 - 2.0 * (1.0 - a) * (1.0 - b))
    if mode == "soft_light":
        # W3C/CSS soft-light, matching the browser <canvas> the preview renders
        # with. (Was the Pegtop approximation, which drifted up to ~28/255 vs the
        # editor — see tests-unit/comfy_extras_test/test_compositor_blend_conformance.py)
        d = torch.where(a <= 0.25, ((16.0 * a - 12.0) * a + 4.0) * a, torch.sqrt(a))
        return torch.where(b < 0.5, a - (1.0 - 2.0 * b) * a * (1.0 - a), a + (2.0 * b - 1.0) * (d - a))
    if mode == "hard_light":
        return torch.where(b < 0.5, 2.0 * a * b, 1.0 - 2.0 * (1.0 - a) * (1.0 - b))
    if mode == "difference": return (a - b).abs()
    if mode == "lighten":    return torch.maximum(a, b)
    if mode == "darken":     return torch.minimum(a, b)
    if mode == "add":        return (a + b).clamp(0.0, 1.0)
    return b


def _resize_to(t: torch.Tensor, canvas_h: int, canvas_w: int) -> torch.Tensor:
    """Stretch a (b, c, h, w) tensor to exactly canvas size (no aspect padding).

    Used for the alpha overlay, which is authored client-side at the canvas
    resolution and must map 1:1 — stretching (rather than aspect-fit padding)
    avoids any pad-polarity ambiguity in the companion mask.
    """
    if t.shape[-2:] == (canvas_h, canvas_w):
        return t
    return F.interpolate(t, size=(canvas_h, canvas_w), mode="bilinear", align_corners=False)


def _fit_to_canvas(layer: torch.Tensor, canvas_h: int, canvas_w: int) -> torch.Tensor:
    """Resize a layer to fit within canvas while preserving aspect, centered."""
    b, c, h, w = layer.shape
    if (h, w) == (canvas_h, canvas_w):
        return layer
    canvas_aspect = canvas_w / canvas_h
    layer_aspect = w / h
    if layer_aspect > canvas_aspect:
        new_w = canvas_w
        new_h = max(1, int(canvas_w / layer_aspect))
    else:
        new_h = canvas_h
        new_w = max(1, int(canvas_h * layer_aspect))
    resized = F.interpolate(layer, size=(new_h, new_w), mode="bilinear", align_corners=False)
    pad_h = canvas_h - new_h
    pad_w = canvas_w - new_w
    pad_top = pad_h // 2
    pad_bottom = pad_h - pad_top
    pad_left = pad_w // 2
    pad_right = pad_w - pad_left
    return F.pad(resized, [pad_left, pad_right, pad_top, pad_bottom], mode="constant", value=0)


def _transform(layer: torch.Tensor, x_off: float, y_off: float, rotation: float, scale: float):
    """Apply (translate, rotate, scale) to a layer-sized tensor.

    Returns (rgb, alpha) where alpha is 1 where the source mapped within the
    layer and 0 outside.
    """
    b, c, h, w = layer.shape
    device, dtype = layer.device, layer.dtype
    rad = math.radians(rotation)
    cos_a, sin_a = math.cos(rad), math.sin(rad)
    s = max(0.01, float(scale))
    # Inverse affine: output (qx, qy) → input pixel.
    # input_x = (cos_a * (qx - x_off) + sin_a * (qy - y_off)) / s
    # input_y = (-sin_a * (qx - x_off) + cos_a * (qy - y_off)) / s
    m00 = cos_a / s
    m01 = sin_a / s
    m02 = (-x_off * cos_a - y_off * sin_a) / s
    m10 = -sin_a / s
    m11 = cos_a / s
    m12 = (x_off * sin_a - y_off * cos_a) / s
    theta = torch.tensor([[m00, m01, m02], [m10, m11, m12]], dtype=dtype, device=device).unsqueeze(0).expand(b, -1, -1)
    grid = F.affine_grid(theta, (b, c, h, w), align_corners=False)
    rgb = F.grid_sample(layer, grid, mode="bilinear", padding_mode="zeros", align_corners=False)
    ones = torch.ones(b, 1, h, w, dtype=dtype, device=device)
    alpha = F.grid_sample(ones, grid, mode="bilinear", padding_mode="zeros", align_corners=False)
    return rgb, alpha


def _prep_layer(layer: dict, canvas_h: int, canvas_w: int):
    """Resolve a gathered layer to (rgb, alpha) at canvas resolution.

    `alpha` folds together geometric coverage (from the transform), the layer's
    opacity, and — when present — a per-pixel mask. Baked text/shape layers are
    authored at canvas resolution with an identity transform, so for them the
    fit/transform are no-ops and `alpha` is just `opacity * (1 - mask)`. Wired
    image layers carry no mask, so `alpha` is geometric coverage * opacity,
    exactly as before.
    """
    t = layer["image"].permute(0, 3, 1, 2)
    # Normalize channel count. Upstream IMAGE tensors are usually 3-channel RGB,
    # but some nodes emit RGBA (4ch, e.g. text/shape renders that keep their
    # transparency) or single-channel grayscale. Mixing a 4ch layer with the
    # 3ch running composite throws "tensor a (4) must match tensor b (3)". Carry
    # any embedded alpha as a 4th channel through fit+transform so it warps with
    # the image, then split it off and fold it into coverage below.
    c = t.shape[1]
    if c == 1:
        t = t.repeat(1, 3, 1, 1)
    elif c == 2:  # gray + alpha
        t = torch.cat([t[:, :1].repeat(1, 3, 1, 1), t[:, 1:2]], dim=1)
    t = _fit_to_canvas(t, canvas_h, canvas_w)  # no-op when already canvas-sized
    out, geo = _transform(t, layer["x"], layer["y"], layer["rot"], layer["scl"])
    rgb = out[:, :3, :, :]
    a = (geo * layer["op"]).clamp(0.0, 1.0)
    if out.shape[1] >= 4:  # fold the image's own alpha into coverage
        a = (a * out[:, 3:4, :, :].clamp(0.0, 1.0)).clamp(0.0, 1.0)
    mask = layer.get("mask")
    if mask is not None:
        if mask.dim() == 2:
            mask = mask.unsqueeze(0)
        if mask.dim() == 3:
            mask = mask.unsqueeze(1)
        mask = _resize_to(mask.to(rgb.dtype), canvas_h, canvas_w)
        a = (a * (1.0 - mask)).clamp(0.0, 1.0)  # MASK is 1 - alpha
    return rgb, a


def _parse_cloner(raw) -> dict | None:
    """Parse a `layer{i}_cloner` widget value (JSON string) into a config dict.

    Returns None when absent/blank/invalid so the layer renders as a single
    instance (today's behavior).
    """
    if not raw or not isinstance(raw, str):
        return None
    try:
        obj = json.loads(raw)
    except (json.JSONDecodeError, TypeError):
        return None
    return obj if isinstance(obj, dict) else None


def _expand_clones(layer: dict, cloner: dict | None, aspect: float) -> list[dict]:
    """Expand a layer into clone instances per its cloner config.

    Mirror of expandClones() in frontend/app/composables/useCloner.ts — keep the
    two in sync. Returns layer dicts (shallow copies) in BACK-TO-FRONT order
    (the original, k=0, LAST) so the full-opacity original composites on top
    within its z slot, exactly like the client preview. Offsets add to x/y;
    falloff steps rotation/scale/opacity by clone index k. `aspect = W/H` keeps
    the radial ring circular on screen (x maps to W, y maps to H).
    """
    if not cloner or not cloner.get("enabled"):
        return [layer]

    step_rot = float(cloner.get("stepRotation", 0.0) or 0.0)
    step_scl = float(cloner.get("stepScale", 1.0) or 1.0)
    step_op = float(cloner.get("stepOpacity", 1.0) or 1.0)

    # (k, dx, dy, extra_rot) per clone, built k-ascending.
    specs: list[tuple[int, float, float, float]] = []
    if cloner.get("mode") == "radial":
        n = max(1, int(cloner.get("count", 1)))
        sweep = float(cloner.get("sweepAngle", 360.0))
        radius = float(cloner.get("radius", 0.0))
        start = float(cloner.get("startAngle", 0.0))
        face = bool(cloner.get("faceCenter", False))
        full = abs(sweep) >= 359.999
        denom = n if full else max(1, n - 1)
        for i in range(n):
            ang_deg = start + sweep * (i / denom)
            ang = math.radians(ang_deg)
            dx = radius * math.cos(ang)
            dy = radius * aspect * math.sin(ang)
            specs.append((i, dx, dy, ang_deg if face else 0.0))
    else:
        nx = max(1, int(cloner.get("countX", 1)))
        ny = max(1, int(cloner.get("countY", 1)))
        sx = float(cloner.get("spacingX", 0.0))
        sy = float(cloner.get("spacingY", 0.0))
        # Mirroring reflects the non-original steps to the opposite side so the
        # original stays centered; falloff step k = distance from the original
        # (|iy|*nx + |ix|) so a mirrored clone matches its positive twin.
        xs = list(range(nx)) + ([-ix for ix in range(1, nx)] if cloner.get("mirrorX") else [])
        ys = list(range(ny)) + ([-iy for iy in range(1, ny)] if cloner.get("mirrorY") else [])
        nudge_x = float(cloner.get("nudgeX", 0.0) or 0.0)
        nudge_y = float(cloner.get("nudgeY", 0.0) or 0.0)
        stag_x = float(cloner.get("staggerX", 0.0) or 0.0)
        stag_y = float(cloner.get("staggerY", 0.0) or 0.0)
        for iy in ys:
            for ix in xs:
                k = abs(iy) * nx + abs(ix)
                # base grid + progressive nudge (by k) + brick stagger (alternating rows/cols)
                dx = ix * sx + k * nudge_x
                dy = iy * sy + k * nudge_y
                if stag_x:
                    dx += (abs(iy) % 2) * stag_x * sx
                if stag_y:
                    dy += (abs(ix) % 2) * stag_y * sy
                specs.append((k, dx, dy, 0.0))

    out = []
    for (k, dx, dy, extra_rot) in specs:
        c = dict(layer)
        c["x"] = layer["x"] + dx
        c["y"] = layer["y"] + dy
        c["rot"] = layer["rot"] + k * step_rot + extra_rot
        c["scl"] = layer["scl"] * (step_scl ** k)
        c["op"] = layer["op"] * (step_op ** k)
        out.append(c)
    out.reverse()  # original (k=0) last → composites on top
    return out


def _composite_layers(layers: list[dict], canvas_h: int, canvas_w: int) -> torch.Tensor:
    """Composite gathered layers onto a canvas, ordered by ascending z.

    Stable sort, so equal/default z preserves the order layers were gathered in
    (slot order). The lowest layer lands on implicit black; each subsequent
    layer blends over the running result, its alpha folding in opacity and any
    per-pixel mask. Returns a (b, 3, canvas_h, canvas_w) tensor. With no layers
    it returns a black canvas (an explicit-size artboard with nothing wired).
    """
    ordered = sorted(layers, key=lambda l: l["z"])
    result = None
    for layer in ordered:
        rgb, a = _prep_layer(layer, canvas_h, canvas_w)
        if result is None:
            result = rgb * a
        else:
            blended = _blend(result, rgb, layer["blend"])
            result = result * (1.0 - a) + blended * a
    if result is None:
        result = torch.zeros(1, 3, canvas_h, canvas_w)
    return result


def _protect_coverage(layers: list[dict], canvas_h: int, canvas_w: int):
    """Union the canvas-space coverage of every layer flagged `protect`.

    Returns a [B, 1, H, W] alpha (1 where a protected layer covers) or None if
    no layer is protected. Reuses _prep_layer so the coverage matches exactly
    where each protected layer lands in the composite (transform + opacity +
    embedded/mask alpha).
    """
    cov = None
    for layer in layers:
        if not layer.get("protect"):
            continue
        _rgb, a = _prep_layer(layer, canvas_h, canvas_w)
        cov = a if cov is None else torch.maximum(cov, a)
    return cov


def _load_motion_frame(filename: str):
    """Uploaded PNG → (IMAGE [H,W,3] float 0..1, alpha [H,W] float 0..1).

    Adapted from nodes_kinetic_type._load_frame, but returns the RAW alpha
    (1 = covered) rather than the inverted ComfyUI MASK convention — the
    motion path unions these alphas into the protect_mask output, which is
    1 where a layer covers.
    """
    path = folder_paths.get_annotated_filepath(filename)
    img = PILImage.open(path)
    img = ImageOps.exif_transpose(img)
    if "A" in img.getbands():
        alpha = torch.from_numpy(np.array(img.getchannel("A")).astype(np.float32) / 255.0)
    else:
        alpha = torch.ones(img.height, img.width, dtype=torch.float32)
    rgb = torch.from_numpy(np.array(img.convert("RGB")).astype(np.float32) / 255.0)
    return rgb, alpha


def _video_from(images: torch.Tensor, fps: int | Fraction):
    """Wrap an IMAGE batch [N,H,W,3] as a VIDEO output (CreateVideo's pattern)."""
    return InputImpl.VideoFromComponents(
        Types.VideoComponents(images=images, audio=None, frame_rate=Fraction(fps))
    )


def _layer_inputs(idx: int, optional: bool):
    """Build the per-layer input declarations for layer N."""
    return [
        IO.Image.Input(f"layer{idx}", optional=optional,
                       tooltip=f"Layer {idx}{' (sets canvas size)' if idx == 1 else ''}"),
        IO.Float.Input(f"layer{idx}_x",        default=0.0, min=-1.5, max=1.5, step=0.01,
                       tooltip="Horizontal offset in canvas units (-1 = full canvas width)."),
        IO.Float.Input(f"layer{idx}_y",        default=0.0, min=-1.5, max=1.5, step=0.01,
                       tooltip="Vertical offset in canvas units."),
        IO.Float.Input(f"layer{idx}_rotation", default=0.0, min=-180.0, max=180.0, step=1.0),
        IO.Float.Input(f"layer{idx}_scale",    default=1.0, min=0.1, max=3.0, step=0.05),
        IO.Float.Input(f"layer{idx}_opacity",  default=1.0, min=0.0, max=1.0, step=0.01),
        IO.Combo.Input(f"layer{idx}_blend",    options=_BLEND_MODES, default="normal"),
    ]


_MAX_LAYERS = 16


class CompositorNode(IO.ComfyNode):
    @classmethod
    def define_schema(cls):
        inputs = []
        for i in range(1, _MAX_LAYERS + 1):
            inputs.extend(_layer_inputs(i, optional=(i > 1)))
        # Explicit artboard size. When both > 0 the canvas is exactly this size
        # and every layer (including layer 1) is fit into it; 0 = size from
        # layer 1 (backward compatible). Lets a Frame have a fixed size with no
        # base image.
        inputs.append(IO.Int.Input("width", optional=True, default=0, min=0, max=8192,
                                   tooltip="Artboard width in px. 0 = size from layer 1."))
        inputs.append(IO.Int.Input("height", optional=True, default=0, min=0, max=8192,
                                   tooltip="Artboard height in px. 0 = size from layer 1."))
        # Per-layer stacking order — composite order is by ascending z, not slot.
        # This lets any layer (wired image or baked text/shape) sit above or
        # below any other. Declared optional and AFTER width/height so workflows
        # saved against the older schema realign by appending: their existing
        # widget positions don't shift. Default z = slot index, so an untouched
        # graph composites in slot order exactly as before.
        for i in range(1, _MAX_LAYERS + 1):
            inputs.append(IO.Float.Input(f"layer{i}_z", optional=True, default=float(i),
                                         min=-1000.0, max=1000.0, step=1.0,
                                         tooltip="Stacking order; lower = further back."))
        # Per-layer alpha mask (MASK port). Baked text/shape layers are injected
        # at a chosen z with their per-pixel alpha here, so they interleave with
        # wired layers instead of always landing on top. Declared after every
        # image port so layer1..16 keep input indices 0..15.
        for i in range(1, _MAX_LAYERS + 1):
            inputs.append(IO.Mask.Input(f"layer{i}_mask", optional=True,
                                        tooltip="Per-pixel alpha for layer N (LoadImage MASK = 1 - alpha)."))
        # Alpha overlay: text/shape layers authored in the editor are baked
        # client-side into one RGBA image at canvas resolution and fed here.
        # The mask carries per-pixel transparency (LoadImage's MASK output,
        # which is 1 - alpha). Always composited last, on top of every layer.
        inputs.append(IO.Image.Input("overlay", optional=True,
                                     tooltip="Text/shape overlay, composited on top with per-pixel alpha."))
        inputs.append(IO.Mask.Input("overlay_mask", optional=True,
                                    tooltip="Alpha for the overlay (LoadImage MASK = 1 - alpha)."))
        # Per-layer "protect in blend": when on, the layer's coverage is unioned
        # into the `protect_mask` output (canvas space, 1 = protected). Wired into
        # Blend Scene's keep_subject so that region stays pixel-exact through the
        # AI blend. Appended last so existing widget positions don't shift.
        for i in range(1, _MAX_LAYERS + 1):
            inputs.append(IO.Boolean.Input(f"layer{i}_protect", optional=True, default=False,
                                           tooltip="Keep this layer pixel-exact when the scene is blended (Blend Scene)."))
        # Motion (Kinetic Slates): when the Frame has been animated and baked
        # client-side, this JSON carries {fps, duration, rendered: [...input
        # filenames...], source_key}. When rendered is non-empty the node
        # returns the baked frame batch + a real video instead of the static
        # server-side composite (the bake IS the composition, like `overlay`
        # but over time). Injected at submit from the editor; not hand-edited.
        inputs.append(IO.String.Input("motion_params", optional=True, default="",
                                      multiline=True,
                                      tooltip="Baked motion frames (managed by the Frame editor)."))
        # Per-layer linked cloner (JSON, managed by the Frame editor). When
        # enabled the layer is stamped N times (linear/grid/radial) with falloff;
        # see _expand_clones. Appended last so existing widget positions don't
        # shift. Default "" = a single instance (today's behavior).
        for i in range(1, _MAX_LAYERS + 1):
            inputs.append(IO.String.Input(f"layer{i}_cloner", optional=True, default="",
                                          multiline=True,
                                          tooltip="Linked cloner config (managed by the Frame editor)."))
        return IO.Schema(
            node_id="Compositor",
            display_name="Compositor",
            description=f"Stack up to {_MAX_LAYERS} image layers with transform, opacity, and blend. "
                        "Unused slots are inert — connect as many as your composition needs.",
            category="image/composite",
            inputs=inputs,
            outputs=[
                IO.Image.Output(display_name="image"),
                # Union of layers flagged "protect" — 1 where a protected layer
                # covers the canvas. Feeds Blend Scene's keep_subject.
                IO.Mask.Output(display_name="protect_mask"),
                # 1-frame video of the static composite normally; the baked
                # animation at its fps when motion_params has rendered frames.
                IO.Video.Output(display_name="video"),
            ],
            hidden=[IO.Hidden.unique_id],
            is_output_node=True,
        )

    @classmethod
    def execute(cls, **kwargs) -> IO.NodeOutput:
        # Motion path (Kinetic Slates): when the Frame was animated and baked
        # client-side, motion_params carries the uploaded PNG frame filenames.
        # The bake REPLACES the server-side composite entirely — it already
        # contains wired + local layers as composited in the editor — so we
        # load the frames, return them as the image batch, and wrap them as a
        # real video at the baked fps. The protect mask is the per-pixel MAX
        # of frame alphas (everywhere the slate ever draws).
        try:
            motion = json.loads(kwargs.get("motion_params") or "{}")
            if not isinstance(motion, dict):
                motion = {}
        except json.JSONDecodeError:
            motion = {}
        rendered = motion.get("rendered")
        if isinstance(rendered, list) and rendered:
            frames, alphas = [], []
            for filename in rendered:
                try:
                    rgb, alpha = _load_motion_frame(str(filename))
                    # A corrupt/partial upload can mix resolutions; torch.stack
                    # would hard-error, so drop frames that disagree with frame 0
                    # (the editor always re-bakes the whole sequence at one size).
                    if frames and rgb.shape != frames[0].shape:
                        logging.warning("[Compositor] motion frame %s has size %s != %s — skipped (re-bake to fix)",
                                        filename, tuple(rgb.shape[:2]), tuple(frames[0].shape[:2]))
                        continue
                    frames.append(rgb)
                    alphas.append(alpha)
                except Exception:
                    continue  # skip frames that went missing from input/
            if not frames and rendered:
                logging.warning("[Compositor] motion path: all %d baked frames failed to load — "
                                "falling back to the static composite (re-bake the Frame)", len(rendered))
            if frames:
                batch = torch.stack(frames, dim=0)            # [N,H,W,3]
                fps = max(1, int(motion.get("fps", 30)))
                video = _video_from(batch, fps)
                protect = torch.stack(alphas, dim=0).amax(dim=0, keepdim=True)  # [1,H,W]
                protect = protect.clamp(0.0, 1.0).to(batch.dtype)
                return IO.NodeOutput(batch, protect, video,
                                     ui=save_live_preview(batch[:1], str(cls.hidden.unique_id)))

        # Gather provided layers in order. Unconnected slots return None and
        # are skipped — the composite uses only the layers that have an image.
        layers = []
        for i in range(1, _MAX_LAYERS + 1):
            img = kwargs.get(f"layer{i}")
            if img is None:
                continue
            layers.append({
                "image": img,
                "x":   float(kwargs.get(f"layer{i}_x", 0.0)),
                "y":   float(kwargs.get(f"layer{i}_y", 0.0)),
                "rot": float(kwargs.get(f"layer{i}_rotation", 0.0)),
                "scl": float(kwargs.get(f"layer{i}_scale", 1.0)),
                "op":  float(kwargs.get(f"layer{i}_opacity", 1.0)),
                "blend": kwargs.get(f"layer{i}_blend", "normal"),
                "z":   float(kwargs.get(f"layer{i}_z", float(i))),
                "mask": kwargs.get(f"layer{i}_mask"),
                "protect": bool(kwargs.get(f"layer{i}_protect", False)),
                "cloner": _parse_cloner(kwargs.get(f"layer{i}_cloner")),
            })

        width = int(kwargs.get("width", 0) or 0)
        height = int(kwargs.get("height", 0) or 0)
        explicit = width > 0 and height > 0

        if not layers and not explicit:
            # Nothing connected and no explicit size — return a tiny black image.
            blank = torch.zeros(1, 16, 16, 3)
            blank_mask = torch.zeros(1, 16, 16)
            return IO.NodeOutput(blank, blank_mask, _video_from(blank, 1),
                                 ui=save_live_preview(blank, str(cls.hidden.unique_id)))

        if explicit:
            canvas_h, canvas_w = height, width
        else:
            _, ch, cw, _ = layers[0]["image"].shape
            canvas_h, canvas_w = ch, cw

        # Linked cloner: expand each layer into its clone instances now that the
        # canvas size (hence aspect) is known. Disabled/absent ⇒ the layer passes
        # through unchanged. Done before compositing AND protect-coverage so both
        # see every clone.
        aspect = (canvas_w / canvas_h) if canvas_h else 1.0
        expanded = []
        for layer in layers:
            expanded.extend(_expand_clones(layer, layer.get("cloner"), aspect))
        layers = expanded

        # Composite by ascending z. Canvas size still follows the lowest *slot*
        # (layers[0]) above, so reordering depth never resizes the artboard.
        result = _composite_layers(layers, canvas_h, canvas_w)

        # Alpha overlay (text/shapes) — always on top, straight per-pixel alpha.
        overlay = kwargs.get("overlay")
        if overlay is not None:
            o = _resize_to(overlay.permute(0, 3, 1, 2), canvas_h, canvas_w)
            # Coerce overlay to 3-channel RGB; if it carries its own alpha (RGBA),
            # fold it into the composite alpha below so it can't collide with the
            # 3-channel result.
            embedded_a = None
            if o.shape[1] == 1:
                o = o.repeat(1, 3, 1, 1)
            elif o.shape[1] >= 4:
                embedded_a = o[:, 3:4, :, :].clamp(0.0, 1.0)
                o = o[:, :3, :, :]
            mask = kwargs.get("overlay_mask")
            if mask is not None:
                if mask.dim() == 2:
                    mask = mask.unsqueeze(0)
                if mask.dim() == 3:
                    mask = mask.unsqueeze(1)
                mask = _resize_to(mask.to(result.dtype), canvas_h, canvas_w)
                a = (1.0 - mask).clamp(0.0, 1.0)  # MASK is 1 - alpha
            else:
                a = torch.ones(o.shape[0], 1, canvas_h, canvas_w, dtype=result.dtype, device=result.device)
            if embedded_a is not None:
                a = (a * _resize_to(embedded_a.to(result.dtype), canvas_h, canvas_w)).clamp(0.0, 1.0)
            result = result * (1.0 - a) + o.to(result.dtype) * a

        out = result.permute(0, 2, 3, 1).clamp(0.0, 1.0)

        # Build the protect mask (union of protected layers' coverage). 1 where a
        # protected layer covers — fed straight into Blend Scene's keep_subject.
        cov = _protect_coverage(layers, canvas_h, canvas_w)
        if cov is None:
            protect_mask = torch.zeros(out.shape[0], canvas_h, canvas_w, dtype=out.dtype)
        else:
            protect_mask = cov.squeeze(1).clamp(0.0, 1.0).to(out.dtype)

        # Static composites still emit a video output — a 1-frame video of the
        # composite — so downstream VIDEO consumers can wire unconditionally.
        return IO.NodeOutput(out, protect_mask, _video_from(out, 1),
                             ui=save_live_preview(out, str(cls.hidden.unique_id)))


class CompositorExtension(ComfyExtension):
    @override
    async def get_node_list(self) -> list[type[IO.ComfyNode]]:
        return [CompositorNode]


async def comfy_entrypoint() -> CompositorExtension:
    return CompositorExtension()


# ── Bake-frame cleanup route ─────────────────────────────────────────────────
# The Frame editor uploads every motion bake as a fresh PNG sequence (prefix
# 'slate', see frontend bake.ts); on a successful re-bake it calls this route
# to delete the superseded sequence. Strictly scoped: bare filenames matching
# the slate frame pattern in the input/ ROOT only — no subfolders, no
# traversal — and anything listed in `keep` survives, so frames referenced by
# the node's current motion_params can never be deleted.
try:
    import os
    import re as _re

    from aiohttp import web
    from server import PromptServer

    _SLATE_FRAME_RE = _re.compile(r"^slate_\d+_\d{4}\.png$")

    @PromptServer.instance.routes.post("/sailor/motion/cleanup_frames")
    async def _cleanup_motion_frames(request):
        """Body: {delete: string[], keep?: string[]} → {deleted, skipped}."""
        try:
            body = await request.json()
        except Exception:  # noqa: BLE001
            return web.json_response({"error": "invalid json"}, status=400)
        delete = body.get("delete")
        keep = body.get("keep") or []
        if not isinstance(delete, list) or not isinstance(keep, list):
            return web.json_response({"error": "bad payload"}, status=400)
        keep_set = {os.path.basename(k) for k in keep if isinstance(k, str)}
        input_dir = folder_paths.get_input_directory()
        deleted = 0
        skipped = 0
        for name in delete:
            # Reject anything that isn't a bare, pattern-matching slate frame.
            if (not isinstance(name, str)
                    or os.path.basename(name) != name
                    or not _SLATE_FRAME_RE.match(name)
                    or name in keep_set):
                skipped += 1
                continue
            try:
                os.remove(os.path.join(input_dir, name))
                deleted += 1
            except OSError:  # missing already, or filesystem refusal
                skipped += 1
        if deleted:
            logging.info("[Compositor] motion cleanup: deleted %d superseded bake frames", deleted)
        return web.json_response({"deleted": deleted, "skipped": skipped})
except Exception:  # noqa: BLE001
    # Running outside the ComfyUI server (e.g. unit tests importing the node
    # module directly) — the route simply isn't registered. Broad on purpose:
    # under pytest `from server import PromptServer` can succeed while
    # PromptServer.instance is unset (AttributeError, not ImportError).
    pass
