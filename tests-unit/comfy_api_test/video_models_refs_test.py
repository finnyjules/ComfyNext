"""Tests for parse_view_ref — the Shot Director local-reference contract.

Shot Director stores uploaded references as small '/view?filename=X&type=input'
URLs instead of multi-MB data URLs (which bloated workflow JSON and blew the
sessionStorage persistence quota). FilmShotNode resolves those to data URLs at
execute time by reading the ComfyUI input dir; everything else (data:, https:)
must pass through untouched, and nothing in a widget string may escape the
input directory.
"""
from comfy_api_nodes.video_models import parse_view_ref


def test_parses_input_view_ref():
    assert parse_view_ref("/view?filename=ref_1.png&type=input") == "ref_1.png"


def test_url_decodes_filename():
    assert parse_view_ref("/view?filename=my%20ref.png&type=input") == "my ref.png"


def test_rejects_non_input_type():
    assert parse_view_ref("/view?filename=a.png&type=output") is None
    assert parse_view_ref("/view?filename=a.png") is None


def test_passes_through_non_view_sources():
    assert parse_view_ref("data:image/png;base64,xyz") is None
    assert parse_view_ref("https://example.com/a.png") is None
    assert parse_view_ref("/viewx?filename=a.png&type=input") is None
    assert parse_view_ref("") is None
    assert parse_view_ref(None) is None


def test_rejects_path_traversal():
    assert parse_view_ref("/view?filename=../../etc/passwd&type=input") is None
    assert parse_view_ref("/view?filename=..%2F..%2Fetc%2Fpasswd&type=input") is None
    assert parse_view_ref("/view?filename=sub/dir.png&type=input") is None
    assert parse_view_ref("/view?filename=sub\\dir.png&type=input") is None
