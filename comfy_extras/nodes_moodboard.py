"""Moodboard — the Python twin of the frontend Moodboard pile card
(moodboards Plan B, Task B4).

The Vue canvas owns the moodboard LIBRARY (entries live app-side under
frontend user data; the node only references one by id). This twin exists so
the TASTE wire is real: with a backend class_type registered, the Moodboard
node survives `stripFrontendOnlyNodes`, serializes through `graphToPrompt`
untouched, and its `style` output can wire into a generator's `style_in`.

State travels in two hidden STRING widgets the frontend syncs by name
(see `syncMoodboardWidgets` in frontend/app/lib/graph/moodboardApply.ts):
  reading_json — the board's Fable reading `{summary, palette[], avoids[]}`
  moodboard_id — the library entry id (provenance only; not used to compile)

`execute` compiles the reading into the spec style block. The composition is
a Python port of `moodboardStyleBlock` (frontend/app/lib/taste/styleBlock.ts)
and MUST produce byte-identical strings — both sides are pinned against the
shared fixtures in tests-unit/comfy_api_test/fixtures/ (Python:
moodboard_style_block_test.py; TS: taste-style-block.unit.spec.ts).

v1 ships the `style` output ONLY — the board's image output is deferred to
@refs in Task B5 (plan decision note).
"""

from __future__ import annotations

import json

from typing_extensions import override

from comfy_api.latest import ComfyExtension, IO

# The taste wire's link type. IO.Custom types match by io_type string, so the
# consumers in comfy_api_nodes/nodes_replicate.py declare their own
# IO.Custom("TASTE") — same string, same wire.
TasteType = IO.Custom("TASTE")


def moodboard_style_block(reading) -> str:
    """Python port of `moodboardStyleBlock` (frontend styleBlock.ts) — the
    moodboard spec block:
    `In the style of: <summary>. Palette: <Name #HEX, …>. Avoid: <a, b>.`

    Empty parts are omitted entirely (no dangling labels). The output string
    must stay IDENTICAL to the TS composition — the shared-fixture parity
    tests on both sides pin it. Tolerates missing keys/shapes (returns partial
    or empty) — a malformed reading must degrade, not raise.
    """
    if not isinstance(reading, dict):
        return ""
    parts: list[str] = []

    summary = str(reading.get("summary") or "").strip()
    if summary:
        # TS: summary.trim().replace(/\.?$/, '.') — exactly one '.' appended
        # unless the (single) final character already is one.
        dotted = summary if summary.endswith(".") else summary + "."
        parts.append(f"In the style of: {dotted}")

    palette = reading.get("palette")
    if isinstance(palette, list) and palette:
        swatches = ", ".join(
            f"{p.get('name', '')} {p.get('hex', '')}"
            for p in palette
            if isinstance(p, dict)
        )
        parts.append(f"Palette: {swatches}.")

    avoids = reading.get("avoids")
    if isinstance(avoids, list) and avoids:
        parts.append("Avoid: " + ", ".join(str(a) for a in avoids) + ".")

    return " ".join(parts)


class MoodboardNode(IO.ComfyNode):
    @classmethod
    def define_schema(cls):
        return IO.Schema(
            # node_id must equal the frontend node type ('Moodboard') so the
            # Vue node maps onto this class_type at graphToPrompt time.
            node_id="Moodboard",
            display_name="Moodboard",
            category="image/style",
            description=(
                "A pile of inspiration images with an editable taste reading. "
                "Compiles the reading into a style block — wire the style "
                "output into a generator's style_in."
            ),
            inputs=[
                # Hidden widget (sailor_widget: internal — the Vue face filters
                # it from display; the GenerateImageNode model_options
                # precedent). REQUIRED so it always occupies a widgets_values
                # slot; the frontend writes it by NAME on modal save and when
                # the referenced library entry changes.
                IO.String.Input(
                    "reading_json",
                    default="",
                    multiline=True,
                    extra_dict={"sailor_widget": "internal"},
                    tooltip=(
                        "The board's taste reading as JSON "
                        '({"summary", "palette", "avoids"}) — synced by the '
                        "moodboard modal, not edited by hand."
                    ),
                ),
                IO.String.Input(
                    "moodboard_id",
                    default="",
                    multiline=False,
                    optional=True,
                    extra_dict={"sailor_widget": "internal"},
                    tooltip="Library entry id this node references (provenance).",
                ),
            ],
            # ONE style output (v1). The board's image output is deferred to
            # @refs (Task B5) — see the plan's decision note.
            outputs=[TasteType.Output(display_name="style")],
        )

    @classmethod
    def execute(cls, reading_json, moodboard_id="") -> IO.NodeOutput:
        try:
            reading = json.loads(reading_json) if (reading_json or "").strip() else {}
        except (json.JSONDecodeError, TypeError):
            # A bad payload degrades to an empty block — downstream generators
            # treat an empty style_in as "no style", never a failed run.
            reading = {}
        return IO.NodeOutput(moodboard_style_block(reading))


class MoodboardExtension(ComfyExtension):
    @override
    async def get_node_list(self) -> list[type[IO.ComfyNode]]:
        return [MoodboardNode]


async def comfy_entrypoint() -> MoodboardExtension:
    return MoodboardExtension()
