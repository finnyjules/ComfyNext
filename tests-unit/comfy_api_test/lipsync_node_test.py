"""Pure-logic tests for LipSyncNode: engine resolution + per-engine input shape.
Fabric (veed/fabric-1.0) takes {image,audio,resolution}; sync (sync/lipsync-2-pro)
takes {video,audio,sync_mode}. Auto picks fabric for an image, sync for a video.
"""
import pytest

# Pre-import the util shim so nodes_replicate imports cleanly (pre-existing
# utils/comfy.utils sys.path shadow; see fal_dispatch_test.py).
import utils.install_util  # noqa: F401
from comfy_api_nodes import nodes_replicate as nr
from comfy_api_nodes.nodes_replicate import _lipsync_resolve_engine, _lipsync_build_input

DATA = "data:image/png;base64,x"
AUD = "data:audio/wav;base64,y"


def test_resolve_engine_auto_image_is_fabric():
    assert _lipsync_resolve_engine("auto", has_image=True, has_video=False) == "fabric"


def test_resolve_engine_auto_video_is_sync():
    assert _lipsync_resolve_engine("auto", has_image=False, has_video=True) == "sync"


def test_resolve_engine_manual_override_wins():
    assert _lipsync_resolve_engine("sync", has_image=True, has_video=False) == "sync"
    assert _lipsync_resolve_engine("fabric", has_image=False, has_video=True) == "fabric"


def test_build_fabric_input():
    slug, inp = _lipsync_build_input("fabric", DATA, None, AUD, "720p", "cut_off")
    assert slug == "veed/fabric-1.0"
    assert inp == {"image": DATA, "audio": AUD, "resolution": "720p"}


def test_build_sync_input():
    slug, inp = _lipsync_build_input("sync", None, DATA, AUD, "720p", "loop")
    assert slug == "sync/lipsync-2-pro"
    assert inp == {"video": DATA, "audio": AUD, "sync_mode": "loop"}


def test_build_fabric_requires_image():
    with pytest.raises(RuntimeError, match="image"):
        _lipsync_build_input("fabric", None, None, AUD, "720p", "cut_off")


def test_build_requires_audio():
    with pytest.raises(RuntimeError, match="audio"):
        _lipsync_build_input("fabric", DATA, None, "", "720p", "cut_off")


# --- sync-engine source-video hosting (Replicate Files upload) --------------

@pytest.mark.asyncio
async def test_hosted_video_passthrough_public_url():
    # A public URL is already fetchable by Replicate — no upload.
    assert await nr._lipsync_hosted_video_url("https://x/v.mp4") == "https://x/v.mp4"
    assert await nr._lipsync_hosted_video_url("http://x/v.mp4") == "http://x/v.mp4"
    assert await nr._lipsync_hosted_video_url("") == ""


@pytest.mark.asyncio
async def test_hosted_video_uploads_view_ref(monkeypatch, tmp_path):
    (tmp_path / "clip.mp4").write_bytes(b"VIDEODATA")
    monkeypatch.setattr(nr.folder_paths, "get_input_directory", lambda: str(tmp_path))
    captured = {}
    async def fake_upload(data, filename):
        captured["data"] = data
        captured["filename"] = filename
        return "https://api.replicate.com/v1/files/abc/content"
    monkeypatch.setattr(nr, "_upload_replicate_file", fake_upload)
    out = await nr._lipsync_hosted_video_url("/view?filename=clip.mp4&type=input")
    assert out == "https://api.replicate.com/v1/files/abc/content"
    assert captured["data"] == b"VIDEODATA"
    assert captured["filename"] == "clip.mp4"


@pytest.mark.asyncio
async def test_hosted_video_uploads_data_url(monkeypatch):
    import base64 as _b64
    captured = {}
    async def fake_upload(data, filename):
        captured["data"] = data
        return "https://api.replicate.com/v1/files/xyz/content"
    monkeypatch.setattr(nr, "_upload_replicate_file", fake_upload)
    payload = b"RAWVIDEO"
    data_url = "data:video/mp4;base64," + _b64.b64encode(payload).decode()
    out = await nr._lipsync_hosted_video_url(data_url)
    assert out == "https://api.replicate.com/v1/files/xyz/content"
    assert captured["data"] == payload
