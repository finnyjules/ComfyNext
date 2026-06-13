"""Relight instruction text for the Relight node.

Translates the light gimbal's {azimuth, elevation, intensity} plus the preset,
background toggle and optional reference into one nano-banana-2 director's note.
Kept free of torch / comfy_api / network imports so it is unit-testable in CI
(mirrors comfy_extras/_person_swap_prompts.py). The Vue light_gimbal widget
mirrors light_to_phrase() client-side so the caption equals what's sent.
"""
from __future__ import annotations

# Preset → mood/colour/quality clause. "Custom" = neutral white, gimbal only.
PRESET_PHRASES: dict[str, str] = {
    "Custom": "",
    "Golden hour": "warm golden-hour sunlight, long soft shadows, amber tones",
    "Studio softbox": "clean studio softbox lighting, gentle falloff, neutral white balance",
    "Hard noon": "harsh midday sun, hard-edged shadows, high contrast, cool daylight",
    "Blue hour": "cool blue-hour twilight, soft ambient light, moody desaturated tones",
    "Rim/backlight": "strong rim/backlight separating the subject from the background, glowing edges",
    "Window light": "soft directional window light, natural indoor falloff",
    "Neon night": "colourful neon night lighting, saturated magenta and cyan accents, urban glow",
    "Candlelit": "warm low-key candlelight, flickering amber glow, deep shadows",
    "Overcast soft": "flat overcast daylight, very soft shadows, even cool illumination",
}

PRESETS = list(PRESET_PHRASES.keys())


def _direction_phrase(azimuth_deg: float) -> str:
    """Azimuth in [-180, 180]: 0 = front, +90 = right, ±180 = behind. 45° buckets."""
    a = ((azimuth_deg + 180) % 360) - 180
    aa = abs(a)
    if aa < 22.5:    return "from the front"
    if aa > 157.5:   return "from behind"
    if a > 0:
        if aa < 67.5:    return "from the front-right"
        if aa < 112.5:   return "from the right"
        return "from the back-right"
    else:
        if aa < 67.5:    return "from the front-left"
        if aa < 112.5:   return "from the left"
        return "from the back-left"


def _elevation_phrase(elevation_deg: float) -> str | None:
    """Elevation in [-90, 90]: 0 = eye level (omit), + = above, - = below."""
    e = max(-90.0, min(90.0, elevation_deg))
    if abs(e) < 15:
        return None
    if e > 0:
        if e < 45:   return "above"
        if e < 75:   return "high above"
        return "directly overhead"
    else:
        ae = abs(e)
        if ae < 45:  return "slightly below"
        if ae < 75:  return "below"
        return "far below"


def _intensity_phrase(intensity: float) -> str:
    """Intensity in [0, 1] → strength/quality word."""
    i = max(0.0, min(1.0, intensity))
    if i < 0.25:  return "soft, diffused"
    if i < 0.5:   return "moderate"
    if i < 0.75:  return "strong, defined"
    return "dramatic, high-contrast"


def light_to_phrase(azimuth: float, elevation: float, intensity: float) -> str:
    """Compose the light description, e.g.
      (0, 0, 0.6)    -> "a strong, defined key light from the front"
      (-30, 60, 0.9) -> "a dramatic, high-contrast key light from the front-left,
                         positioned high above"
    """
    phrase = f"a {_intensity_phrase(intensity)} key light {_direction_phrase(azimuth)}"
    height = _elevation_phrase(elevation)
    if height:
        phrase += f", positioned {height}"
    return phrase


def relight_instruction(
    preset: str,
    azimuth: float,
    elevation: float,
    intensity: float,
    keep_background: bool,
    has_reference: bool,
    instructions: str = "",
) -> str:
    """Build the full nano-banana-2 relight instruction."""
    parts = [f"Relight the image with {light_to_phrase(azimuth, elevation, intensity)}."]

    preset_phrase = PRESET_PHRASES.get(preset, "")
    if preset_phrase:
        parts.append(f"Lighting style: {preset_phrase}.")

    if keep_background:
        parts.append(
            "Keep the subject, composition, pose, background and colours exactly as "
            "they are — change ONLY the lighting and the shadows it casts."
        )
    else:
        parts.append(
            "You may transform the surrounding environment and background to suit the "
            "new lighting; keep the subject's identity and pose."
        )

    if has_reference:
        parts.append(
            "A second image is provided as a lighting reference — match its lighting "
            "direction, quality and colour temperature."
        )

    extra = (instructions or "").strip()
    if extra:
        parts.append(f"Additional direction: {extra}.")

    parts.append("Output only the edited image.")
    return " ".join(parts)
