"""Unit tests for the durable Project storage layer (Phase 0).

Covers the pure functions in comfy_extras/nodes_comfynext_projects.py against a
temp root — no ComfyUI server, no network. See
docs/plans/2026-06-02-phase0-project-persistence-spec.md.
"""
import json
import os

import pytest

from comfy_extras import nodes_comfynext_projects as P


@pytest.fixture
def root(tmp_path):
    return P.projects_root(str(tmp_path))


# --------------------------------------------------------------------------- #
# Layout & basic CRUD
# --------------------------------------------------------------------------- #

def test_projects_root_layout(tmp_path):
    assert P.projects_root(str(tmp_path)).endswith(os.path.join("comfynext", "projects"))


def test_ensure_creates_then_returns_existing(root):
    created = P.ensure_project(root, "abc", name="My Project", now=100)
    assert created["uuid"] == "abc"
    assert created["name"] == "My Project"
    assert created["versionIndex"] == []
    assert created["currentVersionId"] is None
    # Second call returns the same project, not a fresh one.
    again = P.ensure_project(root, "abc", name="DIFFERENT", now=200)
    assert again["name"] == "My Project"  # unchanged


def test_read_missing_returns_none(root):
    assert P.read_project(root, "nope") is None


def test_write_and_read_roundtrip(root):
    P.write_project(root, {"uuid": "p1", "name": "X", "versionIndex": [], "updatedAt": 5})
    got = P.read_project(root, "p1")
    assert got["name"] == "X"


def test_list_projects_sorted_newest_first(root):
    P.write_project(root, {"uuid": "old", "name": "Old", "updatedAt": 100, "versionIndex": []})
    P.write_project(root, {"uuid": "new", "name": "New", "updatedAt": 300, "versionIndex": []})
    P.write_project(root, {"uuid": "mid", "name": "Mid", "updatedAt": 200, "versionIndex": []})
    listed = P.list_projects(root)
    assert [p["uuid"] for p in listed] == ["new", "mid", "old"]
    # Index view is metadata-only.
    assert set(listed[0].keys()) == {"uuid", "name", "cover", "updatedAt"}


def test_list_projects_empty_when_no_root(tmp_path):
    assert P.list_projects(P.projects_root(str(tmp_path))) == []


def test_delete_project(root):
    P.ensure_project(root, "gone", now=1)
    assert P.read_project(root, "gone") is not None
    assert P.delete_project(root, "gone") is True
    assert P.read_project(root, "gone") is None
    assert P.delete_project(root, "gone") is False  # already gone


# --------------------------------------------------------------------------- #
# Versions
# --------------------------------------------------------------------------- #

def test_write_version_updates_index_and_current(root):
    P.ensure_project(root, "p", now=1)
    P.write_version(root, "p", {"id": "v_1", "name": "v1", "createdAt": 10, "workflow": {"nodes": []}}, now=10)
    proj = P.read_project(root, "p")
    assert proj["currentVersionId"] == "v_1"
    assert [m["id"] for m in proj["versionIndex"]] == ["v_1"]
    assert proj["updatedAt"] == 10
    # Index carries metadata only — not the full workflow body.
    assert "workflow" not in proj["versionIndex"][0]
    # The body is retrievable in full.
    body = P.read_version(root, "p", "v_1")
    assert body["workflow"] == {"nodes": []}


def test_multiple_versions_append_and_advance_current(root):
    P.ensure_project(root, "p", now=1)
    P.write_version(root, "p", {"id": "v_1", "createdAt": 10}, now=10)
    P.write_version(root, "p", {"id": "v_2", "createdAt": 20, "parentId": "v_1"}, now=20)
    proj = P.read_project(root, "p")
    assert proj["currentVersionId"] == "v_2"
    assert [m["id"] for m in proj["versionIndex"]] == ["v_1", "v_2"]


def test_rewriting_same_version_id_does_not_duplicate_index(root):
    P.ensure_project(root, "p", now=1)
    P.write_version(root, "p", {"id": "v_1", "name": "first", "createdAt": 10}, now=10)
    P.write_version(root, "p", {"id": "v_1", "name": "second", "createdAt": 11}, now=11)
    proj = P.read_project(root, "p")
    assert [m["id"] for m in proj["versionIndex"]] == ["v_1"]
    assert proj["versionIndex"][0]["name"] == "second"


def test_write_version_missing_project_raises(root):
    with pytest.raises(KeyError):
        P.write_version(root, "ghost", {"id": "v_1", "createdAt": 1})


def test_read_version_missing_returns_none(root):
    P.ensure_project(root, "p", now=1)
    assert P.read_version(root, "p", "nope") is None


# --------------------------------------------------------------------------- #
# Safety & robustness
# --------------------------------------------------------------------------- #

@pytest.mark.parametrize("bad", ["../escape", "a/b", "a\\b", "..", "", ".hidden", None, 5])
def test_path_traversal_and_bad_ids_rejected(root, bad):
    assert P.read_project(root, bad) is None
    assert P.delete_project(root, bad) is False
    with pytest.raises(ValueError):
        P.write_project(root, {"uuid": bad, "name": "x"})


def test_write_version_rejects_bad_version_id(root):
    P.ensure_project(root, "p", now=1)
    with pytest.raises(ValueError):
        P.write_version(root, "p", {"id": "../evil", "createdAt": 1})


def test_atomic_write_no_leftover_tmp_files(root):
    P.ensure_project(root, "p", now=1)
    P.write_version(root, "p", {"id": "v_1", "createdAt": 1}, now=1)
    # No stray *.tmp files left behind by the atomic write.
    leftovers = []
    for dirpath, _dirs, files in os.walk(root):
        leftovers += [f for f in files if f.endswith(".tmp")]
    assert leftovers == []


def test_corrupt_project_json_reads_as_none(root):
    P.ensure_project(root, "p", now=1)
    with open(P._project_file(root, "p"), "w", encoding="utf-8") as f:
        f.write("{ not valid json")
    assert P.read_project(root, "p") is None
    # And a corrupt project is simply skipped in the list view.
    assert P.list_projects(root) == []


def test_written_files_are_valid_json_on_disk(root):
    P.ensure_project(root, "p", name="Disk", now=1)
    with open(P._project_file(root, "p"), "r", encoding="utf-8") as f:
        assert json.load(f)["name"] == "Disk"


# --------------------------------------------------------------------------- #
# Generation records (durable per-run history)
# --------------------------------------------------------------------------- #

def test_append_and_list_generations_newest_first(root):
    P.ensure_project(root, "p", now=1)
    P.append_generation(root, "p", {"id": "g_1", "promptId": "pr1", "ts": 100, "outputs": []})
    P.append_generation(root, "p", {"id": "g_2", "promptId": "pr2", "ts": 300, "outputs": []})
    P.append_generation(root, "p", {"id": "g_3", "promptId": "pr3", "ts": 200, "outputs": []})
    gens = P.list_generations(root, "p")
    assert [g["id"] for g in gens] == ["g_2", "g_3", "g_1"]


def test_append_generation_dedups_by_prompt_id(root):
    P.ensure_project(root, "p", now=1)
    first = P.append_generation(root, "p", {"id": "g_1", "promptId": "pr1", "ts": 100})
    assert first is not None
    dup = P.append_generation(root, "p", {"id": "g_2", "promptId": "pr1", "ts": 200})
    assert dup is None
    assert len(P.list_generations(root, "p")) == 1


def test_append_generation_fills_id_and_ts(root):
    P.ensure_project(root, "p", now=1)
    stored = P.append_generation(root, "p", {"promptId": "pr1"}, now=555)
    assert stored["id"].startswith("g_")
    assert stored["ts"] == 555


def test_list_generations_missing_file_or_project(root):
    assert P.list_generations(root, "nope") == []
    P.ensure_project(root, "p", now=1)
    assert P.list_generations(root, "p") == []


def test_list_generations_skips_corrupt_lines(root):
    P.ensure_project(root, "p", now=1)
    P.append_generation(root, "p", {"id": "g_1", "promptId": "pr1", "ts": 100})
    with open(P._generations_file(root, "p"), "a", encoding="utf-8") as f:
        f.write("{ not valid json\n")
    P.append_generation(root, "p", {"id": "g_2", "promptId": "pr2", "ts": 200})
    assert [g["id"] for g in P.list_generations(root, "p")] == ["g_2", "g_1"]


def test_append_generation_bad_uuid_raises(root):
    with pytest.raises(ValueError):
        P.append_generation(root, "../evil", {"promptId": "x"})
