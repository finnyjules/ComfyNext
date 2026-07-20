"""Unit tests for the in-node image-save helpers (comfy_extras._live_preview).

Covers the durable-output helper used by cloud generators (so their results are
recorded as Assets) and pins the invariant that the transient live-preview helper
stays type:"temp" (so adjustment-node slider previews never pollute the Assets
panel).
"""
import os

import numpy as np  # noqa: F401  (imported to fail fast if the env lacks numpy)
import torch

import folder_paths
from comfy_extras import _live_preview as lp


def test_save_generation_output_writes_durable_output(tmp_path, monkeypatch):
    monkeypatch.setattr(folder_paths, "get_output_directory", lambda: str(tmp_path))
    img = torch.zeros(1, 8, 8, 3)
    ui = lp.save_generation_output(img, "test_gen")

    assert "images" in ui and len(ui["images"]) == 1
    rec = ui["images"][0]
    # The whole point of the fix: a durable output, not a temp preview.
    assert rec["type"] == "output"
    assert rec["filename"].endswith(".png")
    # The file is actually written under the output directory.
    path = os.path.join(str(tmp_path), rec["subfolder"], rec["filename"])
    assert os.path.isfile(path)


def test_save_generation_output_accumulates_unique_filenames(tmp_path, monkeypatch):
    monkeypatch.setattr(folder_paths, "get_output_directory", lambda: str(tmp_path))
    img = torch.zeros(1, 8, 8, 3)
    a = lp.save_generation_output(img, "test_gen")["images"][0]["filename"]
    b = lp.save_generation_output(img, "test_gen")["images"][0]["filename"]
    # Each paid run is its own asset — the helper must not overwrite history.
    assert a != b


def test_save_live_preview_stays_temp(tmp_path, monkeypatch):
    # Regression guard: the transient helper must remain type:"temp" so the
    # Assets pipeline (which keeps only type:"output") still filters it out.
    monkeypatch.setattr(folder_paths, "get_temp_directory", lambda: str(tmp_path))
    img = torch.zeros(1, 8, 8, 3)
    ui = lp.save_live_preview(img, "node1")
    assert ui["images"][0]["type"] == "temp"


def test_save_live_preview_default_keeps_fixed_overwriting_name(tmp_path, monkeypatch):
    # Scrub-style previews (slider drags) overwrite one file per node so temp/
    # stays bounded — the fixed name is the contract.
    monkeypatch.setattr(folder_paths, "get_temp_directory", lambda: str(tmp_path))
    img = torch.zeros(1, 4, 4, 3)
    a = lp.save_live_preview(img, "img_123")["images"][0]["filename"]
    b = lp.save_live_preview(img, "img_123")["images"][0]["filename"]
    assert a == "live_preview_img_123.png"
    assert b == a


def test_save_live_preview_unique_gives_each_emission_its_own_file(tmp_path, monkeypatch):
    # RESULT emissions the frontend captures as takes (e.g. the Image artifact's
    # RGBA cutout preview) need immutable files: with a fixed name every take
    # aliases one mutable file, so picking an older take silently feeds the
    # NEWEST pixels to downstream runs (the "Blend Scene gets the wrong input
    # image" bug).
    monkeypatch.setattr(folder_paths, "get_temp_directory", lambda: str(tmp_path))
    img = torch.zeros(1, 4, 4, 3)
    a = lp.save_live_preview(img, "img_123", unique=True)["images"][0]
    b = lp.save_live_preview(img, "img_123", unique=True)["images"][0]
    assert a["filename"] != b["filename"]
    # Keep the live_preview_ prefix — Assets history filters on it — and stay temp.
    assert a["filename"].startswith("live_preview_img_123")
    assert b["filename"].startswith("live_preview_img_123")
    assert a["type"] == "temp" and b["type"] == "temp"
    assert os.path.isfile(os.path.join(str(tmp_path), a["filename"]))
    assert os.path.isfile(os.path.join(str(tmp_path), b["filename"]))
