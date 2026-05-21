"""Text-to-image-batch node — produces a clip that the Timeline can stack as
an overlay. Output is an RGB IMAGE batch (Comfy's only image type), so a black
background renders fine in Timeline's `screen` or `add` blend mode for
text-on-transparent semantics.
"""
from __future__ import annotations

import numpy as np
import torch
from PIL import Image as PILImage, ImageDraw, ImageFont
from typing_extensions import override

from comfy_api.latest import ComfyExtension, IO


_FONT_PATHS = [
    "/System/Library/Fonts/Supplemental/Helvetica.ttc",
    "/System/Library/Fonts/Helvetica.ttc",
    "/System/Library/Fonts/SFNS.ttf",
    "/System/Library/Fonts/SFNSDisplay.ttf",
    "/Library/Fonts/Arial.ttf",
    "/System/Library/Fonts/Menlo.ttc",
    "/usr/share/fonts/truetype/dejavu/DejaVuSans-Bold.ttf",
    "/usr/share/fonts/truetype/liberation/LiberationSans-Bold.ttf",
]


def _load_font(size: int):
    for p in _FONT_PATHS:
        try:
            return ImageFont.truetype(p, size)
        except (OSError, IOError):
            continue
    return ImageFont.load_default()


def _hex_rgb(s: str, fallback=(0.0, 0.0, 0.0)) -> tuple[float, float, float]:
    s = s.strip().lstrip("#")
    if len(s) == 3:
        s = "".join(c * 2 for c in s)
    if len(s) != 6:
        return fallback
    try:
        return (int(s[0:2], 16) / 255.0, int(s[2:4], 16) / 255.0, int(s[4:6], 16) / 255.0)
    except ValueError:
        return fallback


def _wrap(text: str, draw: ImageDraw.ImageDraw, font, max_w: float) -> list[str]:
    """Word-wrap `text` to fit `max_w` pixels."""
    lines: list[str] = []
    for raw_line in text.splitlines() or [""]:
        words = raw_line.split(" ")
        cur = ""
        for w in words:
            trial = cur + (" " if cur else "") + w
            bbox = draw.textbbox((0, 0), trial, font=font)
            if (bbox[2] - bbox[0]) <= max_w or not cur:
                cur = trial
            else:
                lines.append(cur)
                cur = w
        lines.append(cur)
    return lines


def render_text_to_pil(
    text: str,
    width: int,
    height: int,
    font_size: int,
    color: str,
    bg_color: str,
    align: str = "center",
    v_align: str = "middle",
    padding: float = 0.06,
    line_spacing: float = 1.2,
) -> PILImage.Image:
    """Render a single text-overlay frame as a PIL Image (RGB).

    Shared by `TextClipNode.execute` and the FFmpeg-direct Timeline renderer,
    so both paths produce visually identical text.
    """
    W, H = int(width), int(height)
    fr, fg, fb = _hex_rgb(color, (1, 1, 1))
    br, bg, bb = _hex_rgb(bg_color, (0, 0, 0))

    img = PILImage.new("RGB", (W, H), color=(int(br * 255), int(bg * 255), int(bb * 255)))
    draw = ImageDraw.Draw(img)
    font = _load_font(int(font_size))

    inset_x = int(W * float(padding))
    inset_y = int(H * float(padding))
    max_w = W - 2 * inset_x

    lines = _wrap(text or "", draw, font, max_w)
    sample_bbox = draw.textbbox((0, 0), "Ag", font=font)
    line_h = (sample_bbox[3] - sample_bbox[1]) * float(line_spacing)
    block_h = max(1.0, line_h * len(lines))

    if v_align == "top":
        y = inset_y
    elif v_align == "bottom":
        y = H - inset_y - block_h
    else:
        y = (H - block_h) / 2.0

    fill = (int(fr * 255), int(fg * 255), int(fb * 255))
    for line in lines:
        bb_ = draw.textbbox((0, 0), line, font=font)
        tw = bb_[2] - bb_[0]
        if align == "center":
            x = (W - tw) / 2.0
        elif align == "right":
            x = W - inset_x - tw
        else:
            x = inset_x
        draw.text((x, y), line, fill=fill, font=font)
        y += line_h
    return img


class TextClipNode(IO.ComfyNode):
    """Render text as an IMAGE batch — drop it into a Timeline clip slot."""
    @classmethod
    def define_schema(cls):
        return IO.Schema(
            node_id="TextClip",
            display_name="Text Clip",
            description="Render text as a video clip you can drop into a Timeline.",
            category="video",
            inputs=[
                IO.String.Input("text", default="Sample text", multiline=True),
                IO.Int.Input("width", default=1280, min=64, max=4096, step=8),
                IO.Int.Input("height", default=720, min=64, max=4096, step=8),
                IO.Int.Input("frame_count", default=30, min=1, max=10000, step=1,
                            tooltip="How many frames this clip lasts. Timeline can trim/extend."),
                IO.Int.Input("font_size", default=72, min=8, max=512, step=1),
                IO.String.Input("color", default="#ffffff",
                               tooltip="Text fill color."),
                IO.String.Input("bg_color", default="#000000",
                               tooltip="Background color. Pair with Timeline blend=screen/add for transparent text."),
                IO.Combo.Input("align", options=["center", "left", "right"], default="center"),
                IO.Combo.Input("v_align", options=["middle", "top", "bottom"], default="middle"),
                IO.Float.Input("padding", default=0.06, min=0.0, max=0.4, step=0.01,
                              tooltip="Inset from the canvas edges as a fraction (0..1)."),
                IO.Float.Input("line_spacing", default=1.2, min=0.8, max=2.5, step=0.05),
            ],
            outputs=[IO.Image.Output(display_name="frames")],
        )

    @classmethod
    def execute(cls, text, width, height, frame_count, font_size, color,
                bg_color, align, v_align, padding, line_spacing) -> IO.NodeOutput:
        img = render_text_to_pil(
            text=text, width=int(width), height=int(height),
            font_size=int(font_size), color=color, bg_color=bg_color,
            align=align, v_align=v_align,
            padding=float(padding), line_spacing=float(line_spacing),
        )
        T = max(1, int(frame_count))
        arr = np.asarray(img, dtype=np.uint8).copy()
        t = torch.from_numpy(arr).to(torch.float32) / 255.0
        frames = t.unsqueeze(0).expand(T, -1, -1, -1).contiguous()
        return IO.NodeOutput(frames)


class TextNode(IO.ComfyNode):
    """Editable text passthrough — wire any STRING source in, see and tweak
    the value in the widget, emit downstream.

    Designed for LLM-edit workflows: plug a Claude/Gemini/Whisper-style STRING
    output into `source`, run the prompt, the upstream value flows through.
    When you want to override or hand-author, type into the `text` widget —
    typed content always wins over the upstream source.
    """

    @classmethod
    def define_schema(cls):
        return IO.Schema(
            node_id="Text",
            display_name="Text",
            description="Edit or pass through a STRING. Wire an LLM (Claude / Gemini / Whisper) into "
                        "`source`; type into `text` to override; output is the effective value.",
            category="text",
            inputs=[
                IO.String.Input(
                    "text",
                    default="",
                    multiline=True,
                    tooltip="Type the text you want to emit. Leave empty to fall through to whatever's "
                            "wired into `source`. Typed content always wins.",
                ),
                IO.String.Input(
                    "source",
                    optional=True,
                    force_input=True,
                    tooltip="Optional upstream STRING. Used as the output when the `text` widget is empty. "
                            "Wire a Claude / Gemini / Whisper / any STRING-producing node here.",
                ),
            ],
            outputs=[IO.String.Output(display_name="text")],
        )

    @classmethod
    def execute(cls, text, source=None) -> IO.NodeOutput:
        # Widget content beats upstream so the user can hand-author / edit
        # without disconnecting the wire. Empty widget falls through.
        value = text if (text and text.strip()) else (source or "")
        return IO.NodeOutput(value)


class TextExtension(ComfyExtension):
    @override
    async def get_node_list(self) -> list[type[IO.ComfyNode]]:
        return [TextClipNode, TextNode]


async def comfy_entrypoint() -> TextExtension:
    return TextExtension()
