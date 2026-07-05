"""Unit tests for comfy_extras._gradient_map — the pure hex/JSON + LUT helpers
behind the Duotone and multi-stop Gradient Map nodes.
"""
import torch

from comfy_extras import _gradient_map as gm


def test_hex_to_rgb_parses_and_falls_back():
    assert gm.hex_to_rgb("#ffffff") == (1.0, 1.0, 1.0)
    assert gm.hex_to_rgb("#000000") == (0.0, 0.0, 0.0)
    assert gm.hex_to_rgb("f00") == (1.0, 0.0, 0.0)          # shorthand
    assert gm.hex_to_rgb("nope", (0.5, 0.5, 0.5)) == (0.5, 0.5, 0.5)


def test_parse_stops_sorts_and_clamps():
    stops = gm.parse_stops('[{"pos":1,"color":"#ffffff"},{"pos":0,"color":"#000000"},{"pos":0.5,"color":"#ff0000"}]')
    assert [p for p, _ in stops] == [0.0, 0.5, 1.0]           # sorted by pos
    assert stops[0][1] == (0.0, 0.0, 0.0)
    assert stops[1][1] == (1.0, 0.0, 0.0)


def test_parse_stops_falls_back_on_garbage():
    assert gm.parse_stops("not json") == gm.DEFAULT_STOPS
    assert gm.parse_stops("[]") == gm.DEFAULT_STOPS
    assert gm.parse_stops('[{"nope":1}]') == gm.DEFAULT_STOPS  # missing keys skipped → default


def test_parse_stops_accepts_a_parsed_list():
    stops = gm.parse_stops([{"pos": 0, "color": "#010101"}, {"pos": 1, "color": "#fefefe"}])
    assert len(stops) == 2 and stops[0][0] == 0.0


def test_parse_duotone():
    assert gm.parse_duotone('{"shadow":"#111111","highlight":"#eeeeee"}') == ("#111111", "#eeeeee")
    assert gm.parse_duotone("garbage") == gm.DEFAULT_DUOTONE


def test_gradient_lut_two_stops_is_linear():
    lut = gm.gradient_lut([(0.0, (0.0, 0.0, 0.0)), (1.0, (1.0, 1.0, 1.0))], n=256)
    assert lut.shape == (256, 3)
    assert torch.allclose(lut[0], torch.zeros(3), atol=1e-6)
    assert torch.allclose(lut[255], torch.ones(3), atol=1e-6)
    assert torch.allclose(lut[127], torch.full((3,), 127 / 255), atol=2e-3)  # mid-grey


def test_gradient_lut_three_stops_hits_the_middle_colour():
    lut = gm.gradient_lut([(0.0, (0.0, 0.0, 0.0)), (0.5, (1.0, 0.0, 0.0)), (1.0, (1.0, 1.0, 1.0))], n=256)
    assert torch.allclose(lut[128], torch.tensor([1.0, 0.0, 0.0]), atol=5e-3)  # red at the midpoint


def test_gradient_lut_single_stop_holds_flat():
    lut = gm.gradient_lut([(0.4, (0.2, 0.4, 0.6))], n=16)
    assert torch.allclose(lut[0], torch.tensor([0.2, 0.4, 0.6]), atol=1e-6)
    assert torch.allclose(lut[-1], torch.tensor([0.2, 0.4, 0.6]), atol=1e-6)


def test_apply_gradient_map_maps_luma_and_respects_mix():
    # A mid-grey image (luma 0.5) through black→red→white → red.
    img = torch.full((1, 4, 4, 3), 0.5)
    stops = '[{"pos":0,"color":"#000000"},{"pos":0.5,"color":"#ff0000"},{"pos":1,"color":"#ffffff"}]'
    out = gm.apply_gradient_map(img, stops, mix=1.0)
    assert torch.allclose(out[0, 0, 0], torch.tensor([1.0, 0.0, 0.0]), atol=5e-3)
    # mix=0 returns the source untouched.
    assert torch.allclose(gm.apply_gradient_map(img, stops, mix=0.0), img, atol=1e-6)


def test_apply_gradient_map_matches_legacy_two_stop():
    # Equivalence with the old shadow*(1-l) + high*l on a luma ramp.
    img = torch.rand(1, 8, 8, 3)
    shadow, high = (0.05, 0.05, 0.20), (1.0, 0.9, 0.5)
    stops = [{"pos": 0, "color": "#0d0d33"}, {"pos": 1, "color": "#ffe680"}]  # ≈ those rgb
    out = gm.apply_gradient_map(img, stops, mix=1.0)
    lu = gm.luma(img).clamp(0, 1)
    c0 = torch.tensor(shadow).view(1, 1, 1, 3)
    c1 = torch.tensor(high).view(1, 1, 1, 3)
    legacy = (c0 * (1 - lu) + c1 * lu).clamp(0, 1)
    # LUT quantises to 256 levels, so allow a small tolerance.
    assert torch.allclose(out, legacy, atol=6e-3)


def test_apply_duotone_maps_black_and_white():
    black = torch.zeros(1, 2, 2, 3)
    white = torch.ones(1, 2, 2, 3)
    raw = '{"shadow":"#000000","highlight":"#ffffff"}'
    assert torch.allclose(gm.apply_duotone(black, raw), black, atol=1e-6)   # luma 0 → shadow
    assert torch.allclose(gm.apply_duotone(white, raw), white, atol=1e-6)   # luma 1 → highlight
