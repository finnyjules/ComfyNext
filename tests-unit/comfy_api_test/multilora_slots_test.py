"""Pure tests for multi-LoRA slot collection.

Lives against `replicate_refs` (not `nodes_replicate`) because that module is
dependency-light and imports without ComfyUI's `server` chain — no sys.path
shim needed, unlike lipsync_node_test.py / fal_dispatch_test.py.
"""
from comfy_api_nodes.replicate_refs import _multilora_collect


def test_drops_unresolved_slots_and_their_scales():
    loras, scales = _multilora_collect([("A", 0.9), (None, 0.8), ("C", 0.7)])
    assert loras == ["A", "C"]
    assert scales == [0.9, 0.7]


def test_keeps_scales_paired_to_their_own_slot():
    # The middle slot dropping must not shift C's scale onto A.
    loras, scales = _multilora_collect([(None, 0.9), ("B", 0.8), (None, 0.7), ("D", 0.6)])
    assert loras == ["B", "D"]
    assert scales == [0.8, 0.6]


def test_duplicate_refs_collapse_keeping_the_higher_scale():
    # Same LoRA in two slots would make the list a palindrome, defeating the
    # order-alternation cache defence in execute(). Collapse it.
    loras, scales = _multilora_collect([("X", 0.5), ("Y", 0.8), ("X", 0.9)])
    assert loras == ["X", "Y"]
    assert scales == [0.9, 0.8]


def test_duplicate_collapse_preserves_first_seen_order():
    loras, _ = _multilora_collect([("X", 0.9), ("Y", 0.8), ("X", 0.1)])
    assert loras == ["X", "Y"]


def test_all_empty_yields_empty_lists():
    # execute() relies on this to raise its "No LoRAs resolved" error.
    assert _multilora_collect([(None, 0.9), (None, 0.8)]) == ([], [])


def test_empty_string_ref_counts_as_unresolved():
    loras, scales = _multilora_collect([("", 0.9), ("B", 0.8)])
    assert loras == ["B"]
    assert scales == [0.8]


def test_deduped_list_is_never_a_palindrome():
    # The property the cache defence depends on: reversing a deduped list of
    # 2+ distinct entries always produces a different list.
    loras, _ = _multilora_collect([("X", 0.9), ("Y", 0.8), ("X", 0.7)])
    assert len(loras) >= 2
    assert list(reversed(loras)) != loras
