from comfy_api_nodes.text_effects import (
    EFFECTS,
    EFFECTS_BY_ID,
    DEFAULT_EFFECT_ID,
    build_edit_prompt,
    build_text_effect_request,
    _EDIT_PRESERVE_SUFFIX,
)

# Effects that disperse — they carry a `medium` and break apart with freedom.
DISPERSION_IDS = ["ink-in-water", "smoke-vapor", "light-trails"]


def test_every_effect_has_nonempty_edit_template():
    missing = [e.id for e in EFFECTS if not (e.edit_template or "").strip()]
    assert missing == [], f"effects missing edit_template: {missing}"


def test_build_edit_prompt_appends_preserve_suffix():
    # liquid-chrome is material (no medium) → always exact-preserve, even at high
    # freedom, with the default freedom=None (its default_freedom is 0).
    p = build_edit_prompt("liquid-chrome")
    assert EFFECTS_BY_ID["liquid-chrome"].edit_template in p
    assert _EDIT_PRESERVE_SUFFIX in p


def test_build_edit_prompt_falls_back_on_unknown_id():
    p = build_edit_prompt("does-not-exist")
    assert EFFECTS_BY_ID[DEFAULT_EFFECT_ID].edit_template in p
    assert _EDIT_PRESERVE_SUFFIX in p


# ----- freedom dial ---------------------------------------------------------

def test_dispersion_effects_have_medium_and_nonzero_default_freedom():
    for eid in DISPERSION_IDS:
        eff = EFFECTS_BY_ID[eid]
        assert eff.medium.strip(), f"{eid} should set a dispersion medium"
        assert eff.default_freedom > 0, f"{eid} should default to breaking apart"


def test_material_effects_have_no_medium_and_zero_default_freedom():
    for eff in EFFECTS:
        if eff.id in DISPERSION_IDS:
            continue
        assert eff.medium == "", f"{eff.id} is material — no medium expected"
        assert eff.default_freedom == 0.0


def test_material_effect_ignores_high_freedom():
    # Even forced to max freedom, a material effect must stay exact-preserve
    # (it has no medium to disperse into).
    p = build_edit_prompt("liquid-chrome", freedom=1.0)
    assert _EDIT_PRESERVE_SUFFIX in p


def test_dispersion_effect_grades_with_freedom():
    # NB: the dispersion medium phrase also appears in the effect's material
    # edit_template, so presence of `medium` isn't the signal — the *clause*
    # (preserve suffix vs. break-apart language) is.
    eid = "ink-in-water"
    low = build_edit_prompt(eid, freedom=0.0)
    mid = build_edit_prompt(eid, freedom=0.55)
    high = build_edit_prompt(eid, freedom=1.0)
    # freedom 0 → exact preserve, no break-apart language.
    assert _EDIT_PRESERVE_SUFFIX in low
    assert "break" not in low and "come apart" not in low
    # mid/high → preserve suffix dropped, letters told to break apart.
    assert _EDIT_PRESERVE_SUFFIX not in mid
    assert _EDIT_PRESERVE_SUFFIX not in high
    assert "break apart and trail off" in mid
    assert "come apart" in high
    # the three bands are distinct.
    assert low != mid != high != low


def test_build_edit_prompt_default_freedom_uses_effect_value():
    # freedom=None → the dispersion effect's own default (0.65) → dispersing.
    eid = "ink-in-water"
    p = build_edit_prompt(eid)  # freedom defaults to None → eff.default_freedom
    assert EFFECTS_BY_ID[eid].medium in p
    assert _EDIT_PRESERVE_SUFFIX not in p


def test_freedom_only_affects_restyle_mode():
    # Generate mode (no image) never consults freedom — dispersion lives in the
    # prompt_template there. The request prompt should be the text-to-image one.
    slug, inp = build_text_effect_request(
        "ink-in-water", "GHOST", "1:1", seed=0, image_data_url=None, freedom=1.0,
    )
    assert "{TEXT}" not in inp["prompt"]
    assert "GHOST" in inp["prompt"]            # word substituted into generate template
    assert _EDIT_PRESERVE_SUFFIX not in inp["prompt"]  # not an edit prompt at all


def test_freedom_threads_into_restyle_request():
    slug, inp = build_text_effect_request(
        "ink-in-water", "", "Match input", seed=0,
        image_data_url="data:image/png;base64,xxx", freedom=1.0,
    )
    assert EFFECTS_BY_ID["ink-in-water"].medium in inp["prompt"]
    assert _EDIT_PRESERVE_SUFFIX not in inp["prompt"]
