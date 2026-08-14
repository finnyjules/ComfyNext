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
REPO_ROOT = HERE.parent.parent
OUT = HERE / "out"
OUT.mkdir(exist_ok=True)

DEV_SERVER = "http://127.0.0.1:3000"  # NEVER localhost — see CLAUDE.md / project memory
CHARACTER_SLUG = "jene"

# Round 2 runs with the dev server down (unrelated Nitro bug) — no API fetch,
# no /api/inpaint/nano-gen. Portrait comes straight off disk, generations go
# straight to fal's queue API.
PORTRAIT_PATH = REPO_ROOT / "input" / "sd-ref_1786656610019_sheet_portrait.png"
ENV_PATH = REPO_ROOT / "frontend" / ".env"
FAL_QUEUE_BASE = "https://queue.fal.run"
FAL_APP = "fal-ai/nano-banana-pro/edit"  # matches runNanoFal's `imageList.length` branch in nano-gen.post.ts

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


def fetch_portrait_data_url_from_disk() -> str:
    """Round 2: no dev server, so read Jene's portrait panel straight off
    disk instead of GET /api/characters-local + /view. Same file the dev
    server would have served — verified against the panels listing in round 1
    (slug 'jene', slot 'portrait' -> sd-ref_1786656610019_sheet_portrait.png)."""
    if not PORTRAIT_PATH.exists():
        raise RuntimeError(f"portrait not found at {PORTRAIT_PATH}")
    return image_to_data_url(PORTRAIT_PATH)


def read_fal_key() -> str:
    """Read FAL_KEY straight out of frontend/.env. Never logged, never
    returned in any printed/committed artifact — held only in memory for the
    Authorization header."""
    if not ENV_PATH.exists():
        raise RuntimeError(f"{ENV_PATH} not found — can't read FAL_KEY")
    for line in ENV_PATH.read_text().splitlines():
        line = line.strip()
        if not line or line.startswith("#") or "=" not in line:
            continue
        key, _, value = line.partition("=")
        if key.strip() == "FAL_KEY":
            value = value.strip().strip('"').strip("'")
            if value:
                return value
    raise RuntimeError(f"FAL_KEY not set in {ENV_PATH}")


BODY_FRONT_PROMPT = (
    "Show the same person as a full-body figure from the front, standing "
    "naturally with arms relaxed, framed strictly from the shoulders down — "
    "the head, face and hair are entirely outside the top edge of the frame, "
    "no head visible. Keep the exact same wardrobe and body type. Plain "
    "neutral grey studio background, even soft light, photorealistic."
)
REF_SUFFIX = " Match the body proportions of the grey reference figure in the second image."

# --- Round 2 (sharpened probe): pin wardrobe + framing identically across all
# three calls so clothing/zoom choices can't be mistaken for proportion
# transfer, and use stronger, more explicit proportion-matching language for
# the two ref calls. Round 1 (out/gen-*.png, out/probe-contact-sheet.png) is
# left untouched; round 2 writes gen-v2-*.png / probe-contact-sheet-v2.png.
WARDROBE_PIN = " The person wears a plain fitted black tank top and plain black trousers."
FRAMING_PIN = (
    " Full-body view, the entire figure visible head to toe, camera at chest "
    "height, plain light grey studio background."
)
BODY_FRONT_PROMPT_V2 = BODY_FRONT_PROMPT + WARDROBE_PIN + FRAMING_PIN
REF_SUFFIX_V2 = (
    " The person's height and build must match the grey reference figure in "
    "the second image exactly — same shoulder width, same waist, same "
    "overall height-to-width proportions."
)


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


def _fal_submit(prompt: str, image_urls: list[str], headers: dict, app_base: str) -> tuple[str, str, str]:
    """Submit only. Returns (rid, status_url, result_url). Field names mirror
    frontend/server/utils/falRun.ts::runFal + nano-gen.post.ts::runNanoFal
    EXACTLY (app id, input keys, status/response URL fallbacks) — copied
    rather than reinvented per the memory note that a mismatched fal field
    silently fails only at result time, not at submit time."""
    # Matches runNanoFal(): { prompt, num_images: 1, output_format: 'png', image_urls }
    # + aspect_ratio when provided.
    input_payload = {
        "prompt": prompt,
        "num_images": 1,
        "output_format": "png",
        "image_urls": image_urls,
        "aspect_ratio": "3:4",
    }
    # NOTE: must send `headers` (with Authorization) here, NOT the generic
    # http_post_json() helper — that helper only sets Content-Type and was
    # written for the (locally-authenticated) dev-server routes. Using it
    # here silently drops the Authorization header and fal 401s (round 2's
    # first bug).
    submit_req = urllib.request.Request(
        app_base, data=json.dumps(input_payload).encode("utf-8"), headers=headers, method="POST"
    )
    with urllib.request.urlopen(submit_req, timeout=60) as resp:
        submit = json.loads(resp.read().decode("utf-8"))
    rid = submit["request_id"]
    status_url = submit.get("status_url") or f"{app_base}/requests/{rid}/status"
    result_url = submit.get("response_url") or f"{app_base}/requests/{rid}"
    return rid, status_url, result_url


def _fal_poll_and_fetch(rid: str, status_url: str, result_url: str, headers: dict, poll_deadline_s: float = 150.0) -> bytes:
    """Poll an ALREADY-SUBMITTED request to completion and download the
    image. Never resubmits — a timeout here just means the caller can call
    this again on the exact same rid/status_url/result_url. This is the
    round-2 fix: round 2's retry wrapped submit+poll+fetch together, so a
    timeout mid-poll could trigger a second, separately-billed submission
    for the same call."""
    deadline = time.time() + poll_deadline_s
    while time.time() < deadline:
        time.sleep(1.5)
        req = urllib.request.Request(status_url, headers=headers)
        try:
            with urllib.request.urlopen(req, timeout=30) as resp:
                status_body = json.loads(resp.read().decode("utf-8"))
                code = resp.status
        except urllib.error.HTTPError as e:
            if 400 <= e.code < 500:
                raise RuntimeError(f"fal status {e.code} (not retryable): {e.read().decode('utf-8', 'ignore')}")
            continue  # 5xx transient
        if code not in (200, 202):
            continue
        status = status_body.get("status")
        if status in ("IN_QUEUE", "IN_PROGRESS"):
            continue
        if status == "COMPLETED":
            req2 = urllib.request.Request(result_url, headers=headers)
            with urllib.request.urlopen(req2, timeout=60) as resp2:
                result = json.loads(resp2.read().decode("utf-8"))
            images = result.get("images")
            url = images[0]["url"] if images else None
            if not url:
                raise RuntimeError("fal returned no image")
            return http_get_bytes(url)
        raise RuntimeError(f"fal request {rid} ended in {status}: {status_body}")
    raise TimeoutError(f"fal poll timed out (id={rid}) — same rid can be re-polled, not resubmitted")


def nano_gen_fal(prompt: str, image_urls: list[str], label: str, fal_key: str, retries: int = 1) -> Path | None:
    """Direct fal call (no dev server). Submits EXACTLY ONCE. On failure,
    retries by re-polling the SAME request id (never resubmits) up to
    `retries` times, then stops rather than switching providers or burning
    more money. This is the round-3 fix for round 2's possible-duplicate-
    submission bug."""
    headers = {"Authorization": f"Key {fal_key}", "Content-Type": "application/json"}
    app_base = f"{FAL_QUEUE_BASE}/{FAL_APP}"

    try:
        rid, status_url, result_url = _fal_submit(prompt, image_urls, headers, app_base)
    except (urllib.error.URLError, urllib.error.HTTPError, RuntimeError, TimeoutError, KeyError) as exc:
        print(f"[{label}] submit failed: {exc} — STOPPING, not retrying submit.")
        return None
    print(f"[{label}] submitted (request_id={rid})")

    for attempt in range(retries + 1):
        try:
            img_bytes = _fal_poll_and_fetch(rid, status_url, result_url, headers)
            path = OUT / f"gen-{label}.png"
            path.write_bytes(img_bytes)
            print(f"[{label}] saved -> {path} (fal-ai/nano-banana-pro/edit)")
            return path
        except (urllib.error.URLError, urllib.error.HTTPError, RuntimeError, TimeoutError) as exc:
            print(f"[{label}] poll attempt {attempt + 1} failed: {exc}")
            if attempt < retries:
                time.sleep(3)
                continue
            print(f"[{label}] giving up after {attempt + 1} poll attempt(s) — STOPPING, not switching providers.")
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


def run_generations_v2(portrait_url: str, default_front: Path, extreme_front: Path, fal_key: str):
    """Round 2: identical wardrobe + framing pins on all three calls, and
    stronger explicit proportion-matching language on the two ref calls.
    Dev server is down (unrelated Nitro bug) — calls fal's queue API
    directly instead of POST /api/inpaint/nano-gen. Writes
    gen-v2-{control,default-ref,extreme-ref}.png, leaving round 1's
    gen-{...}.png outputs untouched."""
    default_front_url = image_to_data_url(default_front)
    extreme_front_url = image_to_data_url(extreme_front)

    results = {}
    results["control"] = nano_gen_fal(BODY_FRONT_PROMPT_V2, [portrait_url], "v2-control", fal_key)
    if results["control"] is None:
        print("v2 control call failed after retry — stopping before spending more.")
        return results

    results["default-ref"] = nano_gen_fal(
        BODY_FRONT_PROMPT_V2 + REF_SUFFIX_V2,
        [portrait_url, default_front_url],
        "v2-default-ref",
        fal_key,
    )
    if results["default-ref"] is None:
        print("v2 default-ref call failed after retry — stopping before spending more.")
        return results

    results["extreme-ref"] = nano_gen_fal(
        BODY_FRONT_PROMPT_V2 + REF_SUFFIX_V2,
        [portrait_url, extreme_front_url],
        "v2-extreme-ref",
        fal_key,
    )
    return results


# --- Round 3 (inverted edit): the grey figure is now the image BEING
# EDITED (image_urls[0]); Jene's portrait supplies identity (image_urls[1]).
# Exactly 2 calls, ~$0.30. Prompt is identical for both calls — only the
# figure image differs (default vs extreme).
PROMPT_V3 = (
    "Turn the grey reference figure in the first image into a photorealistic "
    "person, keeping the figure's exact body proportions, height and build "
    "unchanged. Take the face, hair and identity from the person in the "
    "second image. The person wears a plain fitted black tank top and plain "
    "black trousers. Full-body view, the entire figure visible head to toe, "
    "camera at chest height, plain light grey studio background."
)


def run_generations_v3(portrait_url: str, default_front: Path, extreme_front: Path, fal_key: str):
    """Round 3: inverted edit. image_urls = [figure, portrait] (figure is
    edited, portrait supplies identity) — the opposite order from rounds 1-2.
    Exactly 2 calls: default-inverted, extreme-inverted. No control call this
    round (round 2's control is reused for the contact sheet instead)."""
    default_front_url = image_to_data_url(default_front)
    extreme_front_url = image_to_data_url(extreme_front)

    results = {}
    results["default-inverted"] = nano_gen_fal(
        PROMPT_V3, [default_front_url, portrait_url], "v3-default-inverted", fal_key
    )
    if results["default-inverted"] is None:
        print("v3 default-inverted call failed after retry — stopping before spending more.")
        return results

    results["extreme-inverted"] = nano_gen_fal(
        PROMPT_V3, [extreme_front_url, portrait_url], "v3-extreme-inverted", fal_key
    )
    return results


# --- Round 4 (text-driven body change): no grey figure at all — just the
# portrait plus a text description of a heavier build, testing whether text
# alone can shift body while identity (face/hair) holds. Exactly 2 calls,
# ~$0.30. "Moderate" and "extreme" only differ in the body-description
# sentence; everything else (wardrobe/framing pins, identity instruction) is
# identical.
PROMPT_V4_MODERATE = (
    "Show the same person as a full-body photorealistic figure, standing "
    "naturally. She has a noticeably heavyset, overweight build — full "
    "figure, rounded torso, thick arms and legs. Keep her face, hair and "
    "identity exactly as shown. She wears a plain fitted black tank top and "
    "plain black trousers. Full-body view, the entire figure visible head to "
    "toe, camera at chest height, plain light grey studio background."
)
PROMPT_V4_EXTREME = (
    "Show the same person as a full-body photorealistic figure, standing "
    "naturally. She is very overweight — a heavy, plus-size build with a "
    "large rounded belly, wide hips, full arms and a double chin. Keep her "
    "face, hair and identity exactly as shown. She wears a plain fitted "
    "black tank top and plain black trousers. Full-body view, the entire "
    "figure visible head to toe, camera at chest height, plain light grey "
    "studio background."
)


def run_generations_v4(portrait_url: str, fal_key: str):
    """Round 4: text-only body change, no grey figure involved at all.
    Exactly 2 calls: moderate, extreme. Both take only the portrait as input."""
    results = {}
    results["moderate"] = nano_gen_fal(PROMPT_V4_MODERATE, [portrait_url], "v4-moderate", fal_key)
    if results["moderate"] is None:
        print("v4 moderate call failed after retry — stopping before spending more.")
        return results

    results["extreme"] = nano_gen_fal(PROMPT_V4_EXTREME, [portrait_url], "v4-extreme", fal_key)
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
    out_name: str = "probe-contact-sheet.png",
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

    path = OUT / out_name
    sheet.save(path)
    print(f"wrote {path}")


def build_contact_sheet_v3(
    portrait_path_bytes: bytes,
    default_front: Path,
    extreme_front: Path,
    round2_control: Path,
    gen_results: dict[str, Path | None],
    out_name: str = "probe-contact-sheet-v3.png",
) -> None:
    """Round 3 layout: row 1 = default figure, extreme figure, portrait;
    row 2 = default-inverted output, extreme-inverted output, round 2's
    control image again (for comparison against the un-inverted baseline)."""
    cell_w, cell_h = 300, 400

    def load(pathlike, from_bytes=False) -> Image.Image:
        img = Image.open(pathlike) if not from_bytes else Image.open(__import__("io").BytesIO(pathlike))
        img = img.convert("RGB")
        img.thumbnail((cell_w, cell_h))
        bg = Image.new("RGB", (cell_w, cell_h), "white")
        bg.paste(img, ((cell_w - img.width) // 2, (cell_h - img.height) // 2))
        return bg

    row1 = [
        (load(default_front), "default figure"),
        (load(extreme_front), "extreme figure"),
        (load(portrait_path_bytes, from_bytes=True), "portrait (input)"),
    ]
    row2 = [
        (
            load(gen_results["default-inverted"]) if gen_results.get("default-inverted") else Image.new("RGB", (cell_w, cell_h), "grey"),
            "default-inverted",
        ),
        (
            load(gen_results["extreme-inverted"]) if gen_results.get("extreme-inverted") else Image.new("RGB", (cell_w, cell_h), "grey"),
            "extreme-inverted",
        ),
        (
            load(round2_control) if round2_control.exists() else Image.new("RGB", (cell_w, cell_h), "grey"),
            "round2 control (ref)",
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

    path = OUT / out_name
    sheet.save(path)
    print(f"wrote {path}")


def build_contact_sheet_v4(
    portrait_path_bytes: bytes,
    round2_control: Path,
    gen_results: dict[str, Path | None],
    out_name: str = "probe-contact-sheet-v4.png",
) -> None:
    """Round 4 layout (2x2, no grey figures involved this round): row 1 =
    portrait, round 2's control image (normal-build baseline); row 2 =
    moderate output, extreme output."""
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
        (load(round2_control) if round2_control.exists() else Image.new("RGB", (cell_w, cell_h), "grey"), "round2 control (normal build)"),
    ]
    row2 = [
        (
            load(gen_results["moderate"]) if gen_results.get("moderate") else Image.new("RGB", (cell_w, cell_h), "grey"),
            "moderate (heavyset)",
        ),
        (
            load(gen_results["extreme"]) if gen_results.get("extreme") else Image.new("RGB", (cell_w, cell_h), "grey"),
            "extreme (very overweight)",
        ),
    ]

    label_h = 28
    sheet = Image.new("RGB", (cell_w * 2, (cell_h + label_h) * 2), "white")
    draw = ImageDraw.Draw(sheet)
    font = ImageFont.load_default()
    for row_idx, row in enumerate([row1, row2]):
        for col_idx, (img, caption) in enumerate(row):
            x = col_idx * cell_w
            y = row_idx * (cell_h + label_h)
            draw.text((x + 6, y + 4), caption, fill="black", font=font)
            sheet.paste(img, (x, y + label_h))

    path = OUT / out_name
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


def main_round2() -> None:
    """Sharpened re-probe: wardrobe + framing pinned identically across all
    three calls, stronger explicit proportion-matching language on the two
    ref calls. Reuses the existing figure renders from round 1
    (out/figure-{default,extreme}-front.png must already exist — run `main`
    first, or just rely on them already being on disk from round 1).

    Dev server is down (unrelated Nitro bug in frontend/server/plugins/
    trainingQueue.ts — see .superpowers/sdd/task-1-report.md) — this round
    does NOT touch it: portrait comes straight off disk and generations go
    straight to fal's queue API (see nano_gen_fal / _fal_submit / _fal_poll_and_fetch)."""
    default_front = OUT / "figure-default-front.png"
    extreme_front = OUT / "figure-extreme-front.png"
    if not default_front.exists() or not extreme_front.exists():
        raise RuntimeError(
            "round 2 reuses round 1's figure renders — run `./venv/bin/python probe.py` "
            "(round 1) first so out/figure-{default,extreme}-front.png exist."
        )

    print("== Round 2: paid fal calls (~$0.40, 3 calls, wardrobe+framing pinned) ==")
    fal_key = read_fal_key()  # never printed/logged
    portrait_url = fetch_portrait_data_url_from_disk()
    portrait_bytes = base64.b64decode(portrait_url.split(",", 1)[1])
    gen_results = run_generations_v2(portrait_url, default_front, extreme_front, fal_key)

    print("== Contact sheet v2 ==")
    build_contact_sheet(
        portrait_bytes, default_front, extreme_front, gen_results, out_name="probe-contact-sheet-v2.png"
    )

    print("done. See out/probe-contact-sheet-v2.png.")


def main_round3() -> None:
    """Inverted-edit re-probe: the grey figure is now the image being
    edited; Jene's portrait supplies identity. Exactly 2 calls (~$0.30).
    Reuses round 1's figure renders and round 2's control image. Same
    disk-portrait / direct-fal path as round 2, but with the fixed
    submit-once / re-poll-same-rid retry semantics in nano_gen_fal()."""
    default_front = OUT / "figure-default-front.png"
    extreme_front = OUT / "figure-extreme-front.png"
    round2_control = OUT / "gen-v2-control.png"
    if not default_front.exists() or not extreme_front.exists():
        raise RuntimeError(
            "round 3 reuses round 1's figure renders — run `./venv/bin/python probe.py` "
            "(round 1) first so out/figure-{default,extreme}-front.png exist."
        )
    if not round2_control.exists():
        raise RuntimeError(
            "round 3's contact sheet reuses round 2's control image — run "
            "`./venv/bin/python probe.py --round2` first so out/gen-v2-control.png exists."
        )

    print("== Round 3: paid fal calls (~$0.30, 2 calls, inverted edit) ==")
    fal_key = read_fal_key()  # never printed/logged
    portrait_url = fetch_portrait_data_url_from_disk()
    portrait_bytes = base64.b64decode(portrait_url.split(",", 1)[1])
    gen_results = run_generations_v3(portrait_url, default_front, extreme_front, fal_key)

    print("== Contact sheet v3 ==")
    build_contact_sheet_v3(portrait_bytes, default_front, extreme_front, round2_control, gen_results)

    print("done. See out/probe-contact-sheet-v3.png.")


def main_round4() -> None:
    """Text-driven body change: no grey figure involved at all — just the
    portrait plus a text description of a heavier build, testing whether
    text alone can shift body while identity holds. Exactly 2 calls
    (~$0.30). Reuses round 2's control image for the contact sheet baseline."""
    round2_control = OUT / "gen-v2-control.png"
    if not round2_control.exists():
        raise RuntimeError(
            "round 4's contact sheet reuses round 2's control image — run "
            "`./venv/bin/python probe.py --round2` first so out/gen-v2-control.png exists."
        )

    print("== Round 4: paid fal calls (~$0.30, 2 calls, text-driven body change) ==")
    fal_key = read_fal_key()  # never printed/logged
    portrait_url = fetch_portrait_data_url_from_disk()
    portrait_bytes = base64.b64decode(portrait_url.split(",", 1)[1])
    gen_results = run_generations_v4(portrait_url, fal_key)

    print("== Contact sheet v4 ==")
    build_contact_sheet_v4(portrait_bytes, round2_control, gen_results)

    print("done. See out/probe-contact-sheet-v4.png.")


if __name__ == "__main__":
    import sys

    if "--round4" in sys.argv:
        main_round4()
    elif "--round3" in sys.argv:
        main_round3()
    elif "--round2" in sys.argv:
        main_round2()
    else:
        main()
