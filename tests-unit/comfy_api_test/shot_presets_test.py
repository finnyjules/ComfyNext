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


from comfy_api_nodes.shot_presets import (  # noqa: E402
    build_shot_phrase,
    dialect_for_model,
    resolve_recipe,
)


def test_resolve_all_auto_returns_preset_unchanged():
    r = resolve_recipe("push-in", AUTO, AUTO, AUTO, AUTO, AUTO)
    p = PRESETS_BY_ID["push-in"]
    assert (r.size, r.angle, r.movement, r.lens, r.composition) == \
           (p.size, p.angle, p.movement, p.lens, p.composition)


def test_resolve_override_replaces_exactly_one_dimension():
    r = resolve_recipe("push-in", "wide shot", AUTO, AUTO, AUTO, AUTO)
    p = PRESETS_BY_ID["push-in"]
    assert r.size == "wide shot"
    assert (r.angle, r.movement, r.lens, r.composition) == \
           (p.angle, p.movement, p.lens, p.composition)


def test_resolve_unknown_preset_falls_back_to_default():
    r = resolve_recipe("does-not-exist", AUTO, AUTO, AUTO, AUTO, AUTO)
    assert r.id == DEFAULT_PRESET_ID


def test_standard_phrase_contains_recipe_terms():
    phrase = build_shot_phrase(PRESETS_BY_ID["push-in"], "standard")
    assert "medium close-up" in phrase
    assert "dollies in" in phrase
    assert "50mm" in phrase
    assert "quiet tension" in phrase


def test_veo_dialect_leads_with_lens():
    phrase = build_shot_phrase(PRESETS_BY_ID["push-in"], "veo")
    assert phrase.lower().startswith("50mm")


def test_hailuo_dialect_prefixes_bracket_commands():
    phrase = build_shot_phrase(PRESETS_BY_ID["push-in"], "hailuo")
    assert phrase.startswith("[Push in]")


def test_hailuo_dolly_zoom_combines_commands():
    phrase = build_shot_phrase(PRESETS_BY_ID["dolly-zoom"], "hailuo")
    assert phrase.startswith("[Push in, Zoom out]")


def test_hailuo_static_preset_uses_static_shot():
    phrase = build_shot_phrase(PRESETS_BY_ID["locked-off"], "hailuo")
    assert phrase.startswith("[Static shot]")


def test_unknown_dialect_falls_back_to_standard():
    std = build_shot_phrase(PRESETS_BY_ID["push-in"], "standard")
    assert build_shot_phrase(PRESETS_BY_ID["push-in"], "nope") == std


def test_dialect_for_model():
    assert dialect_for_model("veo-3.1") == "veo"
    assert dialect_for_model("veo-3.1-fast") == "veo"
    assert dialect_for_model("hailuo-2.3") == "hailuo"
    assert dialect_for_model("kling-v2.5-turbo-pro") == "standard"
    assert dialect_for_model("unknown-model") == "standard"
