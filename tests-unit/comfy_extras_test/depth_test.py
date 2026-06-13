"""Unit tests for comfy_extras._depth.

The real Depth Anything V2 model is never loaded here — `_get_depth_model` is
monkeypatched with a fake so we can test normalization, shape, and the
per-image cache without a download or GPU.
"""
import torch

from comfy_extras import _depth


class _FakeModel:
    """Returns a horizontal ramp as 'depth' so we can assert normalization."""
    def __init__(self):
        self.calls = 0

    def infer(self, h, w):
        self.calls += 1
        # raw values 100..200 across width — must be normalized to [0,1]
        row = torch.linspace(100.0, 200.0, w)
        return row.unsqueeze(0).repeat(h, 1)


def _patch(monkeypatch):
    fake = _FakeModel()
    monkeypatch.setattr(_depth, "_run_model", lambda img: fake.infer(img.shape[-3], img.shape[-2]))
    _depth._DEPTH_CACHE.clear()
    return fake


def test_estimate_depth_shape_and_range(monkeypatch):
    _patch(monkeypatch)
    img = torch.rand(1, 12, 16, 3)
    d = _depth.estimate_depth(img)
    assert d.shape == (12, 16)
    assert float(d.min()) >= 0.0 and float(d.max()) <= 1.0
    # normalization spans the full range
    assert float(d.max()) == 1.0 and float(d.min()) == 0.0


def test_estimate_depth_caches_per_image(monkeypatch):
    fake = _patch(monkeypatch)
    img = torch.rand(1, 8, 8, 3)
    _depth.estimate_depth(img)
    _depth.estimate_depth(img)  # identical image → cache hit, model not re-run
    assert fake.calls == 1


def test_estimate_depth_recomputes_for_different_image(monkeypatch):
    fake = _patch(monkeypatch)
    _depth.estimate_depth(torch.zeros(1, 8, 8, 3))
    _depth.estimate_depth(torch.ones(1, 8, 8, 3))
    assert fake.calls == 2


def test_flat_image_returns_zeros(monkeypatch):
    monkeypatch.setattr(_depth, "_run_model", lambda img: torch.full((img.shape[-3], img.shape[-2]), 42.0))
    _depth._DEPTH_CACHE.clear()
    d = _depth.estimate_depth(torch.zeros(1, 4, 4, 3))
    assert float(d.max()) == 0.0 and not d.isnan().any()
