"""Text-effect catalog for the TextEffectNode.

Mirrors frontend/app/data/text-effects.ts. Each effect carries a prompt
template with a `{TEXT}` placeholder; the node substitutes the user's word
and dispatches to a text-strong image model (Ideogram v3).

Keep `id` identical to the TS catalog — it's the dispatch key the gallery
writes into the node's `effect` widget.

Adding an effect: append an entry here AND mirror it in the TS file. The
prompt template is the whole behavior; no per-effect code needed.

Each effect also carries an `edit_template` used by the restyle (image-edit)
path — see build_edit_prompt. This is Python-only: the TS catalog drives the
gallery's CSS previews and never consumes edit phrasing, so it isn't mirrored.
"""
from __future__ import annotations

from dataclasses import dataclass


# Ideogram v3 is the reliable choice for rendering legible in-image lettering.
# Turbo keeps cost/latency down while still nailing text.
_TEXT_MODEL_SLUG = "ideogram-ai/ideogram-v3-turbo"
_IDEOGRAM_V3_AR = {"1:1", "16:9", "9:16", "4:3", "3:4", "3:2", "2:3", "16:10", "10:16"}

# Image-edit model for the restyle path — used when typography is wired into the
# node. Flux Kontext keeps the composition and repaints only the surface.
_EDIT_MODEL_SLUG = "black-forest-labs/flux-kontext-pro"

# Output ratios Flux Kontext Pro accepts (besides "match_input_image"). The node
# also offers 16:10/10:16, which Kontext rejects — those, and the explicit
# "Match input" choice, fall back to preserving the source crop.
_EDIT_AR = {"1:1", "16:9", "9:16", "4:3", "3:4", "3:2", "2:3"}

# Sentinel combo value: in restyle mode, keep the input image's own crop.
MATCH_INPUT_AR = "Match input"


@dataclass(frozen=True)
class TextEffect:
    id: str
    label: str
    prompt_template: str    # contains "{TEXT}" — generate (text-to-image) path
    edit_template: str = ""  # restyle (image-edit) instruction; material only
    model_slug: str = _TEXT_MODEL_SLUG


# Templates mirror the TS catalog verbatim so the gallery's description and the
# actual render agree. {TEXT} is replaced at execute time.
EFFECTS: list[TextEffect] = [
    # ----- Hype / streetwear -------------------------------------------------
    TextEffect("liquid-chrome", "Liquid Chrome",
        'the word "{TEXT}" sculpted from flowing liquid chrome, glossy mercury metal with sharp studio reflections, Y2K aesthetic, dark seamless background, octane render, high contrast',
        edit_template='Restyle the letters as flowing liquid chrome — glossy mercury metal, sharp studio reflections, Y2K aesthetic, dark seamless background.'),
    TextEffect("inflated-gloss", "Inflated Gloss",
        'the word "{TEXT}" as glossy inflated 3D letters, puffy vacuum-sealed balloon typography, soft studio lighting, subtle subsurface sheen, pastel seamless background, blender octane render',
        edit_template='Restyle the letters as glossy inflated 3D balloon typography — puffy vacuum-sealed forms, soft studio lighting, subtle subsurface sheen.'),
    TextEffect("iridescent-holo", "Iridescent Holo",
        'the word "{TEXT}" in iridescent holographic foil, oil-slick rainbow sheen shifting across the letters, reflective chrome edges, dark background, hyper-glossy product render',
        edit_template='Restyle the letters in iridescent holographic foil — oil-slick rainbow sheen, reflective chrome edges, hyper-glossy product finish.'),
    TextEffect("chromatic-glitch", "Chromatic Glitch",
        'the word "{TEXT}" with heavy chromatic aberration and RGB channel split, glitch art, datamosh scanlines, VHS distortion, dark background, new-media aesthetic',
        edit_template='Restyle the letters with heavy chromatic aberration and RGB channel split — glitch art, datamosh scanlines, VHS distortion.'),
    TextEffect("acid-graphics", "Acid Graphics",
        'the word "{TEXT}" as acid graphics, hyper-saturated warped chrome lettering, rave flyer aesthetic, melting distorted forms, bold gradients, dark background',
        edit_template='Restyle the letters as acid graphics — hyper-saturated warped chrome, rave-flyer aesthetic, bold melting gradients.'),
    TextEffect("distressed-screenprint", "Distressed Screenprint",
        'the word "{TEXT}" as a distressed screenprint, cracked and faded ink texture, halftone grain, vintage graphic-tee print, off-white paper background, high contrast',
        edit_template='Restyle the letters as a distressed screenprint — cracked faded ink, halftone grain, vintage graphic-tee print texture.'),
    TextEffect("gradient-mesh", "Gradient Mesh",
        'the word "{TEXT}" formed from smooth bold gradient mesh blobs, soft vibrant color transitions, rounded modern type, minimal seamless background, contemporary poster design',
        edit_template='Restyle the letters with smooth bold gradient-mesh color — soft vibrant transitions, contemporary poster finish.'),
    # ----- Contemporary art / museum -----------------------------------------
    TextEffect("brutalist-concrete", "Brutalist Concrete",
        'the word "{TEXT}" cast in raw brutalist concrete, monolithic heavy letterforms, harsh directional shadows, rough aggregate texture, neutral gray studio background, architectural photography',
        edit_template='Restyle the letters as raw cast brutalist concrete — rough aggregate texture, harsh directional shadows, monolithic surface.'),
    TextEffect("ink-in-water", "Ink in Water",
        'the word "{TEXT}" dissolving into billowing black ink dispersing through clear water, elegant fluid tendrils, high-speed photography, white background, fine art',
        edit_template='Restyle the letters as billowing black ink dispersing through clear water — elegant fluid tendrils, high-speed fine-art look.'),
    TextEffect("smoke-vapor", "Smoke / Vapor",
        'the word "{TEXT}" forming from drifting wisps of monochrome smoke and vapor, soft volumetric haze, dark background, moody fine-art photography',
        edit_template='Restyle the letters as drifting monochrome smoke and vapor — soft volumetric haze, moody fine-art lighting.'),
    TextEffect("frosted-glass", "Frosted Glass",
        'the word "{TEXT}" as translucent frosted glass letters, soft refraction and caustics, shallow depth of field, minimal pastel background, product render',
        edit_template='Restyle the letters as translucent frosted glass — soft refraction and caustics, shallow depth of field, pastel product finish.'),
    TextEffect("wireframe-mesh", "Wireframe Mesh",
        'the word "{TEXT}" as a technical 3D wireframe mesh, glowing topology lines, blueprint aesthetic, dark background, generative-art render',
        edit_template='Restyle the letters as a technical 3D wireframe mesh — glowing topology lines, blueprint aesthetic.'),
    TextEffect("risograph", "Risograph",
        'the word "{TEXT}" as a risograph print, two-color duotone with misregistration, visible grain and ink texture, indie art-book aesthetic, paper background',
        edit_template='Restyle the letters as a risograph print — two-color duotone with misregistration, visible grain and ink texture.'),
    TextEffect("crystalline", "Crystalline",
        'the word "{TEXT}" carved from cut crystal and gemstone facets, prismatic light refraction, sharp polished edges, dark background, luxury product render',
        edit_template='Restyle the letters as cut crystal and gemstone facets — prismatic light refraction, sharp polished edges, luxury finish.'),
    TextEffect("light-trails", "Light Trails",
        'the word "{TEXT}" drawn in glowing long-exposure light trails, neon light-painting streaks against a dark night scene, motion blur, photographic',
        edit_template='Restyle the letters as glowing long-exposure light trails — neon light-painting streaks, motion blur against darkness.'),
    TextEffect("molten-metal", "Molten Metal",
        'the word "{TEXT}" as glowing molten metal, poured liquid steel with incandescent orange heat, dramatic industrial lighting, dark background, cinematic render',
        edit_template='Restyle the letters as glowing molten metal — poured liquid steel with incandescent orange heat, dramatic industrial lighting.'),
]

EFFECTS_BY_ID: dict[str, TextEffect] = {e.id: e for e in EFFECTS}

DEFAULT_EFFECT_ID = "liquid-chrome"


def build_prompt(effect_id: str, text: str) -> str:
    """Substitute the user's word into the effect's template. Falls back to the
    default effect for unknown ids (e.g. a catalog drift between TS and Python)."""
    eff = EFFECTS_BY_ID.get(effect_id) or EFFECTS_BY_ID[DEFAULT_EFFECT_ID]
    safe = (text or "").strip() or "TEXT"
    return eff.prompt_template.replace("{TEXT}", safe)


# Appended to every edit instruction so the image-edit model preserves the
# user's exact typography and only changes the surface treatment.
_EDIT_PRESERVE_SUFFIX = (
    "Keep the exact letterforms, spacing, and composition unchanged; "
    "restyle only the surface material and lighting."
)


def build_edit_prompt(effect_id: str, text: str = "") -> str:
    """Instruction for the restyle (image-edit) path. The word already lives in
    the input image, so `text` is unused today — accepted for symmetry with
    build_prompt. Falls back to the default effect on catalog drift."""
    eff = EFFECTS_BY_ID.get(effect_id) or EFFECTS_BY_ID[DEFAULT_EFFECT_ID]
    return f"{eff.edit_template} {_EDIT_PRESERVE_SUFFIX}"


def aspect_ok(ar: str) -> str:
    return ar if ar in _IDEOGRAM_V3_AR else "1:1"


def edit_aspect(ar: str) -> str:
    """Output ratio for the restyle (image-edit) path. 'Match input' — or any
    ratio Flux Kontext doesn't accept — keeps the source crop; otherwise the
    chosen ratio wins, so the Aspect ratio control behaves the same in both
    modes."""
    return ar if ar in _EDIT_AR else "match_input_image"


def build_text_effect_request(
    effect_id: str,
    text: str,
    aspect_ratio: str,
    seed: int = 0,
    image_data_url: str | None = None,
) -> tuple[str, dict]:
    """Decide which Replicate model to call and with what inputs.

    Pure dispatch — no torch, no network — so it unit-tests offline. Two modes,
    chosen by whether an input image is wired:

    - `image_data_url` set → RESTYLE via Flux Kontext: repaint the exact
      letterforms already in the image. `text` is optional (the word lives in
      the pixels); `aspect_ratio` sets the output ratio, or keeps the source
      crop when it's "Match input" (or a ratio Kontext can't take).
    - `image_data_url` None → GENERATE via Ideogram: render the word from a
      prompt. `text` is required — raises ValueError if blank.

    Unknown `effect_id` falls back to the default effect.
    """
    eff = EFFECTS_BY_ID.get(effect_id) or EFFECTS_BY_ID[DEFAULT_EFFECT_ID]
    if image_data_url is not None:
        input_dict = {
            "prompt": build_edit_prompt(effect_id, text),
            "input_image": image_data_url,
            "aspect_ratio": edit_aspect(aspect_ratio),
            "output_format": "png",
        }
        if seed and seed > 0:
            input_dict["seed"] = int(seed)
        return _EDIT_MODEL_SLUG, input_dict
    if not (text or "").strip():
        raise ValueError("Enter some text to render.")
    input_dict = {
        "prompt": build_prompt(effect_id, text),
        "aspect_ratio": aspect_ok(aspect_ratio),
        "magic_prompt_option": "Off",  # we want the literal word, not an LLM rewrite
    }
    if seed and seed > 0:
        input_dict["seed"] = int(seed)
    return eff.model_slug, input_dict
