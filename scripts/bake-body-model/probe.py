"""
Anny transfer probe (body-reference-builder Task 1).

Proves whether nano-banana follows a grey parametric figure's proportions
before we build a Body editor on top of Anny. See:
docs/superpowers/specs/2026-08-13-body-probe/ (committed outputs) and
.superpowers/sdd/task-1-brief.md (the plan this script implements).

Steps:
  1. Instantiate Anny on a license-safe topology and dump phenotype_labels.
  2. Write the 8-slider -> phenotype/local-change mapping table.
  3. Render a default figure and a deliberately extreme (short + broad)
     figure, front and back, grey material on plain background.
  4. Fetch Jene's portrait from the local dev server and run 3 paid
     nano-banana calls: control, default-ref, extreme-ref.
  5. Composite everything into a labeled contact sheet.

Run with: ./venv/bin/python probe.py
"""

from __future__ import annotations

import base64
import json
import time
import urllib.request
import urllib.error
from pathlib import Path

import numpy as np
import pyrender
import torch
import trimesh
from PIL import Image, ImageDraw, ImageFont

import anny

HERE = Path(__file__).resolve().parent
OUT = HERE / "out"
OUT.mkdir(exist_ok=True)

DEV_SERVER = "http://127.0.0.1:3000"  # NEVER localhost — see CLAUDE.md / project memory
CHARACTER_SLUG = "jene"

RENDER_W, RENDER_H = 768, 1024
GREY = [160, 160, 160, 255]

# The 8 Body-editor slider ids this probe is scouting phenotype names for.
SLIDER_IDS = ["frame", "height", "build", "muscle", "shoulders", "chest", "waist", "hips"]


# ---------------------------------------------------------------------------
# Step 2: model + phenotype listing
# ---------------------------------------------------------------------------


def build_model() -> anny.Anny:
    # LICENSE GUARD: topology="anny" resolves (see anny/models/model_data.py
    # _parse_topology_spec) to TopologyConfig(base_mesh="makehuman", ...).
    # "makehuman" base_mesh pulls anny/data/mpfb2/*, which the installed
    # package's own LICENSE/README states is CC0 1.0 Universal (MakeHuman
    # assets adapted from MPFB2). This is NOT the "smplx"/"smpl" alternative
    # topology, which anny's README explicitly gates to a separate
    # non-commercial-only download (noncommercial.zip) — we never request
    # that topology anywhere in this script.
    return anny.Anny(topology="anny", local_changes="all")


def write_phenotype_listing(model: anny.Anny) -> None:
    lines = []
    lines.append("Anny transfer probe — phenotype_labels dump")
    lines.append("")
    lines.append("Topology: 'anny' spec -> base_mesh='makehuman' (CC0 1.0 Universal,")
    lines.append("MPFB2/MakeHuman assets — see venv/.../anny/README.md 'License' section).")
    lines.append("NOT smplx/smpl (those require a separate non-commercial license and")
    lines.append("were never instantiated in this script).")
    lines.append("")
    lines.append(f"phenotype_labels ({len(model.phenotype_labels)}):")
    for label in model.phenotype_labels:
        lines.append(f"  - {label}")
    lines.append("")
    lines.append(
        f"local_change_labels ({len(model.local_change_labels)}) — MakeHuman/MPFB2-style"
    )
    lines.append("morph targets, used for the regional sliders (shoulders/chest/waist/hips):")
    for label in model.local_change_labels:
        lines.append(f"  - {label}")
    (OUT / "phenotypes.txt").write_text("\n".join(lines) + "\n")
    print(f"wrote {OUT / 'phenotypes.txt'} ({len(model.phenotype_labels)} phenotypes, "
          f"{len(model.local_change_labels)} local changes)")


# ---------------------------------------------------------------------------
# Slider -> phenotype/local-change mapping (locked, written to slider-mapping.md)
# ---------------------------------------------------------------------------

SLIDER_MAPPING = [
    (
        "frame",
        "gender (phenotype, global)",
        "No dedicated broad/narrow skeletal-frame axis exists. `gender` is the "
        "nearest global phenotype that shifts overall frame proportions "
        "(shoulder-to-hip skeletal bias). Weakest mapping of the 8 — honest "
        "caveat: this is a proxy, not a true frame dial.",
    ),
    (
        "height",
        "height (phenotype, global)",
        "Direct 1:1 match — Anny ships a dedicated height phenotype.",
    ),
    (
        "build",
        "weight (phenotype, global)",
        "Direct match for overall adiposity/build; MakeHuman-lineage models "
        "call this axis 'weight'.",
    ),
    (
        "muscle",
        "muscle (phenotype, global)",
        "Direct 1:1 match — dedicated muscle phenotype.",
    ),
    (
        "shoulders",
        "measure-shoulder-dist-incr (local change)",
        "Direct MakeHuman/MPFB2 measurement target for shoulder width.",
    ),
    (
        "chest",
        "measure-frontchest-dist-incr (local change)",
        "Direct chest-depth measurement target. (measure-bust-circ-incr also "
        "exists but is more female-anatomy-specific; frontchest-dist is the "
        "general-purpose one.)",
    ),
    (
        "waist",
        "measure-waist-circ-incr (local change)",
        "Direct waist-circumference measurement target.",
    ),
    (
        "hips",
        "measure-hips-circ-incr (local change)",
        "Direct hip-circumference measurement target.",
    ),
]


def write_slider_mapping() -> None:
    lines = ["# Slider -> Anny phenotype/local-change mapping", ""]
    lines.append(
        "8 Body-editor slider ids mapped to the nearest real Anny phenotype "
        "(global, `model(phenotype_kwargs=...)`) or local-change morph target "
        "(regional, `model(local_changes_kwargs=...)`). Source: "
        "`out/phenotypes.txt`, generated by this same run."
    )
    lines.append("")
    lines.append("| slider id | mapped to | justification |")
    lines.append("|---|---|---|")
    for slider, target, justification in SLIDER_MAPPING:
        lines.append(f"| `{slider}` | `{target}` | {justification} |")
    lines.append("")
    lines.append(
        "All 8 sliders found a plausible mapping. `frame` is the one honest "
        "weak spot — no independent frame/broadness phenotype exists, so it "
        "rides on `gender` as a proxy."
    )
    (OUT / "slider-mapping.md").write_text("\n".join(lines) + "\n")
    print(f"wrote {OUT / 'slider-mapping.md'}")


# ---------------------------------------------------------------------------
# Step 3: render two figures, front + back
# ---------------------------------------------------------------------------


def look_at(eye: np.ndarray, target: np.ndarray, world_up=np.array([0.0, 0.0, 1.0])) -> np.ndarray:
    eye = np.asarray(eye, dtype=float)
    target = np.asarray(target, dtype=float)
    back = eye - target
    back /= np.linalg.norm(back)
    right = np.cross(world_up, back)
    right /= np.linalg.norm(right)
    true_up = np.cross(back, right)
    pose = np.eye(4)
    pose[:3, 0] = right
    pose[:3, 1] = true_up
    pose[:3, 2] = back
    pose[:3, 3] = eye
    return pose


def mesh_from_model(model: anny.Anny, phenotype_kwargs, local_changes_kwargs) -> trimesh.Trimesh:
    out = model(phenotype_kwargs=phenotype_kwargs, local_changes_kwargs=local_changes_kwargs)
    vertices = out["vertices"].squeeze(0).detach().numpy()
    faces = model.faces.detach().numpy()
    mesh = trimesh.Trimesh(vertices=vertices, faces=faces, process=False)
    mesh.visual.vertex_colors = np.tile(GREY, (len(vertices), 1))
    return mesh


def render_pair(mesh: trimesh.Trimesh, name: str) -> tuple[Path, Path]:
    """Render front (face points toward -Y, verified via nose vertex probe)
    and back views. Renderer: pyrender OffscreenRenderer (pyglet-backed GL
    context) — worked directly on this macOS box, no OSMesa/EGL fallback
    needed. Orthographic camera for undistorted proportion comparison."""
    scene = pyrender.Scene(bg_color=[255, 255, 255, 255], ambient_light=[0.6, 0.6, 0.6])
    scene.add(pyrender.Mesh.from_trimesh(mesh, smooth=True))

    bounds = mesh.bounds
    center = mesh.centroid
    size = bounds[1] - bounds[0]

    cam = pyrender.OrthographicCamera(xmag=size[0] * 0.9 + 0.15, ymag=size[2] * 0.6 + 0.2)
    cam_node = scene.add(cam, pose=np.eye(4))
    light = pyrender.DirectionalLight(color=[1, 1, 1], intensity=4.0)
    light_node = scene.add(light, pose=np.eye(4))

    renderer = pyrender.OffscreenRenderer(viewport_width=RENDER_W, viewport_height=RENDER_H)

    paths = []
    for label, eye_offset in [("front", np.array([0, -2.0, 0])), ("back", np.array([0, 2.0, 0]))]:
        pose = look_at(center + eye_offset, center)
        scene.set_pose(cam_node, pose)
        scene.set_pose(light_node, pose)
        color, _ = renderer.render(scene)
        path = OUT / f"figure-{name}-{label}.png"
        Image.fromarray(color).save(path)
        paths.append(path)
        print(f"rendered {path}")

    renderer.delete()
    return tuple(paths)  # type: ignore[return-value]


def render_figures(model: anny.Anny):
    # Default: all phenotypes at their documented default (0.5), no local changes.
    default_mesh = mesh_from_model(model, phenotype_kwargs=None, local_changes_kwargs=None)
    default_front, default_back = render_pair(default_mesh, "default")

    # Extreme: Build (weight) + Shoulders near max, Height near min.
    # Deliberately short + broad — far from Jene's actual proportions.
    extreme_mesh = mesh_from_model(
        model,
        phenotype_kwargs={"weight": 1.0, "height": 0.0},
        local_changes_kwargs={"measure-shoulder-dist-incr": 1.0},
    )
    extreme_front, extreme_back = render_pair(extreme_mesh, "extreme")

    return default_front, default_back, extreme_front, extreme_back


# ---------------------------------------------------------------------------
# Step 4: the 3 paid nano-banana calls
# ---------------------------------------------------------------------------


def http_get_json(url: str) -> dict:
    with urllib.request.urlopen(url, timeout=30) as resp:
        return json.loads(resp.read().decode("utf-8"))


def http_get_bytes(url: str) -> bytes:
    with urllib.request.urlopen(url, timeout=30) as resp:
        return resp.read()


def http_post_json(url: str, payload: dict, timeout: int = 180) -> dict:
    data = json.dumps(payload).encode("utf-8")
    req = urllib.request.Request(
        url, data=data, headers={"Content-Type": "application/json"}, method="POST"
    )
    with urllib.request.urlopen(req, timeout=timeout) as resp:
        return json.loads(resp.read().decode("utf-8"))


def fetch_portrait_data_url() -> str:
    # Actual shape (verified against the live dev server before spending):
    # {"characters": [{"slug": "jene", "states": [{"id": "default",
    #   "panels": [{"slot": "portrait", "filename": "..."}, ...]}]}]}
    response = http_get_json(f"{DEV_SERVER}/api/characters-local")
    char_list = response["characters"] if isinstance(response, dict) else response
    jene = next((c for c in char_list if c.get("slug") == CHARACTER_SLUG), None)
    if jene is None:
        raise RuntimeError(f"character '{CHARACTER_SLUG}' not found in /api/characters-local")

    default_state = next((s for s in jene.get("states", []) if s.get("id") == "default"), None)
    if default_state is None:
        raise RuntimeError(f"no 'default' state for '{CHARACTER_SLUG}': states={jene.get('states')}")

    panels = default_state.get("panels") or []
    portrait = next((p for p in panels if p.get("slot") == "portrait"), None)
    if portrait is None:
        raise RuntimeError(f"no 'portrait' slot in panels: {panels}")
    filename = portrait.get("filename")
    if not filename:
        raise RuntimeError(f"portrait entry has no filename: {portrait}")

    img_bytes = http_get_bytes(f"{DEV_SERVER}/view?filename={filename}&type=input")
    b64 = base64.b64encode(img_bytes).decode("ascii")
    ext = filename.rsplit(".", 1)[-1].lower()
    mime = "image/png" if ext == "png" else "image/jpeg"
    return f"data:{mime};base64,{b64}"


def image_to_data_url(path: Path) -> str:
    b64 = base64.b64encode(path.read_bytes()).decode("ascii")
    return f"data:image/png;base64,{b64}"


BODY_FRONT_PROMPT = (
    "Show the same person as a full-body figure from the front, standing "
    "naturally with arms relaxed, framed strictly from the shoulders down — "
    "the head, face and hair are entirely outside the top edge of the frame, "
    "no head visible. Keep the exact same wardrobe and body type. Plain "
    "neutral grey studio background, even soft light, photorealistic."
)
REF_SUFFIX = " Match the body proportions of the grey reference figure in the second image."


def nano_gen(prompt: str, images: list[str], label: str, retries: int = 1) -> Path | None:
    # POST /api/inpaint/nano-gen -> { images: [dataUrlString], model: string }
    # (verified against frontend/server/api/inpaint/nano-gen.post.ts before spending).
    payload = {"prompt": prompt, "images": images, "aspect_ratio": "3:4"}
    for attempt in range(retries + 1):
        try:
            result = http_post_json(f"{DEV_SERVER}/api/inpaint/nano-gen", payload)
            out_images = result.get("images")
            if not out_images:
                raise RuntimeError(f"unrecognized response shape: {list(result.keys())}")
            out_url = out_images[0]
            if out_url.startswith("data:"):
                b64 = out_url.split(",", 1)[1]
                img_bytes = base64.b64decode(b64)
            else:
                full = out_url if out_url.startswith("http") else f"{DEV_SERVER}{out_url}"
                img_bytes = http_get_bytes(full)
            path = OUT / f"gen-{label}.png"
            path.write_bytes(img_bytes)
            print(f"[{label}] saved -> {path} (model={result.get('model')})")
            return path
        except (urllib.error.URLError, urllib.error.HTTPError, RuntimeError, TimeoutError) as exc:
            print(f"[{label}] attempt {attempt + 1} failed: {exc}")
            if attempt < retries:
                time.sleep(3)
                continue
            print(f"[{label}] giving up after {attempt + 1} attempt(s) — STOPPING, not burning more money.")
            return None
    return None


def run_generations(portrait_url: str, default_front: Path, extreme_front: Path):
    default_front_url = image_to_data_url(default_front)
    extreme_front_url = image_to_data_url(extreme_front)

    results = {}
    results["control"] = nano_gen(BODY_FRONT_PROMPT, [portrait_url], "control")
    if results["control"] is None:
        print("control call failed after retry — stopping before spending more.")
        return results

    results["default-ref"] = nano_gen(
        BODY_FRONT_PROMPT + REF_SUFFIX, [portrait_url, default_front_url], "default-ref"
    )
    if results["default-ref"] is None:
        print("default-ref call failed after retry — stopping before spending more.")
        return results

    results["extreme-ref"] = nano_gen(
        BODY_FRONT_PROMPT + REF_SUFFIX, [portrait_url, extreme_front_url], "extreme-ref"
    )
    return results


# ---------------------------------------------------------------------------
# Contact sheet
# ---------------------------------------------------------------------------


def label_image(img: Image.Image, text: str) -> Image.Image:
    canvas = Image.new("RGB", (img.width, img.height + 28), "white")
    canvas.paste(img.convert("RGB"), (0, 28))
    draw = ImageDraw.Draw(canvas)
    try:
        font = ImageFont.load_default()
    except Exception:
        font = None
    draw.text((6, 6), text, fill="black", font=font)
    return canvas


def build_contact_sheet(
    portrait_path_bytes: bytes,
    default_front: Path,
    extreme_front: Path,
    gen_results: dict[str, Path | None],
) -> None:
    cell_w, cell_h = 300, 400

    def load(pathlike, from_bytes=False) -> Image.Image:
        img = Image.open(pathlike) if not from_bytes else Image.open(__import__("io").BytesIO(pathlike))
        img = img.convert("RGB")
        img.thumbnail((cell_w, cell_h))
        bg = Image.new("RGB", (cell_w, cell_h), "white")
        bg.paste(img, ((cell_w - img.width) // 2, (cell_h - img.height) // 2))
        return bg

    row1 = [
        (load(portrait_path_bytes, from_bytes=True), "portrait (input)"),
        (load(default_front), "default figure"),
        (load(extreme_front), "extreme figure"),
    ]
    row2 = [
        (
            load(gen_results["control"]) if gen_results.get("control") else Image.new("RGB", (cell_w, cell_h), "grey"),
            "control (no ref)",
        ),
        (
            load(gen_results["default-ref"]) if gen_results.get("default-ref") else Image.new("RGB", (cell_w, cell_h), "grey"),
            "default-ref",
        ),
        (
            load(gen_results["extreme-ref"]) if gen_results.get("extreme-ref") else Image.new("RGB", (cell_w, cell_h), "grey"),
            "extreme-ref",
        ),
    ]

    label_h = 28
    sheet = Image.new("RGB", (cell_w * 3, (cell_h + label_h) * 2), "white")
    draw = ImageDraw.Draw(sheet)
    font = ImageFont.load_default()
    for row_idx, row in enumerate([row1, row2]):
        for col_idx, (img, caption) in enumerate(row):
            x = col_idx * cell_w
            y = row_idx * (cell_h + label_h)
            draw.text((x + 6, y + 4), caption, fill="black", font=font)
            sheet.paste(img, (x, y + label_h))

    path = OUT / "probe-contact-sheet.png"
    sheet.save(path)
    print(f"wrote {path}")


# ---------------------------------------------------------------------------
# Main
# ---------------------------------------------------------------------------


def main() -> None:
    print("== Step 2: model + phenotype listing ==")
    model = build_model()
    write_phenotype_listing(model)
    write_slider_mapping()

    print("== Step 3: render default + extreme figures ==")
    default_front, default_back, extreme_front, extreme_back = render_figures(model)

    print("== Step 4: paid nano-banana calls (~$0.40, 3 calls) ==")
    portrait_url = fetch_portrait_data_url()
    portrait_bytes = base64.b64decode(portrait_url.split(",", 1)[1])
    gen_results = run_generations(portrait_url, default_front, extreme_front)

    print("== Contact sheet ==")
    build_contact_sheet(portrait_bytes, default_front, extreme_front, gen_results)

    print("done. See out/ for all artifacts.")


if __name__ == "__main__":
    main()
