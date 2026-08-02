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
from comfy_api_nodes.nodes_replicate import FluxMultiLoRARemoteNode


def test_multilora_c_d_inputs_stay_last():
    """C/D slot inputs must appear after ALL non-C/D inputs to prevent
    positional widget_values corruption in saved workflows."""
    schema = FluxMultiLoRARemoteNode.define_schema()
    input_ids = [inp.id for inp in schema.inputs]

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
