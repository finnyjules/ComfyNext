"""Live end-to-end for Timeline ↔ VIDEO interop against a running ComfyUI:
LoadVideo ×2 → Timeline (clip1/clip2) → SaveVideo via Timeline's VIDEO output.
Skipped unless :8188 is reachable and input/ has at least two .mp4 files.
Regression for: 'received_type(VIDEO) mismatch input_type(IMAGE)'."""
import glob
import json
import os
import time
import urllib.error
import urllib.request

import pytest

REPO_ROOT = os.path.abspath(os.path.join(os.path.dirname(__file__), "..", ".."))
BASE = "http://127.0.0.1:8188"


def _server_up() -> bool:
    try:
        return urllib.request.urlopen(BASE + "/", timeout=3).status == 200
    except Exception:
        return False


def _small_input_videos() -> list[str]:
    # Prefer small files — Timeline decodes wired videos fully, so 4K sources
    # would OOM the server. <2 MB keeps the run instant.
    vids = sorted(glob.glob(os.path.join(REPO_ROOT, "input", "*.mp4")),
                  key=os.path.getsize)
    return [os.path.basename(v) for v in vids if os.path.getsize(v) < 2_000_000][:2]


_VIDEOS = _small_input_videos()


@pytest.mark.skipif(not _server_up(), reason="ComfyUI not running on :8188")
@pytest.mark.skipif(len(_VIDEOS) < 2, reason="need two small .mp4 files in input/")
def test_video_timeline_savevideo_executes_live():
    def get_json(path):
        return json.loads(urllib.request.urlopen(BASE + path, timeout=10).read())

    # Fill Timeline's required widgets from their object_info defaults.
    info = get_json("/object_info/Timeline")["Timeline"]
    tl_inputs = {}
    for name, spec in info["input"]["required"].items():
        if name.startswith("clip") and spec[0] == "IMAGE,VIDEO":
            continue
        cfg = spec[1] if len(spec) > 1 and isinstance(spec[1], dict) else {}
        if "default" in cfg:
            tl_inputs[name] = cfg["default"]
        elif spec[0] == "COMBO":
            tl_inputs[name] = (cfg.get("options") or [""])[0]
    tl_inputs.update({"clip1": ["1", 0], "clip2": ["2", 0],
                      "clip1_length": 30, "clip2_length": 20, "total_duration": 40})

    prompt = {
        "1": {"class_type": "LoadVideo", "inputs": {"file": _VIDEOS[0]}},
        "2": {"class_type": "LoadVideo", "inputs": {"file": _VIDEOS[1]}},
        "3": {"class_type": "Timeline", "inputs": tl_inputs},
        "4": {"class_type": "SaveVideo", "inputs": {
            "video": ["3", 1],  # Timeline's VIDEO output (slot 1; IMAGE stays slot 0)
            "filename_prefix": "video/ComfyUI-fixtest-e2e",
            "format": "auto", "codec": "auto"}},
    }
    req = urllib.request.Request(
        BASE + "/prompt",
        data=json.dumps({"prompt": prompt, "client_id": "fixtest-e2e"}).encode(),
        headers={"Content-Type": "application/json"})
    # The regression: this used to 400 with received_type(VIDEO) mismatch input_type(IMAGE).
    resp = urllib.request.urlopen(req, timeout=15)
    assert resp.status == 200
    prompt_id = json.loads(resp.read())["prompt_id"]

    deadline = time.time() + 60
    status = "pending"
    outputs = {}
    while time.time() < deadline:
        try:
            hist = get_json(f"/history/{prompt_id}").get(prompt_id)
        except Exception:
            hist = None
        if hist:
            status = hist["status"]["status_str"]
            outputs = hist.get("outputs", {})
            if status in ("success", "error"):
                break
        time.sleep(2)

    assert status == "success", f"prompt did not succeed: {status}"
    saved = outputs.get("4", {}).get("images", [])
    assert saved, "SaveVideo produced no file"
    out_path = os.path.join(REPO_ROOT, "output", saved[0].get("subfolder", ""),
                            saved[0]["filename"])
    assert os.path.exists(out_path)
    assert os.path.getsize(out_path) > 1000
