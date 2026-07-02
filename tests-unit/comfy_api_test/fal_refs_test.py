"""Tests for the fal.ai queue client used by FilmShotNode when a video model's
provider is 'fal'. fal uses a two-segment app namespace (bytedance/seedance-2.0)
plus a function (reference-to-video), auth header 'Key <id:secret>', and returns
{"video": {"url": ...}}. A request that completes in <1s with no fetchable result
is a routing no-op, not a success.
"""
import pytest
from comfy_api_nodes import fal_refs


@pytest.fixture
def chdir_repo_root_missing_env(monkeypatch, tmp_path):
    # Make dotenv lookup resolve to an empty dir so no real FAL_KEY leaks in.
    monkeypatch.setattr(fal_refs, "_dotenv_paths", lambda: [str(tmp_path / ".env")])
    yield


def test_first_fal_video_url_extracts():
    assert fal_refs.first_fal_video_url(
        {"video": {"url": "https://v3b.fal.media/x/video.mp4"}}
    ) == "https://v3b.fal.media/x/video.mp4"


def test_first_fal_video_url_raises_on_missing():
    with pytest.raises(RuntimeError):
        fal_refs.first_fal_video_url({"seed": 1})
    with pytest.raises(RuntimeError):
        fal_refs.first_fal_video_url({"video": {}})


def test_get_fal_token_from_env(monkeypatch):
    monkeypatch.setenv("FAL_KEY", "abc:def")
    fal_refs._TOKEN_CACHE = None
    assert fal_refs.get_fal_token() == "abc:def"


def test_get_fal_token_missing_raises(monkeypatch, tmp_path, chdir_repo_root_missing_env):
    monkeypatch.delenv("FAL_KEY", raising=False)
    monkeypatch.delenv("NUXT_FAL_TOKEN", raising=False)
    fal_refs._TOKEN_CACHE = None
    with pytest.raises(RuntimeError, match="fal"):
        fal_refs.get_fal_token()
