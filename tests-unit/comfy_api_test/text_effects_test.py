from comfy_api_nodes.text_effects import (
    EFFECTS,
    EFFECTS_BY_ID,
    DEFAULT_EFFECT_ID,
    build_edit_prompt,
    _EDIT_PRESERVE_SUFFIX,
)


def test_every_effect_has_nonempty_edit_template():
    missing = [e.id for e in EFFECTS if not (e.edit_template or "").strip()]
    assert missing == [], f"effects missing edit_template: {missing}"


def test_build_edit_prompt_appends_preserve_suffix():
    p = build_edit_prompt("liquid-chrome")
    assert EFFECTS_BY_ID["liquid-chrome"].edit_template in p
    assert _EDIT_PRESERVE_SUFFIX in p


def test_build_edit_prompt_falls_back_on_unknown_id():
    p = build_edit_prompt("does-not-exist")
    assert EFFECTS_BY_ID[DEFAULT_EFFECT_ID].edit_template in p
    assert _EDIT_PRESERVE_SUFFIX in p
