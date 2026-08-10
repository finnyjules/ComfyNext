import json
import pytest

import utils.install_util  # noqa: F401
import comfy_api_nodes.nodes_replicate as nr
from comfy_api_nodes.nodes_replicate import RestyleFromImageNode


@pytest.fixture
def captured(monkeypatch):
    """Stub the tensor→url, network and save layers so execute() is a pure
    input_dict builder we can assert on. Returns a dict the test reads after."""
    holder = {}

    monkeypatch.setattr(nr, "_image_tensor_to_data_url", lambda t: f"DATA:{t}")
    monkeypatch.setattr(nr, "_moodboard_ref_data_urls",
                        lambda folder, files, input_dir=None: [f"BOARD:{f}" for f in files])

    async def fake_predict(slug, input_dict):
        holder["slug"] = slug
        holder["input"] = input_dict
        return "http://result/img.png"

    async def fake_download(url, cls=None):
        return "TENSOR"

    monkeypatch.setattr(nr, "_run_image_edit_prediction", fake_predict)
    monkeypatch.setattr(nr, "download_url_to_image_tensor", fake_download)
    monkeypatch.setattr(nr, "save_generation_output", lambda *a, **k: {})
    return holder


def _refs(files=("00_a.png", "01_b.jpg")):
    return json.dumps({"folder": "moodboard_1754000000000", "files": list(files)})


@pytest.mark.asyncio
async def test_nano_banana_uses_board_images_as_style_refs(captured):
    await RestyleFromImageNode.execute(
        model="Nano Banana 2", content_image="C", style_image="S",
        style_refs=_refs(), style_in="dusty pastel palette",
    )
    # content first, then the board images — the single style image is ignored.
    assert captured["input"]["image_input"] == ["DATA:C", "BOARD:00_a.png", "BOARD:01_b.jpg"]
    assert "DATA:S" not in captured["input"]["image_input"]
    # style-only instruction + the taste block both present.
    assert "STYLE references" in captured["input"]["prompt"]
    assert "dusty pastel palette" in captured["input"]["prompt"]


@pytest.mark.asyncio
async def test_board_images_capped_at_three(captured):
    await RestyleFromImageNode.execute(
        model="Nano Banana 2", content_image="C", style_image=None,
        style_refs=_refs(("a.png", "b.png", "c.png", "d.png", "e.png")),
    )
    # _parse_style_refs caps at 3 before the loader ever runs.
    assert len(captured["input"]["image_input"]) == 1 + 3


@pytest.mark.asyncio
async def test_ip_adapter_falls_back_to_first_board_image(captured):
    await RestyleFromImageNode.execute(
        model="Style Transfer · IP-Adapter", content_image="C", style_image=None,
        style_refs=_refs(("first.png", "second.png")), style_in="mood text",
    )
    assert captured["slug"] == "fofr/style-transfer"
    assert captured["input"]["style_image"] == "BOARD:first.png"
    assert captured["input"]["structure_image"] == "DATA:C"
    assert "mood text" in captured["input"]["prompt"]


@pytest.mark.asyncio
async def test_no_board_is_unchanged_single_style_image(captured):
    await RestyleFromImageNode.execute(
        model="Nano Banana 2", content_image="C", style_image="S",
    )
    assert captured["input"]["image_input"] == ["DATA:C", "DATA:S"]
    assert "STYLE references" not in captured["input"]["prompt"]


@pytest.mark.asyncio
async def test_malformed_refs_degrade_to_single_style_image(captured):
    await RestyleFromImageNode.execute(
        model="Nano Banana 2", content_image="C", style_image="S",
        style_refs="{not json",
    )
    assert captured["input"]["image_input"] == ["DATA:C", "DATA:S"]


@pytest.mark.asyncio
async def test_no_style_source_raises(captured):
    with pytest.raises(RuntimeError):
        await RestyleFromImageNode.execute(
            model="Nano Banana 2", content_image="C", style_image=None,
        )


@pytest.mark.asyncio
async def test_empty_board_with_taste_does_taste_only_restyle(captured, monkeypatch):
    # The board is wired but its images were deleted, so the loader returns [].
    # The frontend has already disconnected style_image on apply. The still-usable
    # taste block must carry the restyle — content only, taste in the prompt.
    monkeypatch.setattr(nr, "_moodboard_ref_data_urls", lambda *a, **k: [])
    await RestyleFromImageNode.execute(
        model="Nano Banana 2", content_image="C", style_image=None,
        style_refs=_refs(), style_in="dusty pastel palette",
    )
    assert captured["input"]["image_input"] == ["DATA:C"]
    assert "dusty pastel palette" in captured["input"]["prompt"]


@pytest.mark.asyncio
async def test_ip_adapter_empty_board_taste_only_raises(captured, monkeypatch):
    # IP-Adapter's style_image can't be fed by a taste block, so an empty board
    # with no style image is a hard error even when taste is present.
    monkeypatch.setattr(nr, "_moodboard_ref_data_urls", lambda *a, **k: [])
    with pytest.raises(RuntimeError):
        await RestyleFromImageNode.execute(
            model="Style Transfer · IP-Adapter", content_image="C", style_image=None,
            style_refs=_refs(), style_in="mood text",
        )
