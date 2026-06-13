"""Unit tests for comfy_extras._lens (pure-torch render math; no model/IO)."""
import torch

from comfy_extras import _lens


def test_coc_zero_at_focus_and_monotonic():
    depth = torch.tensor([[0.0, 0.25, 0.5, 0.75, 1.0]])
    coc = _lens.circle_of_confusion(depth, focus=0.5, aperture=0.5)
    assert float(coc[0, 2]) == 0.0                      # at the focus plane → sharp
    assert coc[0, 0] > 0 and coc[0, 4] > 0              # far from focus → blurred
    assert coc[0, 0] >= coc[0, 1]                       # monotonic with distance


def test_coc_grows_with_aperture():
    depth = torch.zeros(1, 1)
    small = _lens.circle_of_confusion(depth, focus=1.0, aperture=0.2)
    big = _lens.circle_of_confusion(depth, focus=1.0, aperture=0.9)
    assert float(big[0, 0]) > float(small[0, 0])


def test_bokeh_kernel_normalized_and_shaped():
    k = _lens.bokeh_kernel("circular", 4)
    assert abs(float(k.sum()) - 1.0) < 1e-5            # normalized
    ana = _lens.bokeh_kernel("anamorphic", 6)
    # anamorphic spreads wider horizontally than vertically
    assert (ana.sum(0) > 0).sum() > (ana.sum(1) > 0).sum()


def test_render_dof_focused_is_sharp():
    img = torch.rand(1, 16, 16, 3)
    coc = torch.zeros(16, 16)                           # everything in focus
    out = _lens.render_dof(img, coc, bokeh_shape="circular", highlight_bokeh=0.0)
    assert torch.allclose(out, img, atol=1e-4)


def test_render_dof_blurs_when_out_of_focus():
    img = torch.rand(1, 32, 32, 3)
    coc = torch.full((32, 32), 6.0)                     # everything heavily blurred
    out = _lens.render_dof(img, coc, bokeh_shape="circular", highlight_bokeh=0.0)
    # local variance drops when blurred
    assert out.var().item() < img.var().item()


def test_render_dof_point_light_spreads():
    img = torch.zeros(1, 32, 32, 3)
    img[0, 16, 16, :] = 1.0            # single bright pixel
    coc = torch.full((32, 32), 6.0)
    out = _lens.render_dof(img, coc, bokeh_shape="circular")
    assert out[0, 16, 16, 0] < 0.5             # center dimmed — energy spread out
    assert out[0, 12:21, 12:21, :].sum() > 0.8  # energy lands in the disc region


def test_bokeh_kernel_hexagonal_normalized_and_shaped():
    k = _lens.bokeh_kernel("hexagonal", 5)
    assert abs(float(k.sum()) - 1.0) < 1e-5    # normalized
    assert k[5].sum() >= k[:, 5].sum()          # flat-top: middle row at least as wide as middle col
