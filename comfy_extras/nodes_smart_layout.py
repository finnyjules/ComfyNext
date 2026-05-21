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
from comfy_extras._live_preview import save_live_preview


# The Comfy backend serves images via /view. Satori fetches images from URLs
# at render time, so we need a *fully-qualified* URL it can reach.
_COMFY_VIEW_ORIGIN = os.environ.get("COMFYNEXT_COMFY_ORIGIN", "http://127.0.0.1:8188")


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
_RENDER_ORIGIN = os.environ.get("COMFYNEXT_RENDER_ORIGIN", "http://127.0.0.1:3002")
_RENDER_PATH = "/api/render-template"


_STARTER_LAYOUT = {
    "version": 1,
    "id": "starter",
    "name": "New Layout",
    "aspects": {
        "1x1":  {"w": 1080, "h": 1080, "label": "Square"},
        "9x16": {"w": 1080, "h": 1920, "label": "Vertical"},
        "16x9": {"w": 1920, "h": 1080, "label": "Horizontal"},
    },
    "defaultAspect": "1x1",
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
    if not isinstance(layout, dict) or "aspects" not in layout:
        raise RuntimeError("Layout must be a JSON object with at least an `aspects` field.")
    return layout


def _render_one(template: dict, aspect_key: str, props: dict, brand: dict) -> torch.Tensor:
    """POST one render request, decode the returned PNG into an IMAGE tensor."""
    body = _json.dumps({
        "template": template,
        "aspect": aspect_key,
        "props": props,
        "brand": brand,
    }).encode("utf-8")

    req = urllib.request.Request(
        f"{_RENDER_ORIGIN}{_RENDER_PATH}",
        data=body,
        headers={"Content-Type": "application/json", "User-Agent": "ComfyNext/1.0"},
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


def _autopopulate_elements(template: dict, props: dict) -> None:
    """If the template ships with no elements but layers are connected,
    inject default elements per connected layer so the first render shows
    something instead of an empty canvas.

    Mirrors what the editor's onMounted does on its side — same positions
    so behaviour is consistent whether the user opens the editor first or
    runs straight away.
    """
    if template.get("elements"):
        return
    existing_ids = {e.get("id") for e in template["elements"]}
    image_keys = sorted([k for k in props if k.startswith("image_layer_")],
                       key=lambda s: int(s.split("_")[-1]))
    text_keys = sorted([k for k in props if k.startswith("text_layer_")],
                      key=lambda s: int(s.split("_")[-1]))

    # First image fills the canvas as a background; later images sit as
    # smaller corner thumbnails. Mirrors the editor's auto-create defaults so
    # the server-side preview and editor-on-open agree.
    for i, key in enumerate(image_keys):
        if key in existing_ids:
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
        if key in existing_ids:
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


def _parse_aspects(aspects_str: str, template: dict) -> list[str]:
    """Comma-separated aspect keys; empty falls back to default or first."""
    keys = [k.strip() for k in aspects_str.split(",") if k.strip()]
    if not keys:
        default = template.get("defaultAspect") or next(iter(template.get("aspects", {})), None)
        if not default:
            raise RuntimeError(f"Template has no aspects defined.")
        return [default]
    valid = set(template.get("aspects", {}).keys())
    bad = [k for k in keys if k not in valid]
    if bad:
        raise RuntimeError(f"Unknown aspect(s) {bad}. Template defines: {sorted(valid)}")
    return keys


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
            ],
            outputs=[
                IO.Image.Output(display_name="images"),
            ],
            # `is_output_node` + `unique_id` are what let us push a live preview
            # back onto the SmartLayout node body — the canvas displays the
            # first rendered aspect inline so the user sees the result without
            # having to wire SaveImage / PreviewImage downstream.
            hidden=[IO.Hidden.unique_id],
            is_output_node=True,
        )

    @classmethod
    def execute(cls, layout, aspects, brand=None, **layer_kwargs) -> IO.NodeOutput:
        template = _parse_layout(layout)
        aspect_keys = _parse_aspects(aspects, template)
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
        brand_d = _parse_kv(brand or "")

        # If the user hasn't opened the editor yet, the layout has no elements.
        # Inject defaults for any connected layer sockets so the preview shows
        # something meaningful instead of an empty canvas.
        _autopopulate_elements(template, props_d)

        rendered: list[torch.Tensor] = []
        for key in aspect_keys:
            rendered.append(_render_one(template, key, props_d, brand_d))

        # Inline preview on the node body. We push the first rendered aspect —
        # save_live_preview writes to a deterministic temp filename keyed by
        # node id so the Vue canvas can refetch with a cache-buster.
        preview_ui = save_live_preview(rendered[0].unsqueeze(0), str(cls.hidden.unique_id))

        # If every aspect produced the same H×W we can stack as a batch tensor,
        # which is faster for downstream consumers. Otherwise return as a list
        # so heterogeneous sizes survive intact.
        same_shape = all(t.shape == rendered[0].shape for t in rendered)
        if same_shape:
            return IO.NodeOutput(torch.stack(rendered, dim=0), ui=preview_ui)
        return IO.NodeOutput(rendered, ui=preview_ui)


class SmartLayoutExtension(ComfyExtension):
    @override
    async def get_node_list(self) -> list[type[IO.ComfyNode]]:
        return [SmartLayoutNode]


async def comfy_entrypoint() -> SmartLayoutExtension:
    return SmartLayoutExtension()
