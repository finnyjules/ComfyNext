"""Cinematic shot-preset catalog + prompt compiler for FilmShotNode.

Mirrors frontend/app/data/shot-presets.ts (gallery tiles). Keep `id` identical
to the TS catalog — it's the dispatch key the gallery writes into the node's
`preset` widget.

Each preset is a complete framing recipe across five dimensions (size, angle,
movement, lens, composition) plus a mood note. `build_shot_phrase` compiles a
recipe into prompt language; the dialect arg picks per-model phrasing
(standard prose / Veo lens-forward / Hailuo bracket commands).

Design doc: docs/plans/2026-06-10-film-a-shot-node-design.md
"""
from __future__ import annotations

from dataclasses import dataclass


# Sentinel for the ADVANCED override combos: keep the preset's own value.
AUTO = "auto (preset)"

DEFAULT_PRESET_ID = "push-in"


@dataclass(frozen=True)
class ShotPreset:
    id: str
    label: str
    category: str      # movement | angle | lens | composition
    size: str          # "medium close-up"
    angle: str         # composes as f"from {angle}" — write accordingly
    movement: str      # full clause: "the camera slowly dollies in"
    lens: str          # "50mm lens with shallow depth of field"
    composition: str   # "subject centered in frame"
    note: str          # mood line: "builds quiet tension"


PRESETS: list[ShotPreset] = [
    # ----- Movement-led ------------------------------------------------------
    ShotPreset("push-in", "Slow push-in", "movement",
        "medium close-up", "eye level",
        "the camera slowly dollies in toward the subject",
        "50mm lens with shallow depth of field",
        "subject centered in frame", "builds quiet tension"),
    ShotPreset("pull-back", "Pull-back reveal", "movement",
        "close-up widening to a wide shot", "eye level",
        "the camera steadily dollies out, revealing the surroundings",
        "35mm lens with deepening focus",
        "subject anchored in place as the world grows around them",
        "the context lands at the end"),
    ShotPreset("crane-reveal", "Crane reveal", "movement",
        "wide shot", "a low position rising high",
        "the camera cranes up smoothly",
        "24mm lens with deep focus",
        "landscape framing with a strong horizon", "establishing grandeur"),
    ShotPreset("orbit", "Hero orbit", "movement",
        "medium shot", "eye level",
        "the camera arcs in a slow 180-degree orbit around the subject",
        "35mm lens with shallow depth of field",
        "subject locked at frame center", "the hero moment"),
    ShotPreset("tracking", "Lateral tracking", "movement",
        "medium shot in profile", "eye level",
        "the camera tracks laterally alongside the moving subject, matched to their pace",
        "40mm lens with deep focus",
        "leading room ahead of the subject", "walk-and-talk energy"),
    ShotPreset("handheld", "Handheld urgency", "movement",
        "medium close-up", "eye level",
        "shaky handheld camera following the subject",
        "28mm lens",
        "loose, imperfect framing", "documentary urgency"),
    ShotPreset("dolly-zoom", "Dolly zoom (Vertigo)", "movement",
        "medium close-up", "eye level",
        "the camera dollies in while the lens zooms out",
        "50mm lens, the background perspective visibly warping",
        "subject locked dead center", "reality bends around them"),
    ShotPreset("tilt-reveal", "Tilt-up reveal", "movement",
        "full shot revealed from the feet upward", "a low angle",
        "the camera tilts up slowly from the ground to the face",
        "35mm lens",
        "vertical reveal framing", "sizing them up"),
    ShotPreset("whip-pan", "Whip pan", "movement",
        "medium shot", "eye level",
        "the camera whips violently sideways in a fast pan, streaking with motion blur",
        "35mm lens",
        "framing snaps from one point to the next", "an energy spike"),
    ShotPreset("crash-zoom", "Crash zoom", "movement",
        "wide shot punching in to a close-up", "eye level",
        "an abrupt crash zoom punches toward the subject",
        "zoom lens",
        "subject suddenly fills the frame", "a grindhouse exclamation mark"),
    ShotPreset("snorricam", "Snorricam", "movement",
        "close-up, body-rigged", "a body-rigged mount facing the actor",
        "a snorricam locked to the actor's body, the world lurching and swimming behind them",
        "28mm lens",
        "face pinned center while the background reels", "panic and unraveling"),
    ShotPreset("steadicam-oner", "Steadicam oner", "movement",
        "medium shot following the subject", "eye level",
        "a flowing steadicam glide that follows unbroken through doorways and spaces",
        "32mm lens with deep focus",
        "continuously reframing around the moving subject", "the long-take feel"),
    ShotPreset("fpv-dive", "FPV drone dive", "movement",
        "wide shot tightening rapidly", "a plunging aerial angle",
        "an FPV drone dives aggressively and weaves toward the subject",
        "ultra-wide lens",
        "horizon rolling with the dive", "pure adrenaline"),
    ShotPreset("aerial-orbit", "Aerial establish orbit", "movement",
        "extreme wide shot", "a high aerial angle",
        "a drone circles the location in a slow orbit",
        "24mm lens with deep focus",
        "the landscape framed like a map coming alive", "the opening-credits shot"),
    ShotPreset("ground-rush", "Ground-rush tracking", "movement",
        "low medium shot", "inches off the ground",
        "the camera skims fast and low across the surface toward the subject",
        "24mm lens",
        "ground rushing through the lower frame", "road-blur menace"),

    # ----- Angle-led ---------------------------------------------------------
    ShotPreset("god-shot", "Overhead god shot", "angle",
        "wide shot", "directly overhead, bird's-eye",
        "the camera descends slowly straight down",
        "24mm lens with deep focus",
        "geometric framing of the ground below", "fate watching from above"),
    ShotPreset("low-hero", "Low-angle power", "angle",
        "medium shot", "a strong low angle looking up",
        "the camera pushes in slightly",
        "24mm wide-angle lens with mild distortion",
        "the subject towering over the frame", "an imposing entrance"),
    ShotPreset("dutch", "Dutch drift", "angle",
        "medium close-up", "a dutch tilt of about 15 degrees",
        "the camera drifts slowly sideways",
        "40mm lens with shallow depth of field",
        "off-balance rule-of-thirds framing", "something is quietly wrong"),
    ShotPreset("worms-eye", "Worm's-eye sky", "angle",
        "extreme wide shot", "looking straight up from the ground",
        "the camera holds static, rolling slowly",
        "18mm ultra-wide lens",
        "towers and sky swallowing the frame", "vertigo in reverse"),

    # ----- Lens-led ----------------------------------------------------------
    ShotPreset("anamorphic", "Anamorphic dream", "lens",
        "medium shot", "eye level",
        "the camera drifts slowly",
        "anamorphic lens with horizontal blue flares and oval bokeh",
        "2.39:1 widescreen letterbox framing", "prestige-film sheen"),
    ShotPreset("macro", "Macro detail", "lens",
        "extreme close-up", "eye level",
        "a focus pull racks across the detail",
        "macro lens with razor-thin depth of field",
        "the single detail isolated against soft blur", "the object tells the story"),
    ShotPreset("rack-focus", "Rack focus reveal", "lens",
        "medium close-up across two depth planes", "eye level",
        "the frame holds still while focus pulls from foreground to background",
        "85mm lens with razor-thin depth of field",
        "two subjects stacked in depth", "attention is the edit"),
    ShotPreset("telephoto", "Telephoto compression", "lens",
        "medium close-up from far away", "eye level",
        "the camera holds nearly still with a slight pan",
        "300mm telephoto lens compressing the planes",
        "blurred foreground passers-by stacking the depth", "surveillance distance"),

    # ----- Composition-led ---------------------------------------------------
    ShotPreset("locked-off", "Symmetrical one-point", "composition",
        "wide shot", "eye level",
        "a locked-off static camera, perfectly still",
        "32mm lens with deep focus",
        "dead-center one-point-perspective symmetry", "an unblinking formal stare"),
    ShotPreset("ots", "Over-the-shoulder", "composition",
        "medium close-up", "eye level",
        "the camera holds nearly still with a micro drift",
        "65mm lens with shallow depth of field",
        "framed over a foreground shoulder", "conversation intimacy"),
    ShotPreset("pov", "POV walk", "composition",
        "first-person point of view", "eye level",
        "handheld camera walking forward as the character's own eyes",
        "28mm lens",
        "hands and body edges intruding at the frame borders", "you are there"),
    ShotPreset("voyeur-frame", "Voyeur doorframe", "composition",
        "medium shot", "eye level",
        "a static camera watching through a doorway",
        "50mm lens",
        "framed through a door or window slit, dark edges crowding the subject",
        "being watched"),
    ShotPreset("mirror", "Mirror double", "composition",
        "medium close-up", "eye level",
        "the camera holds still, pushing in slowly",
        "50mm lens",
        "the subject and their mirror reflection sharing the frame",
        "two truths at once"),
]

PRESETS_BY_ID: dict[str, ShotPreset] = {p.id: p for p in PRESETS}
PRESET_IDS: list[str] = [p.id for p in PRESETS]


# ---------- ADVANCED override option lists ----------------------------------
# Each combo's options ARE the substitution phrases — picking one replaces that
# dimension of the active preset verbatim. AUTO keeps the preset's value.

SIZE_OPTIONS = [AUTO, "extreme close-up", "close-up", "medium close-up",
                "medium shot", "full shot", "wide shot", "extreme wide shot"]

ANGLE_OPTIONS = [AUTO, "eye level", "a low angle", "a high angle",
                 "directly overhead, bird's-eye", "a dutch tilt", "ground level"]

MOVEMENT_OPTIONS = [AUTO,
    "a locked-off static camera",
    "the camera slowly dollies in toward the subject",
    "the camera steadily dollies out",
    "the camera pans slowly left to right",
    "the camera tilts up slowly",
    "the camera cranes up smoothly",
    "the camera arcs in a slow orbit around the subject",
    "the camera tracks laterally alongside the subject",
    "shaky handheld camera following the subject",
    "a flowing steadicam glide",
    "an FPV drone dives toward the subject",
    "an abrupt crash zoom punches toward the subject"]

LENS_OPTIONS = [AUTO, "18mm ultra-wide lens", "24mm wide-angle lens", "35mm lens",
                "50mm lens with shallow depth of field",
                "85mm lens with razor-thin depth of field",
                "300mm telephoto lens compressing the planes",
                "anamorphic lens with horizontal blue flares and oval bokeh",
                "macro lens with razor-thin depth of field"]

COMPOSITION_OPTIONS = [AUTO, "subject centered in frame", "rule-of-thirds framing",
                       "dead-center one-point-perspective symmetry",
                       "framed over a foreground shoulder",
                       "first-person POV framing",
                       "framed through a doorway",
                       "leading room ahead of the subject"]
