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


def save_live_preview(image_tensor: torch.Tensor, node_id: str) -> dict:
    """Save a live-preview image and return the UI dict expected by ComfyUI.

    The filename is deterministic (`live_preview_<node_id>.png`), so each new
    run for the same node overwrites the previous file. The frontend appends a
    cache-buster query param so the browser still refetches.
    """
    temp_dir = folder_paths.get_temp_directory()
    os.makedirs(temp_dir, exist_ok=True)

    # Show the first image in the batch.
    img = image_tensor[0] if image_tensor.ndim == 4 else image_tensor
    arr = np.clip(255.0 * img.cpu().numpy(), 0, 255).astype(np.uint8)
    PILImage.fromarray(arr).save(
        os.path.join(temp_dir, f"live_preview_{node_id}.png"),
        "PNG",
        compress_level=1,
    )

    return {
        "images": [
            {"filename": f"live_preview_{node_id}.png", "subfolder": "", "type": "temp"}
        ],
        "animated": (False,),
    }


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
