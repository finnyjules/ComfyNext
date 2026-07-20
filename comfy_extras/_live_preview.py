"""Shared helper for adjustment nodes that render a live preview into the node body.

Writes the preview image to a fixed filename per node id so that rapid slider
drags overwrite a single file instead of filling the temp/ directory.
"""

from __future__ import annotations

import os

import numpy as np
import torch
from PIL import Image as PILImage

import folder_paths


# Monotonic suffix for unique-mode previews. Per-process; temp/ is wiped on
# restart, so a reset counter can't collide with a previous session's files.
_unique_seq = 0


def save_live_preview(image_tensor: torch.Tensor, node_id: str, unique: bool = False) -> dict:
    """Save a live-preview image and return the UI dict expected by ComfyUI.

    By default the filename is deterministic (`live_preview_<node_id>.png`), so
    each new run for the same node overwrites the previous file — right for
    scrub-style previews (slider drags) where temp/ must stay bounded. The
    frontend appends a cache-buster query param so the browser still refetches.

    Pass `unique=True` for RESULT emissions the frontend captures as takes
    (e.g. the Image artifact's RGBA cutout preview): takes must reference
    immutable files. With the fixed name, every take aliases one mutable file —
    the filmstrip pick becomes a browser-cache illusion and downstream runs
    read the newest pixels instead of the picked ones.
    """
    temp_dir = folder_paths.get_temp_directory()
    os.makedirs(temp_dir, exist_ok=True)

    if unique:
        global _unique_seq
        _unique_seq += 1
        filename = f"live_preview_{node_id}_{_unique_seq:05d}.png"
    else:
        filename = f"live_preview_{node_id}.png"

    # Show the first image in the batch.
    img = image_tensor[0] if image_tensor.ndim == 4 else image_tensor
    arr = np.clip(255.0 * img.cpu().numpy(), 0, 255).astype(np.uint8)
    PILImage.fromarray(arr).save(
        os.path.join(temp_dir, filename),
        "PNG",
        compress_level=1,
    )

    return {
        "images": [
            {"filename": filename, "subfolder": "", "type": "temp"}
        ],
        "animated": (False,),
    }


def save_generation_output(image_tensor: torch.Tensor, filename_prefix: str = "generation") -> dict:
    """Save a cloud-generation result as a DURABLE output file and return the UI dict.

    Unlike `save_live_preview` (which writes a single overwriting temp file for a
    transient in-node preview, type:"temp"), this writes a new uniquely-numbered
    PNG into the output directory on every call — like SaveImage — and marks it
    type:"output". The Assets pipeline keeps only type:"output" files, so this is
    what makes a paid generation show up as an asset; numbering means each run is
    its own asset and history accumulates instead of being overwritten.
    """
    out_dir = folder_paths.get_output_directory()
    full_output_folder, filename, counter, subfolder, _ = folder_paths.get_save_image_path(
        filename_prefix, out_dir
    )
    os.makedirs(full_output_folder, exist_ok=True)

    images = image_tensor if image_tensor.ndim == 4 else image_tensor.unsqueeze(0)
    out_files: list[dict[str, str]] = []
    for img in images:
        arr = np.clip(255.0 * img.cpu().numpy(), 0, 255).astype(np.uint8)
        file = f"{filename}_{counter:05}_.png"
        PILImage.fromarray(arr).save(os.path.join(full_output_folder, file), "PNG")
        out_files.append({"filename": file, "subfolder": subfolder, "type": "output"})
        counter += 1

    return {"images": out_files, "animated": (False,)}


def save_live_preview_multi(
    images: list[torch.Tensor], node_id: str, labels: list[str] | None = None
) -> dict:
    """Save multiple preview images for a node and return a UI dict with all of them.

    Used by nodes that produce a *set* of related images (e.g. SmartLayout
    rendering one PNG per aspect ratio) where every variant matters to the
    user. Each tensor is saved under a deterministic filename keyed by node id
    + variant index/label so reruns overwrite their predecessors instead of
    accumulating in temp/.

    Returns the same UI shape ComfyUI expects (a list under "images") so the
    frontend can present them however it likes — a carousel for SmartLayout,
    a vertical strip for the default node body, etc.
    """
    temp_dir = folder_paths.get_temp_directory()
    os.makedirs(temp_dir, exist_ok=True)

    out_files: list[dict[str, str]] = []
    for i, image in enumerate(images):
        img = image[0] if image.ndim == 4 else image
        arr = np.clip(255.0 * img.cpu().numpy(), 0, 255).astype(np.uint8)
        # Sanitize the label so it's safe in a filename (alnum + _- only).
        raw_label = labels[i] if labels and i < len(labels) else str(i)
        safe_label = "".join(c if c.isalnum() or c in ("_", "-", ".") else "_" for c in raw_label) or str(i)
        fname = f"live_preview_{node_id}_{safe_label}.png"
        PILImage.fromarray(arr).save(
            os.path.join(temp_dir, fname),
            "PNG",
            compress_level=1,
        )
        out_files.append({"filename": fname, "subfolder": "", "type": "temp"})

    return {
        "images": out_files,
        "animated": (False,),
    }
