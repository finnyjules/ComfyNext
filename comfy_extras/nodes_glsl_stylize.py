from __future__ import annotations

import numpy as np
import torch
import torch.nn.functional as F
from PIL import Image as PILImage, ImageDraw, ImageFont
from typing_extensions import override

from comfy_api.latest import ComfyExtension, IO
from comfy_extras._live_preview import save_live_preview


# Default character ramp, ordered light → dark (sparse → dense).
_ASCII_DEFAULT = " .'`-:_+=<>*xX$#@%"

# Built-in character preset ramps. "custom" lets the user supply their own.
_ASCII_PRESETS: dict[str, str] = {
    "classic":  " .:-=+*#%@",
    "blocks":   " ░▒▓█",   #  ░▒▓█
    "dots":     " .·•●",         #  .·•●
    "lines":    " -=≡",                    #  -=≡
    "letters":  " EFTLIVH#",
    "numbers":  " 1234567890",
    "binary":   " 01",
    "braille":  " ⠁⠇⠿⣿",    #  ⠁⠇⠿⣿
}
_ASCII_PRESET_NAMES = list(_ASCII_PRESETS.keys()) + ["custom"]

# Common monospace fonts available on macOS / Linux.
_FONT_PATHS = [
    "/System/Library/Fonts/Menlo.ttc",
    "/System/Library/Fonts/Monaco.ttf",
    "/System/Library/Fonts/SFNSMono.ttf",
    "/usr/share/fonts/truetype/dejavu/DejaVuSansMono-Bold.ttf",
    "/usr/share/fonts/truetype/liberation/LiberationMono-Bold.ttf",
]

# Lazily-baked character bitmaps, keyed by (cell_size, characters).
_ascii_bitmap_cache: dict[tuple[int, str], torch.Tensor] = {}


def _load_mono_font(size: int):
    for path in _FONT_PATHS:
        try:
            return ImageFont.truetype(path, size)
        except (OSError, IOError):
            continue
    return ImageFont.load_default()


def _ascii_bitmaps(cell: int, characters: str, device, dtype) -> torch.Tensor:
    """Return a [N, cell, cell] grayscale tensor of pre-rendered characters."""
    key = (cell, characters)
    if key in _ascii_bitmap_cache:
        return _ascii_bitmap_cache[key].to(device, dtype)
    # Render at a higher resolution and downscale — gives sharper, fuller glyphs
    # than rendering directly at cell size, especially for small cells.
    super_sample = 2
    big = cell * super_sample
    # Aim for the tallest character to fill ~85% of the cell height.
    font = _load_mono_font(int(big * 0.85))
    rendered = []
    for ch in characters:
        img = PILImage.new("L", (big, big), 0)
        draw = ImageDraw.Draw(img)
        try:
            bbox = draw.textbbox((0, 0), ch, font=font)
            tw = bbox[2] - bbox[0]
            th = bbox[3] - bbox[1]
            ox, oy = -bbox[0], -bbox[1]
        except AttributeError:
            tw, th = draw.textsize(ch, font=font)
            ox = oy = 0
        x0 = (big - tw) // 2 + ox
        y0 = (big - th) // 2 + oy
        draw.text((x0, y0), ch, fill=255, font=font)
        small = img.resize((cell, cell), PILImage.LANCZOS)
        rendered.append(torch.from_numpy(np.array(small)).float() / 255.0)
    stacked = torch.stack(rendered, dim=0)
    _ascii_bitmap_cache[key] = stacked
    return stacked.to(device, dtype)


def _apply_blend(base: torch.Tensor, over: torch.Tensor, mode: str) -> torch.Tensor:
    """Photoshop-style blend of `over` onto `base`. Both [B,H,W,3] in [0,1]."""
    if mode == "normal":
        return over
    if mode == "multiply":
        return base * over
    if mode == "screen":
        return 1.0 - (1.0 - base) * (1.0 - over)
    if mode == "overlay":
        low = 2.0 * base * over
        high = 1.0 - 2.0 * (1.0 - base) * (1.0 - over)
        return torch.where(base < 0.5, low, high)
    return over


class KuwaharaNode(IO.ComfyNode):
    """Edge-preserving smoothing that gives a painterly look.

    For each pixel, considers 4 overlapping NxN sub-regions and picks the one
    with lowest variance as the output.
    """
    @classmethod
    def define_schema(cls):
        return IO.Schema(
            node_id="Kuwahara",
            display_name="Kuwahara",
            description="Painterly oil-paint smoothing that preserves edges.",
            category="image/stylize",
            inputs=[
                IO.Image.Input("image"),
                IO.Int.Input("radius", default=4, min=1, max=12, step=1),
            ],
            outputs=[IO.Image.Output(display_name="image")],
            hidden=[IO.Hidden.unique_id],
            is_output_node=True,
        )

    @classmethod
    def execute(cls, image, radius) -> IO.NodeOutput:
        r = max(1, int(radius))
        t = image.permute(0, 3, 1, 2)  # [B, C, H, W]
        # Compute mean and variance via avg_pool over each quadrant.
        # Quadrants are shifted by ±r/2 to avoid the central pixel skewing things.
        b, c, h, w = t.shape
        k = r + 1
        # Mean via avg_pool
        m = F.avg_pool2d(t, kernel_size=k, stride=1, padding=k // 2)
        # E[x^2] for variance
        m2 = F.avg_pool2d(t * t, kernel_size=k, stride=1, padding=k // 2)
        var = (m2 - m * m).clamp(min=0).sum(dim=1, keepdim=True)  # sum across RGB
        # Build four shifted versions corresponding to the 4 quadrants.
        shifts = [(-r // 2, -r // 2), (r // 2, -r // 2), (-r // 2, r // 2), (r // 2, r // 2)]
        means, vars_ = [], []
        for dy, dx in shifts:
            means.append(torch.roll(m, shifts=(dy, dx), dims=(2, 3)))
            vars_.append(torch.roll(var, shifts=(dy, dx), dims=(2, 3)))
        stacked_means = torch.stack(means, dim=0)  # [4, B, C, H, W]
        stacked_vars = torch.stack(vars_, dim=0)   # [4, B, 1, H, W]
        # Pick the quadrant with the lowest variance per pixel.
        idx = stacked_vars.argmin(dim=0)  # [B, 1, H, W]
        idx_exp = idx.expand(-1, c, -1, -1).unsqueeze(0)  # [1, B, C, H, W]
        chosen = stacked_means.gather(0, idx_exp).squeeze(0)
        x = chosen.permute(0, 2, 3, 1).clamp(0, 1)
        return IO.NodeOutput(x, ui=save_live_preview(x, str(cls.hidden.unique_id)))


class CrossHatchNode(IO.ComfyNode):
    @classmethod
    def define_schema(cls):
        return IO.Schema(
            node_id="CrossHatch",
            display_name="Cross-hatch",
            description="Pen-and-ink hatching that builds up in darker areas.",
            category="image/stylize",
            inputs=[
                IO.Image.Input("image"),
                IO.Float.Input("density", default=8.0, min=2.0, max=30.0, step=0.5),
                IO.Float.Input("threshold", default=0.6, min=0.0, max=1.0, step=0.01),
            ],
            outputs=[IO.Image.Output(display_name="image")],
            hidden=[IO.Hidden.unique_id],
            is_output_node=True,
        )

    @classmethod
    def execute(cls, image, density, threshold) -> IO.NodeOutput:
        b, h, w, c = image.shape
        device, dtype = image.device, image.dtype
        luma = 0.2126 * image[..., 0] + 0.7152 * image[..., 1] + 0.0722 * image[..., 2]
        yy, xx = torch.meshgrid(
            torch.arange(h, device=device, dtype=dtype),
            torch.arange(w, device=device, dtype=dtype),
            indexing="ij",
        )
        # 4 hatch directions accumulate ink as luma drops.
        l1 = ((xx + yy) % density < 1.0).to(dtype)
        l2 = ((xx - yy) % density < 1.0).to(dtype)
        l3 = ((xx + yy * 0.5) % density < 1.0).to(dtype)
        l4 = ((xx - yy * 0.5) % density < 1.0).to(dtype)
        ink = torch.zeros_like(luma)
        ink = torch.where(luma < threshold * 0.75, ink + l1, ink)
        ink = torch.where(luma < threshold * 0.5,  ink + l2, ink)
        ink = torch.where(luma < threshold * 0.3,  ink + l3, ink)
        ink = torch.where(luma < threshold * 0.15, ink + l4, ink)
        ink = ink.clamp(0, 1)
        x = (1.0 - ink).unsqueeze(-1).expand(-1, -1, -1, c).clamp(0, 1)
        return IO.NodeOutput(x, ui=save_live_preview(x, str(cls.hidden.unique_id)))


# Bayer 4x4 dither matrix
_BAYER_4 = torch.tensor([
    [ 0,  8,  2, 10],
    [12,  4, 14,  6],
    [ 3, 11,  1,  9],
    [15,  7, 13,  5],
], dtype=torch.float32) / 16.0


class DitherNode(IO.ComfyNode):
    @classmethod
    def define_schema(cls):
        return IO.Schema(
            node_id="Dither",
            display_name="Dither",
            description="Ordered Bayer dithering — reduces color count with a pattern.",
            category="image/stylize",
            inputs=[
                IO.Image.Input("image"),
                IO.Int.Input("levels", default=2, min=2, max=16, step=1),
            ],
            outputs=[IO.Image.Output(display_name="image")],
            hidden=[IO.Hidden.unique_id],
            is_output_node=True,
        )

    @classmethod
    def execute(cls, image, levels) -> IO.NodeOutput:
        b, h, w, c = image.shape
        bayer = _BAYER_4.to(image.device, image.dtype)
        tiled = bayer.repeat((h + 3) // 4, (w + 3) // 4)[:h, :w]
        # Add the threshold then quantize.
        n = max(2, int(levels))
        threshold = (tiled - 0.5) / (n - 1)
        x = ((image + threshold.unsqueeze(0).unsqueeze(-1)) * (n - 1)).round() / (n - 1)
        x = x.clamp(0, 1)
        return IO.NodeOutput(x, ui=save_live_preview(x, str(cls.hidden.unique_id)))


class AsciiNode(IO.ComfyNode):
    @classmethod
    def define_schema(cls):
        return IO.Schema(
            node_id="Ascii",
            display_name="ASCII",
            description="Replace each cell of the image with a character chosen by brightness.",
            category="image/stylize",
            inputs=[
                IO.Image.Input("image"),
                IO.Combo.Input("preset", options=_ASCII_PRESET_NAMES, default="classic",
                              tooltip="Built-in character ramp. Select 'custom' to use your own."),
                IO.String.Input("characters", default=_ASCII_PRESETS["classic"],
                               tooltip="Characters from sparse → dense. Only used when preset is 'custom'."),
                IO.Int.Input("cell_size", default=10, min=4, max=64, step=1,
                            tooltip="Width of each cell, in pixels."),
                IO.Float.Input("gamma", default=1.0, min=0.1, max=3.0, step=0.05,
                              tooltip="Pre-mapping luminance gamma. >1 favors darker chars, <1 favors brighter."),
                IO.Float.Input("phase", default=0.0, min=0.0, max=1.0, step=0.01,
                              tooltip="Rotates which character maps to which brightness."),
                IO.Float.Input("mix", default=1.0, min=0.0, max=1.0, step=0.01,
                              tooltip="Blend factor with the original image."),
                IO.Combo.Input("color_mode", options=["monochrome", "texture"], default="monochrome",
                              tooltip="monochrome: white/black glyphs. texture: glyphs tinted by source color."),
                IO.Boolean.Input("background", default=True,
                                tooltip="Fill non-glyph pixels. Disable to render glyphs on black."),
                IO.Boolean.Input("invert_order", default=False,
                                tooltip="Reverse which characters represent dark vs bright."),
                IO.Int.Input("pos_x", default=0, min=-32, max=32, step=1,
                            tooltip="Sub-cell horizontal offset of the glyph grid (pixels)."),
                IO.Int.Input("pos_y", default=0, min=-32, max=32, step=1,
                            tooltip="Sub-cell vertical offset of the glyph grid (pixels)."),
                IO.Combo.Input("blend_mode", options=["normal", "multiply", "screen", "overlay"], default="normal",
                              tooltip="How the glyph layer composites over the original."),
            ],
            outputs=[IO.Image.Output(display_name="image")],
            hidden=[IO.Hidden.unique_id],
            is_output_node=True,
        )

    @classmethod
    def execute(cls, image, preset, characters, cell_size, gamma, phase, mix,
                color_mode, background, invert_order, pos_x, pos_y, blend_mode) -> IO.NodeOutput:
        cell = max(4, int(cell_size))
        # Resolve the active character ramp.
        if preset != "custom":
            chars = _ASCII_PRESETS.get(preset, _ASCII_DEFAULT)
        else:
            chars = characters if (characters and len(characters) >= 2) else _ASCII_DEFAULT
        n = len(chars)

        b, h, w, c = image.shape

        # Apply grid offset by rolling the image. This shifts which pixels fall
        # into which cell — visually equivalent to translating the glyph grid.
        ox, oy = int(pos_x) % w, int(pos_y) % h
        if ox or oy:
            shifted = torch.roll(image, shifts=(oy, ox), dims=(1, 2))
        else:
            shifted = image

        # Crop to a multiple of cell to keep the grid clean.
        h2, w2 = (h // cell) * cell, (w // cell) * cell
        cropped = shifted[:, :h2, :w2, :]

        luma = 0.2126 * cropped[..., 0] + 0.7152 * cropped[..., 1] + 0.0722 * cropped[..., 2]
        avg_luma = F.avg_pool2d(luma.unsqueeze(1), kernel_size=cell).squeeze(1)  # [B, sh, sw]

        # Gamma adjustment shapes which characters dominate.
        if abs(gamma - 1.0) > 1e-3:
            avg_luma = avg_luma.clamp(0, 1).pow(float(gamma))

        # Map luma → character index. By default dark cell → dense char (#).
        # invert_order flips so bright cell → dense char.
        if invert_order:
            idx_f = avg_luma * (n - 1)
        else:
            idx_f = (1.0 - avg_luma) * (n - 1)
        # Phase rotates the index through the ramp.
        idx_f = idx_f + float(phase) * (n - 1)
        idx = idx_f.round().long() % n

        bitmaps = _ascii_bitmaps(cell, chars, cropped.device, cropped.dtype)  # [N, cell, cell]
        chosen = bitmaps[idx]  # [B, sh, sw, cell, cell]
        glyph_mask = chosen.permute(0, 1, 3, 2, 4).reshape(b, h2, w2)  # [B, H, W]

        if color_mode == "texture":
            avg_color = F.avg_pool2d(cropped.permute(0, 3, 1, 2), kernel_size=cell)
            avg_color = F.interpolate(avg_color, size=(h2, w2), mode="nearest")
            tint = avg_color.permute(0, 2, 3, 1)
            glyph = glyph_mask.unsqueeze(-1) * tint
        else:
            # monochrome: bright glyphs.
            glyph = glyph_mask.unsqueeze(-1).expand(-1, -1, -1, 3)

        # Compose glyph layer onto a background.
        if background:
            # White bg for default (dark glyphs need inverting), black bg for
            # monochrome bright glyphs in invert_order mode, source color for texture.
            if color_mode == "texture":
                bg_layer = torch.ones_like(glyph) * 0.0  # texture tints on black
                ascii_layer = glyph
            elif invert_order:
                bg_layer = torch.zeros_like(glyph)
                ascii_layer = glyph  # bright glyphs on black
            else:
                bg_layer = torch.ones_like(glyph)
                ascii_layer = bg_layer - glyph  # dark glyphs on white
        else:
            bg_layer = torch.zeros_like(glyph)
            ascii_layer = glyph

        out = ascii_layer if background else (bg_layer + ascii_layer)

        # Pad back to original size if we cropped odd remainders.
        if (h2, w2) != (h, w):
            pad_v = 1.0 if (background and color_mode != "texture" and not invert_order) else 0.0
            padded = torch.full_like(image, pad_v)
            padded[:, :h2, :w2, :] = out
            out = padded

        # Roll back so the result aligns with the original image.
        if ox or oy:
            out = torch.roll(out, shifts=(-oy, -ox), dims=(1, 2))

        out = out.clamp(0, 1)

        # Apply blend mode against the original image, then mix.
        blended = _apply_blend(image, out, blend_mode)
        if mix < 0.999:
            blended = image * (1.0 - mix) + blended * mix

        blended = blended.clamp(0, 1)
        return IO.NodeOutput(blended, ui=save_live_preview(blended, str(cls.hidden.unique_id)))


class StylizeExtension(ComfyExtension):
    @override
    async def get_node_list(self) -> list[type[IO.ComfyNode]]:
        return [KuwaharaNode, CrossHatchNode, DitherNode, AsciiNode]


async def comfy_entrypoint() -> StylizeExtension:
    return StylizeExtension()
