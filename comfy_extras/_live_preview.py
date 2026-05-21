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
