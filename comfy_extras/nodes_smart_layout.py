"""SmartLayout — renders a layout template (designed in the Nuxt visual editor)
to one or more aspect ratios via the satori-based /api/render-template endpoint.

Pipeline:
    template_id + aspect + props + brand
        → POST localhost:3000/api/render-template
        → PNG bytes
        → IMAGE tensor

Outputs are returned as a *batch* when every variant shares the same size and
as a *list* when sizes differ — the runtime picks based on the rendered output
shapes so downstream nodes always get the most efficient representation.
"""
from __future__ import annotations

import copy as _copy
import io as _io
import json as _json
import os
import time
import urllib.error
import urllib.request

import numpy as np
import torch
from PIL import Image as PILImage
from typing_extensions import override

import folder_paths
from comfy_api.latest import ComfyExtension, IO
from comfy_extras._live_preview import save_live_preview_multi


# The Comfy backend serves images via /view. Satori fetches images from URLs
# at render time, so we need a *fully-qualified* URL it can reach.
_COMFY_VIEW_ORIGIN = os.environ.get("SAILOR_COMFY_ORIGIN", "http://127.0.0.1:8188")


# Cap on simultaneous text- and image-layer sockets. Each connected socket
# becomes one element in the editor. Most layouts use 1–3 of each; 8 covers
# the long tail without bloating the node body.
_MAX_TEXT_LAYERS = 8
_MAX_IMAGE_LAYERS = 8


def _save_frame_to_view_url(frame: torch.Tensor, role: str) -> str:
    """Save a single [H, W, 3] frame to Comfy's temp dir and return the /view
    URL satori can fetch at render time.
    """
    arr = np.clip(frame.detach().cpu().numpy() * 255.0, 0, 255).astype(np.uint8)
    pil = PILImage.fromarray(arr)
    temp_dir = folder_paths.get_temp_directory()
    os.makedirs(temp_dir, exist_ok=True)
    # Microsecond-suffixed so concurrent renders don't clobber each other.
    fname = f"smartlayout_{role}_{int(time.time() * 1_000_000)}.png"
    pil.save(os.path.join(temp_dir, fname), "PNG", compress_level=1)
    return f"{_COMFY_VIEW_ORIGIN}/view?filename={fname}&type=temp"


def _image_layer_to_url(image: torch.Tensor, role: str) -> str:
    """Save the first frame of an IMAGE tensor and return the /view URL."""
    if image is None:
        return ""
    frame = image[0] if image.dim() == 4 else image
    return _save_frame_to_view_url(frame, role)


# The Nuxt server hosts the renderer. Default to the dev port; can be
# overridden via env for production / hosted setups.
_RENDER_ORIGIN = os.environ.get("SAILOR_RENDER_ORIGIN", "http://127.0.0.1:3002")
_RENDER_PATH = "/api/render-template"


# Built-in format presets: social aspects + the IAB display set. Keys are what
# users type into the `aspects` widget; safeArea reserves platform UI chrome.
_FORMAT_PRESETS = {
    "1x1":     {"w": 1080, "h": 1080, "label": "Square"},
    "4x5":     {"w": 1080, "h": 1350, "label": "Feed portrait"},
    "9x16":    {"w": 1080, "h": 1920, "label": "Story",
                "safeArea": {"top": 270, "bottom": 380}},
    "16x9":    {"w": 1920, "h": 1080, "label": "Wide"},
    "300x250": {"w": 300,  "h": 250,  "label": "MPU"},
    "300x600": {"w": 300,  "h": 600,  "label": "Half page"},
    "728x90":  {"w": 728,  "h": 90,   "label": "Leaderboard"},
    "970x250": {"w": 970,  "h": 250,  "label": "Billboard"},
    "320x50":  {"w": 320,  "h": 50,   "label": "Mobile banner"},
    "160x600": {"w": 160,  "h": 600,  "label": "Skyscraper"},
}

_STARTER_LAYOUT = {
    "version": 2,
    "id": "starter",
    "name": "New Layout",
    "master": "1x1",
    "formats": _FORMAT_PRESETS,
    "grid": {"gutter": 24, "margin": 72, "baseline": 12},
    "typeScale": {"base": 28, "ratio": 1.414},
    "background": {"fill": "#0a0a0a"},
    # Empty by default — text layers get auto-created in the editor as text
    # nodes are wired into the text_layer_<N> sockets.
    "elements": [],
}


def _parse_layout(raw: str) -> dict:
    """Parse the layout JSON the node stores in its widget. Empty / whitespace
    falls back to the starter so a freshly-dropped SmartLayout still renders
    something (an empty dark canvas) instead of erroring out.
    """
    s = (raw or "").strip()
    if not s:
        # Deep-copy: the autopopulate step mutates template["elements"], and a
        # shallow copy would have it share that list with the global _STARTER_LAYOUT,
        # leaking elements from one SmartLayout's render into every later one.
        return _copy.deepcopy(_STARTER_LAYOUT)
    try:
        layout = _json.loads(s)
    except _json.JSONDecodeError as e:
        raise RuntimeError(f"Layout JSON is malformed at line {e.lineno}: {e.msg}") from e
    if not isinstance(layout, dict) or ("aspects" not in layout and "formats" not in layout):
        raise RuntimeError("Layout must be a JSON object with an `aspects` (v1) or `formats` (v2) field.")
    return layout


def _render_one(
    template: dict, aspect_key: str, props: dict, brand: dict,
    output_id: str | None = None,
) -> torch.Tensor:
    """POST one render request, decode the returned PNG into an IMAGE tensor.

    `output_id` selects per-output overrides for v2 templates (variations of the
    same format); None resolves the format's shared layout.
    """
    body = _json.dumps({
        "template": template,
        "aspect": aspect_key,
        "outputId": output_id,
        "props": props,
        "brand": brand,
    }).encode("utf-8")

    req = urllib.request.Request(
        f"{_RENDER_ORIGIN}{_RENDER_PATH}",
        data=body,
        headers={"Content-Type": "application/json", "User-Agent": "Sailor/1.0"},
        method="POST",
    )
    try:
        with urllib.request.urlopen(req, timeout=60) as r:
            png_bytes = r.read()
    except urllib.error.HTTPError as e:
        detail = e.read().decode("utf-8", errors="replace")[:400] if hasattr(e, "read") else ""
        raise RuntimeError(f"Render failed (HTTP {e.code}): {detail}") from e

    pil = PILImage.open(_io.BytesIO(png_bytes)).convert("RGB")
    arr = np.asarray(pil, dtype=np.float32) / 255.0
    return torch.from_numpy(arr)  # [H, W, 3]


def _template_elements(template: dict) -> list:
    """Every element that can reference a layer socket — the ungrouped
    top-level elements plus any section (frame) children (v3)."""
    out = list(template.get("elements") or [])
    for s in (template.get("sections") or []):
        out.extend(s.get("children") or [])
    return out


def _refs_socket(template: dict, key: str) -> bool:
    """True when some element already renders the `props.<key>` socket —
    either by carrying the socket id or by referencing it in its content.
    Used to seed a default element per connected socket exactly once, so a
    layer wired *after* the layout already has elements still shows up."""
    token = "props." + key
    for e in _template_elements(template):
        if e.get("id") == key or token in str(e.get("content", "")):
            return True
    return False


def _autopopulate_elements(template: dict, props: dict) -> None:
    """Inject a default element for every connected layer socket that no
    element references yet, so a wired layer always renders — whether the
    layout was empty or already had other elements (e.g. an image wired into
    a text-only layout). Sockets already placed by the user are left alone.

    Mirrors what the editor's onMounted does on its side — same positions
    so behaviour is consistent whether the user opens the editor first or
    runs straight away.
    """
    template.setdefault("elements", [])
    image_keys = sorted([k for k in props if k.startswith("image_layer_")],
                       key=lambda s: int(s.split("_")[-1]))
    text_keys = sorted([k for k in props if k.startswith("text_layer_")],
                      key=lambda s: int(s.split("_")[-1]))

    # First image fills the canvas as a background; later images sit as
    # smaller corner thumbnails. Mirrors the editor's auto-create defaults so
    # the server-side preview and editor-on-open agree.
    for i, key in enumerate(image_keys):
        if _refs_socket(template, key):
            continue
        idx = i + 1
        if idx == 1:
            template["elements"].append({
                "id": key,
                "type": "image",
                "role": f"IMAGE_LAYER_{idx}",
                "anchor": "top-left",
                "offset": {"x": 0, "y": 0},
                "size": {"w": "100%", "h": "100%"},
                "style": {"fit": "cover", "borderRadius": 0},
                "content": "{{ props." + key + " }}",
            })
        else:
            template["elements"].append({
                "id": key,
                "type": "image",
                "role": f"IMAGE_LAYER_{idx}",
                "anchor": "top-right",
                "offset": {"x": "4%", "y": f"{4 + (idx - 2) * 14}%"},
                "size": {"w": "20%", "h": "12%"},
                "style": {"fit": "cover", "borderRadius": 12},
                "content": "{{ props." + key + " }}",
            })

    # Text stacks on the bottom half: y = 58% + (i * 12%)
    for i, key in enumerate(text_keys):
        if _refs_socket(template, key):
            continue
        idx = i + 1
        template["elements"].append({
            "id": key,
            "type": "text",
            "role": f"TEXT_LAYER_{idx}",
            "anchor": "top-center",
            "offset": {"x": 0, "y": f"{58 + (idx - 1) * 12}%"},
            "size": {"w": "84%", "h": "auto"},
            "style": {
                "fontFamily": "Inter",
                "fontSize": 72 if idx == 1 else 44,
                "fontWeight": 700 if idx == 1 else 400,
                "color": "#ffffff",
                "align": "center",
                "lineHeight": 1.1,
            },
            "content": "{{ props." + key + " }}",
        })


def _autopopulate_elements_v2(template: dict, props: dict) -> None:
    """v2/v3 twin of _autopopulate_elements: grid regions instead of anchors.
    Strip/skyscraper placement comes from the resolver's default class
    layouts, so only master regions are needed here. Priorities follow the
    spec: headline 1, CTA 2, logo 3, hero 4, subhead 5.

    Seeds a default element per connected socket that no element references
    yet — so a layer wired after the layout already has content still renders.
    """
    template.setdefault("elements", [])
    image_keys = sorted([k for k in props if k.startswith("image_layer_")],
                       key=lambda s: int(s.split("_")[-1]))
    text_keys = sorted([k for k in props if k.startswith("text_layer_")],
                      key=lambda s: int(s.split("_")[-1]))

    for i, key in enumerate(image_keys):
        if _refs_socket(template, key):
            continue
        idx = i + 1
        if idx == 1:
            # First image = full-bleed background: spans the whole grid, bleeds
            # to the canvas edges, and sits at the BACK of the z-order (front of
            # the list / order) so it reads as the backdrop behind the text.
            g = template.get("grid") or {}
            cols = g.get("columns") if isinstance(g.get("columns"), int) and g["columns"] > 0 else 9999
            rows = g.get("rows") if isinstance(g.get("rows"), int) and g["rows"] > 0 else 9999
            template["elements"].insert(0, {
                "id": key, "type": "image", "role": f"IMAGE_LAYER_{idx}", "priority": 4,
                "region": {"col": 1, "colSpan": cols, "row": 1, "rowSpan": rows},
                "bleed": True,
                "focal": {"x": 0.5, "y": 0.5},
                "style": {"fit": "cover"},
                "content": "{{ props." + key + " }}",
            })
            # Keep it back-most in an explicit z-order too, if the layout uses one.
            order = template.get("order")
            if isinstance(order, list) and key not in order:
                order.insert(0, key)
        else:
            template["elements"].append({
                "id": key, "type": "image", "role": f"IMAGE_LAYER_{idx}", "priority": 5 + idx,
                "region": {"col": 6, "colSpan": 1, "row": min(6, idx - 1), "rowSpan": 1},
                "collapse": "mark",
                "style": {"fit": "cover"},
                "content": "{{ props." + key + " }}",
            })

    for i, key in enumerate(text_keys):
        if _refs_socket(template, key):
            continue
        idx = i + 1
        if idx == 1:
            template["elements"].append({
                "id": key, "type": "text", "role": f"TEXT_LAYER_{idx}", "priority": 1,
                "level": "display",
                "region": {"col": 1, "colSpan": 6, "row": 4, "rowSpan": 2},
                "overflow": "shrink-then-truncate",
                "style": {"fontWeight": 700, "color": "#ffffff"},
                "content": "{{ props." + key + " }}",
            })
        else:
            template["elements"].append({
                "id": key, "type": "text", "role": f"TEXT_LAYER_{idx}", "priority": 5,
                "level": "subhead",
                "region": {"col": 1, "colSpan": 4, "row": 6, "rowSpan": 1},
                "style": {"color": "#ffffff"},
                "content": "{{ props." + key + " }}",
            })


def _autopopulate_for_template(template: dict, props: dict) -> None:
    """Route to the right seeder by template version. v2 AND v3 use grid
    regions (the v3 resolver has no anchor/offset path — seeding v1-style
    elements into a v3 layout would not render); only the legacy v1 anchor
    templates use the anchor seeder."""
    if template.get("version") in (2, 3):
        _autopopulate_elements_v2(template, props)
    else:
        _autopopulate_elements(template, props)


def _parse_aspects(aspects_str: str, template: dict) -> list[str]:
    """Comma-separated format keys; empty falls back to the template default."""
    defined = template.get("formats") or template.get("aspects") or {}
    keys = [k.strip() for k in aspects_str.split(",") if k.strip()]
    if not keys:
        default = template.get("master") or template.get("defaultAspect") or next(iter(defined), None)
        if not default:
            raise RuntimeError("Template has no formats defined.")
        return [default]
    bad = [k for k in keys if k not in defined]
    if bad:
        raise RuntimeError(f"Unknown format(s) {bad}. Template defines: {sorted(defined)}")
    return keys


def _resolve_outputs(template: dict, aspects_str: str) -> list[dict]:
    """The deliverables to render. Uses the template's explicit `outputs` list
    (chosen in the editor, repeatable per format for variations); falls back to
    one output per `aspects` key (id === format) for pre-outputs templates.
    Mirrors deriveOutputs() in shared/template-grid/resolve.ts."""
    outs = template.get("outputs")
    if isinstance(outs, list):
        clean = [o for o in outs if isinstance(o, dict) and o.get("format")]
        if clean:
            return clean
    formats = template.get("formats") or {}
    return [
        {"id": k, "format": k, "label": (formats.get(k) or {}).get("label")}
        for k in _parse_aspects(aspects_str, template)
    ]


def _output_labels(outputs: list[dict], template: dict) -> list[str]:
    """Display/file labels for the node preview carousel, de-duplicated so two
    variations of the same format don't clobber each other's download name."""
    formats = template.get("formats") or {}
    labels: list[str] = []
    seen: dict[str, int] = {}
    for o in outputs:
        base = o.get("label") or (formats.get(o["format"]) or {}).get("label") or o["format"]
        n = seen.get(base, 0) + 1
        seen[base] = n
        labels.append(base if n == 1 else f"{base} {n}")
    return labels


def _parse_text_layers(text: str, *, default_role: str = "headline") -> dict[str, str]:
    """Parse multiline text-layer overrides for SmartLayout.

    The strict form is `key=value` per line. We also accept a friendlier "just
    type something" path: if the input has no `=` anywhere, the whole blob is
    used as the value for `default_role` (typically `headline`). That matches
    user intuition — wiring a Text node with "Spring drop" into text_layers
    fills the layout's headline, no schema lesson required.

    `# comment` lines and blanks are ignored. Lines without `=` in an
    otherwise key=value document are skipped (data hygiene).
    """
    raw = (text or "").strip()
    if not raw:
        return {}
    # Friendly path: no `=` anywhere → treat the whole input as one role value.
    if "=" not in raw:
        return {default_role: raw}
    out: dict[str, str] = {}
    for line in raw.splitlines():
        s = line.strip()
        if not s or s.startswith("#"):
            continue
        if "=" not in s:
            continue
        k, v = s.split("=", 1)
        out[k.strip()] = v.strip()
    return out


# Back-compat alias for the brand input which still uses strict key=value
# semantics (no sensible "default role" for a brand-kit blob).
_parse_kv = _parse_text_layers


class SmartLayoutNode(IO.ComfyNode):
    """Render a layout across one or more aspect ratios.

    The layout JSON lives in this node's `layout` widget. Users edit it via
    the visual editor (the "Edit layout" button on the node body opens the
    modal). The JSON ships with the workflow so there's no out-of-band file
    dependency.
    """

    @classmethod
    def define_schema(cls):
        return IO.Schema(
            node_id="SmartLayout",
            display_name="Smart Layout",
            description="Compose a layout visually, render it across any aspect ratios. "
                        "Edit on the canvas via the 'Edit layout' button.",
            category="image",
            inputs=[
                IO.String.Input(
                    "layout",
                    default="",
                    multiline=True,
                    tooltip="The layout's full JSON. You normally edit this through the visual editor, "
                            "but you can also paste/inspect it here directly.",
                ),
                IO.String.Input(
                    "aspects",
                    default="1x1,9x16,16x9",
                    tooltip="Comma-separated aspect keys to render. Must exist on the layout. "
                            "Leave empty to use the layout's default.",
                ),
                # Non-grow input goes first — `brand` is a single STRING that
                # always shows. The two grow groups below (image_layer_*,
                # text_layer_*) each expose one open slot + grow on connect.
                IO.String.Input(
                    "brand",
                    default="",
                    multiline=True,
                    optional=True,
                    force_input=True,
                    tooltip="Brand-kit substitutions for the layout's `{{ brand.x }}` placeholders "
                            "(colors, fonts, logo URL, …). Wire from a BrandKit node (Stage 2) or any "
                            "STRING source. One key=value per line.",
                ),
                # image_layer_1..N: one socket per image layer. Wire any
                # IMAGE source per layer. We auto-save each to Comfy's temp
                # dir; the editor creates one image element per connection.
                *[
                    IO.Image.Input(
                        f"image_layer_{i}",
                        optional=True,
                        tooltip=f"Image layer {i}. Wire any IMAGE source (LoadImage, an upstream gen, …). "
                                "Each connected layer becomes a separate image element you can position "
                                "in the editor.",
                    )
                    for i in range(1, _MAX_IMAGE_LAYERS + 1)
                ],
                # text_layer_1..N: one socket per text layer. Wire a Text node
                # (or any STRING source) per layer.
                *[
                    IO.String.Input(
                        f"text_layer_{i}",
                        default="",
                        multiline=True,
                        optional=True,
                        force_input=True,
                        tooltip=f"Text layer {i}. Wire a Text node (or any STRING source) here — "
                                "each connected layer becomes a separate text element you can "
                                "position in the editor.",
                    )
                    for i in range(1, _MAX_TEXT_LAYERS + 1)
                ],
                # Appended LAST so saved workflows' widget positions don't
                # shift (the file's append-only convention). The project's
                # active brand-library kit, injected at submit by the frontend
                # (injectSmartLayoutBrand) as key=value lines. A wired `brand`
                # socket overrides these per-key — the kit folds UNDER it.
                IO.String.Input(
                    "brand_kit",
                    default="",
                    multiline=True,
                    optional=True,
                    tooltip="Project brand kit (auto-injected from the active brand library kit). "
                            "Values from a wired `brand` input override these per-key.",
                ),
            ],
            outputs=[
                # `is_output_list=True` so each rendered aspect flows downstream
                # as its own item — SaveImage iterates over the list, writing one
                # file per aspect. This is the only way mixed-size aspects (1x1 +
                # 9x16, etc.) can survive into a downstream IMAGE socket; the
                # IMAGE type itself is a uniform tensor and can't pack different
                # H×W in one batch.
                IO.Image.Output(display_name="images", is_output_list=True),
            ],
            # `is_output_node` + `unique_id` are what let us push a live preview
            # back onto the SmartLayout node body — the canvas displays the
            # first rendered aspect inline so the user sees the result without
            # having to wire SaveImage / PreviewImage downstream.
            hidden=[IO.Hidden.unique_id],
            is_output_node=True,
        )

    @classmethod
    def execute(cls, layout, aspects, brand=None, brand_kit=None, **layer_kwargs) -> IO.NodeOutput:
        template = _parse_layout(layout)
        # Collect text_layer_<N> + image_layer_<N> kwargs. Each becomes a
        # `{{ props.<key> }}` substitution. Unconnected slots come in as
        # None and are skipped.
        props_d: dict[str, str] = {}
        for key, value in layer_kwargs.items():
            if value is None:
                continue
            if key.startswith("text_layer_"):
                if str(value).strip():
                    props_d[key] = str(value)
            elif key.startswith("image_layer_"):
                # IMAGE tensor: save to temp dir + use the resulting URL.
                url = _image_layer_to_url(value, key)
                if url:
                    props_d[key] = url
        # Brand merge order: template defaults (translate-side) ← project kit
        # (brand_kit, injected at submit) ← wired brand socket. The kit parses
        # STRICTLY (k=v lines only — no friendly whole-blob fallback, it's
        # machine-written), then wired values override per-key.
        kit_d: dict[str, str] = {}
        for line in (brand_kit or "").splitlines():
            s = line.strip()
            if not s or s.startswith("#") or "=" not in s:
                continue
            k, v = s.split("=", 1)
            if k.strip() and v.strip():
                kit_d[k.strip()] = v.strip()
        brand_d = {**kit_d, **_parse_kv(brand or "")}

        # Inject a default element for any connected layer socket that no
        # element references yet — so a wired layer always renders, whether the
        # layout is empty or already has content (e.g. an image wired into a
        # text-only layout).
        _autopopulate_for_template(template, props_d)

        # The chosen deliverables: the template's `outputs` (editor-picked,
        # repeatable per format for variations) or one per `aspects` key.
        outputs = _resolve_outputs(template, aspects)
        rendered: list[torch.Tensor] = []
        for o in outputs:
            rendered.append(_render_one(template, o["format"], props_d, brand_d, o.get("id")))

        # Push *all* rendered outputs to the node-body preview so the frontend
        # can show a carousel. Label each file by its output name (variation-
        # unique) so the download buttons read something the user recognises.
        labels = _output_labels(outputs, template)
        preview_ui = save_live_preview_multi(
            [t.unsqueeze(0) for t in rendered],
            str(cls.hidden.unique_id),
            labels=labels,
        )

        # Always emit as a list (one [1, H, W, 3] tensor per output). Paired
        # with `is_output_list=True` on the schema, a downstream SaveImage saves
        # one file per output — mixed sizes Just Work because each item travels
        # through the socket independently.
        return IO.NodeOutput([t.unsqueeze(0) for t in rendered], ui=preview_ui)


class SmartLayoutExtension(ComfyExtension):
    @override
    async def get_node_list(self) -> list[type[IO.ComfyNode]]:
        return [SmartLayoutNode]


async def comfy_entrypoint() -> SmartLayoutExtension:
    return SmartLayoutExtension()
