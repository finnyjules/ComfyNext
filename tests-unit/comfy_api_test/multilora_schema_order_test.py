"""Guard test for FluxMultiLoRARemoteNode schema ordering.

CRITICAL CONTRACT: Sailor stores a node's widget values as a POSITIONAL array.
The frontend's realignWidgetValues function pads this array by LENGTH, not by
name. Any new input inserted BEFORE an existing one shifts every saved value
after it onto the wrong widget (e.g. a user's seed value landing in a scale
field). This is a silent corruption — no error, just wrong values.

The six newest inputs (lora_c, lora_c_url, scale_c, lora_d, lora_d_url,
scale_d) were therefore deliberately placed LAST in the schema, after
prompt_strength. Future slots must also be appended here, never inserted
earlier. This test verifies that contract against the ACTUAL schema.
"""
import pytest

# Pre-import the util shim so nodes_replicate imports cleanly (pre-existing
# utils/install_util sys.path shadow; required for ComfyUI server import).
import utils.install_util  # noqa: F401
from comfy_api_nodes.nodes_replicate import (
    FluxMultiLoRARemoteNode,
    GenerateImageNode,
    _fold_prompt_in,
)


def test_multilora_c_d_inputs_stay_last():
    """C/D slot inputs must appear after ALL non-C/D inputs to prevent
    positional widget_values corruption in saved workflows.

    Task B4's style_in/prompt_in are excluded from the "prior" set: they are
    APPENDED after C/D and are socket-only (TASTE / force_input — no
    widgets_values slot), so they cannot shift saved positional values. The
    dedicated B4 tests below pin their placement and socket-only nature."""
    schema = FluxMultiLoRARemoteNode.define_schema()
    input_ids = [inp.id for inp in schema.inputs if inp.id not in ("style_in", "prompt_in")]

    # Identify C/D inputs by their names.
    cd_inputs = {"lora_c", "lora_c_url", "scale_c", "lora_d", "lora_d_url", "scale_d"}
    non_cd_inputs = set(input_ids) - cd_inputs

    # Find the minimum index of any C/D input and the maximum index of any
    # non-C/D input. C/D inputs MUST come after non-C/D inputs.
    cd_indices = [i for i, inp_id in enumerate(input_ids) if inp_id in cd_inputs]
    non_cd_indices = [i for i, inp_id in enumerate(input_ids) if inp_id in non_cd_inputs]

    if cd_indices and non_cd_indices:
        min_cd_index = min(cd_indices)
        max_non_cd_index = max(non_cd_indices)
        assert min_cd_index > max_non_cd_index, (
            f"C/D inputs must be appended LAST to prevent positional widget_values "
            f"corruption. First C/D input '{input_ids[min_cd_index]}' at index {min_cd_index} "
            f"comes before last non-C/D input '{input_ids[max_non_cd_index]}' at index "
            f"{max_non_cd_index}. New inputs must be appended, never inserted."
        )


def test_multilora_picker_slot_order():
    """The four LoRA picker widgets (lora_a, lora_b, lora_c, lora_d) must
    appear in that exact order so the node body renders slots A, B, C, D
    in the correct sequence."""
    schema = FluxMultiLoRARemoteNode.define_schema()
    input_ids = [inp.id for inp in schema.inputs]

    picker_slots = ["lora_a", "lora_b", "lora_c", "lora_d"]
    picker_indices = [input_ids.index(slot) for slot in picker_slots]

    # Indices must be strictly increasing.
    for i in range(len(picker_indices) - 1):
        assert picker_indices[i] < picker_indices[i + 1], (
            f"LoRA picker slots must appear in A, B, C, D order. "
            f"Found {picker_slots[i]} at index {picker_indices[i]} "
            f"and {picker_slots[i + 1]} at index {picker_indices[i + 1]}."
        )


def test_generate_image_style_inputs_stay_last():
    """GenerateImageNode's moodboard inputs (style_block, style_refs — Plan B
    Task B2) must appear strictly AFTER every pre-existing input. The
    frontend stores widget values positionally; inserting either input
    mid-schema would silently shift saved values onto the wrong widgets.

    Task B4's style_in/prompt_in (appended after these, socket-only — no
    widgets_values slot) are excluded; the B4 tests below own their order."""
    schema = GenerateImageNode.define_schema()
    input_ids = [inp.id for inp in schema.inputs if inp.id not in ("style_in", "prompt_in")]

    style_inputs = {"style_block", "style_refs"}
    assert style_inputs <= set(input_ids), (
        f"GenerateImageNode must declare style_block and style_refs; got {input_ids}"
    )

    style_indices = [i for i, inp_id in enumerate(input_ids) if inp_id in style_inputs]
    prior_indices = [i for i, inp_id in enumerate(input_ids) if inp_id not in style_inputs]

    assert min(style_indices) > max(prior_indices), (
        f"style_block/style_refs must be appended LAST to prevent positional "
        f"widget_values corruption. First style input "
        f"'{input_ids[min(style_indices)]}' at index {min(style_indices)} comes "
        f"before pre-existing input '{input_ids[max(prior_indices)]}' at index "
        f"{max(prior_indices)}. New inputs must be appended, never inserted."
    )
    # style_block before style_refs, so their own relative order can't drift.
    assert input_ids.index("style_block") < input_ids.index("style_refs")


def test_generate_image_style_inputs_are_optional_internal():
    """Both style inputs are optional, hidden (`sailor_widget: internal`)
    STRING widgets — the moodboard chip writes them via properties + the
    submit-time injector, never a visible node control."""
    schema = GenerateImageNode.define_schema()
    by_id = {inp.id: inp for inp in schema.inputs}
    for name in ("style_block", "style_refs"):
        inp = by_id[name]
        assert inp.optional is True, f"{name} must be optional"
        assert (inp.extra_dict or {}).get("sailor_widget") == "internal", (
            f"{name} must carry sailor_widget: internal"
        )


# ── Task B4: the taste wire (style_in) + the Idea socket (prompt_in) ─────────
#
# Both generators gain APPENDED socket-only inputs. The load-bearing contract:
# neither input may occupy a widgets_values slot — TASTE is not a widget
# primitive, and prompt_in is force_input STRING (widgetOrder.ts:28 treats
# forceInput as connection-only). `_widget_ids` mirrors the frontend's
# isWidgetInput rule so the widget COUNT (and order) is pinned here.

# Mirror of frontend/app/lib/graph/widgetOrder.ts isWidgetInput: a widget iff
# the io_type is a widget primitive AND the input is not force_input.
_WIDGET_IO_TYPES = {"INT", "FLOAT", "STRING", "BOOLEAN", "COMBO"}


def _widget_ids(schema):
    return [
        inp.id
        for inp in schema.inputs
        if not getattr(inp, "force_input", None) and inp.io_type in _WIDGET_IO_TYPES
    ]


def test_b4_wire_inputs_appended_last_on_both_generators():
    """style_in + prompt_in must appear strictly AFTER every pre-existing
    input on both generators (append-only schema contract), style_in first."""
    for node_cls in (FluxMultiLoRARemoteNode, GenerateImageNode):
        schema = node_cls.define_schema()
        input_ids = [inp.id for inp in schema.inputs]
        wire_inputs = {"style_in", "prompt_in"}
        assert wire_inputs <= set(input_ids), (
            f"{schema.node_id} must declare style_in and prompt_in; got {input_ids}"
        )
        wire_indices = [i for i, n in enumerate(input_ids) if n in wire_inputs]
        prior_indices = [i for i, n in enumerate(input_ids) if n not in wire_inputs]
        assert min(wire_indices) > max(prior_indices), (
            f"{schema.node_id}: style_in/prompt_in must be appended LAST. "
            f"First wire input '{input_ids[min(wire_indices)]}' at index "
            f"{min(wire_indices)} comes before pre-existing input "
            f"'{input_ids[max(prior_indices)]}' at index {max(prior_indices)}."
        )
        assert input_ids.index("style_in") < input_ids.index("prompt_in")


def test_b4_wire_inputs_are_socket_only():
    """style_in is the custom TASTE type (socket by nature); prompt_in is a
    force_input STRING (socket by flag). Both optional."""
    for node_cls in (FluxMultiLoRARemoteNode, GenerateImageNode):
        schema = node_cls.define_schema()
        by_id = {inp.id: inp for inp in schema.inputs}
        style_in = by_id["style_in"]
        assert style_in.io_type == "TASTE", (
            f"{schema.node_id}: style_in must be the TASTE wire type"
        )
        assert style_in.optional is True
        prompt_in = by_id["prompt_in"]
        assert prompt_in.io_type == "STRING"
        assert prompt_in.force_input is True, (
            f"{schema.node_id}: prompt_in must be force_input — a plain STRING "
            "would claim a widgets_values slot and shift saved values."
        )
        assert prompt_in.optional is True


def test_b4_widget_count_unchanged():
    """force_input / TASTE inputs occupy NO widgets_values slots: the widget
    list of both generators must be EXACTLY the pre-B4 list (names + order).
    A regression here silently corrupts every saved workflow."""
    assert _widget_ids(GenerateImageNode.define_schema()) == [
        "model", "prompt", "aspect_ratio", "seed", "model_options",
        "style_block", "style_refs",
    ]
    assert _widget_ids(FluxMultiLoRARemoteNode.define_schema()) == [
        "prompt",
        "lora_a", "lora_a_url", "scale_a",
        "lora_b", "lora_b_url", "scale_b",
        "aspect_ratio", "num_inference_steps", "guidance", "seed",
        "prompt_strength",
        "lora_c", "lora_c_url", "scale_c",
        "lora_d", "lora_d_url", "scale_d",
    ]


def test_b4_prompt_in_fold_rule():
    """The ONE shared prompt_in rule (documented at _fold_prompt_in): joins
    ahead of the widget prompt; replaces it only when the widget is empty."""
    assert _fold_prompt_in("a red kite", "") == "a red kite"
    assert _fold_prompt_in("a red kite", "  ") == "a red kite"
    assert _fold_prompt_in("", "windy beach at dawn") == "windy beach at dawn"
    assert _fold_prompt_in("   ", "windy beach at dawn") == "windy beach at dawn"
    assert _fold_prompt_in("a red kite", "windy beach at dawn") == (
        "windy beach at dawn a red kite"
    )
