from comfy_api_nodes.shot_presets import (
    AUTO,
    DEFAULT_PRESET_ID,
    PRESETS,
    PRESETS_BY_ID,
    SIZE_OPTIONS,
    ANGLE_OPTIONS,
    MOVEMENT_OPTIONS,
    LENS_OPTIONS,
    COMPOSITION_OPTIONS,
)

VALID_CATEGORIES = {"movement", "angle", "lens", "composition"}


def test_roster_has_28_unique_ids():
    ids = [p.id for p in PRESETS]
    assert len(ids) == 28
    assert len(set(ids)) == 28


def test_every_dimension_nonempty():
    for p in PRESETS:
        for field in ("label", "size", "angle", "movement", "lens", "composition", "note"):
            assert str(getattr(p, field)).strip(), f"{p.id}.{field} is empty"


def test_categories_valid():
    bad = [(p.id, p.category) for p in PRESETS if p.category not in VALID_CATEGORIES]
    assert bad == []


def test_default_preset_exists():
    assert DEFAULT_PRESET_ID == "push-in"
    assert DEFAULT_PRESET_ID in PRESETS_BY_ID


def test_override_option_lists_start_with_auto():
    for opts in (SIZE_OPTIONS, ANGLE_OPTIONS, MOVEMENT_OPTIONS, LENS_OPTIONS, COMPOSITION_OPTIONS):
        assert opts[0] == AUTO
        assert len(opts) > 3
        assert len(set(opts)) == len(opts)
