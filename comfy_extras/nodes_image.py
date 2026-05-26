"""Unified `Image` artifact node.

Replaces the Load / Preview / Save trio for new workflows by behaving like
all three depending on what's connected:

  - upstream `images` connected     → previews that upstream (and optionally exports)
  - upstream not connected, file set → loads from disk and previews
  - neither                          → returns a 1×1 placeholder (UI shows empty state)

The visual half of this lives in `frontend/app/components/vue-canvas/
ArtifactImageNode.vue`, which renders the node as an image instead of a
node-box. The legacy LoadImage / PreviewImage / SaveImage nodes are
untouched — existing workflows keep working exactly as before.
"""

import hashlib
import os
import random

import numpy as np
import torch
from PIL import Image as PILImage, ImageOps, ImageSequence

import comfy.model_management
import folder_paths
import node_helpers
from nodes import SaveImage


class Image(SaveImage):
    def __init__(self):
        # Preview lives in the temp dir with low PNG compression — same trick
        # PreviewImage uses to keep the live-preview loop fast.
        self.output_dir = folder_paths.get_temp_directory()
        self.type = "temp"
        self.prefix_append = "_preview_" + "".join(
            random.choice("abcdefghijklmnopqrstuvwxyz") for _ in range(5)
        )
        self.compress_level = 1
        # Cached so the export branch doesn't hit folder_paths each call.
        self._export_dir = folder_paths.get_output_directory()

    @classmethod
    def INPUT_TYPES(cls):
        input_dir = folder_paths.get_input_directory()
        files = sorted(
            f for f in os.listdir(input_dir)
            if os.path.isfile(os.path.join(input_dir, f))
        )
        files = folder_paths.filter_files_content_types(files, ["image"])
        # An empty sentinel goes first so the widget can stay required while
        # still allowing "no source yet" (the upstream connection supplies it).
        return {
            "required": {
                "image": ([""] + sorted(files), {
                    "image_upload": True,
                    "default": "",
                    "tooltip": "File to load when no upstream image is connected. Ignored when something is wired into `images`.",
                }),
                "export": ("BOOLEAN", {
                    "default": False,
                    "tooltip": "Also save a copy to the output directory on run. Off = preview only.",
                }),
                "filename_prefix": ("STRING", {"default": "ComfyUI"}),
                "format": (["png", "webp", "jpeg"], {"default": "png"}),
                "quality": ("INT", {"default": 90, "min": 1, "max": 100}),
                "lossless_webp": ("BOOLEAN", {"default": False}),
                "png_compression": ("INT", {"default": 4, "min": 0, "max": 9}),
                "scale": ("FLOAT", {"default": 1.0, "min": 0.1, "max": 4.0, "step": 0.05}),
                "max_dimension": ("INT", {"default": 0, "min": 0, "max": 16384}),
                "embed_metadata": ("BOOLEAN", {"default": True}),
                # Variant fan-out: when N Image sinks share one upstream IMAGE
                # output, the frontend bumps the upstream's batch_size to N and
                # writes 0,1,…,N-1 here per sink so each card shows a different
                # element from the batch. Users can also set it manually to
                # peek at a specific batch index. -1 = take the whole batch.
                "batch_index": ("INT", {"default": -1, "min": -1, "max": 64, "tooltip": "Which element to slice from a batch input. -1 keeps the whole batch (default). Auto-set by the canvas when multiple sinks share one upstream."}),
            },
            "optional": {
                "images": ("IMAGE", {"tooltip": "Upstream image. Takes priority over the file widget."}),
            },
            "hidden": {
                "prompt": "PROMPT",
                "extra_pnginfo": "EXTRA_PNGINFO",
            },
        }

    RETURN_TYPES = ("IMAGE", "MASK")
    RETURN_NAMES = ("image", "mask")
    FUNCTION = "process"
    OUTPUT_NODE = True
    CATEGORY = "image"
    ESSENTIALS_CATEGORY = "Basics"
    DESCRIPTION = "Unified image artifact — load from disk, preview upstream, optionally export."
    SEARCH_ALIASES = [
        "image", "img", "picture", "photo",
        "load image", "preview image", "save image", "export image",
    ]

    def process(self, image, export, filename_prefix, format, quality,
                lossless_webp, png_compression, scale, max_dimension, embed_metadata,
                batch_index=-1, images=None, prompt=None, extra_pnginfo=None):
        if images is not None:
            output_image = images
            # Variant fan-out: slice a single element from the batch when
            # `batch_index` is set (>= 0). This is how N sinks wired to one
            # upstream end up each showing a different image — the frontend
            # writes 0,1,…,N-1 here per sink at submission time.
            if (isinstance(batch_index, int) and batch_index >= 0
                    and output_image.shape[0] > 1):
                idx = min(batch_index, output_image.shape[0] - 1)
                output_image = output_image[idx:idx + 1]
            # No mask from upstream — return a permissive empty mask matching
            # the batch size so downstream MASK consumers don't crash.
            output_mask = torch.zeros(
                (output_image.shape[0], 64, 64), dtype=torch.float32,
            )
        elif image:
            output_image, output_mask = _load_from_disk(image)
        else:
            # Nothing to do — return a 1×1 placeholder and let the UI render
            # the empty/upload state. No preview written.
            placeholder_img = torch.zeros((1, 1, 1, 3), dtype=torch.float32)
            placeholder_mask = torch.zeros((1, 64, 64), dtype=torch.float32)
            return {"ui": {"images": []}, "result": (placeholder_img, placeholder_mask)}

        preview_result = self._preview_to_temp(output_image, prompt, extra_pnginfo)

        if export:
            self._export_to_output(
                output_image, filename_prefix, format, quality, lossless_webp,
                png_compression, scale, max_dimension, embed_metadata,
                prompt, extra_pnginfo,
            )

        return {"ui": preview_result["ui"], "result": (output_image, output_mask)}

    def _preview_to_temp(self, images, prompt, extra_pnginfo):
        return SaveImage.save_images(
            self, images, filename_prefix="Image",
            format="png", quality=90, lossless_webp=False,
            png_compression=self.compress_level,
            scale=1.0, max_dimension=0, embed_metadata=True,
            prompt=prompt, extra_pnginfo=extra_pnginfo,
        )

    def _export_to_output(self, images, filename_prefix, format, quality, lossless_webp,
                          png_compression, scale, max_dimension, embed_metadata,
                          prompt, extra_pnginfo):
        # SaveImage writes wherever `self.output_dir` points. Swap in the real
        # output dir for the export pass, then restore — cheaper than copying
        # the 100+ line save body.
        orig_dir, orig_type, orig_append = self.output_dir, self.type, self.prefix_append
        try:
            self.output_dir = self._export_dir
            self.type = "output"
            self.prefix_append = ""
            SaveImage.save_images(
                self, images, filename_prefix=filename_prefix,
                format=format, quality=quality, lossless_webp=lossless_webp,
                png_compression=png_compression, scale=scale, max_dimension=max_dimension,
                embed_metadata=embed_metadata,
                prompt=prompt, extra_pnginfo=extra_pnginfo,
            )
        finally:
            self.output_dir, self.type, self.prefix_append = orig_dir, orig_type, orig_append

    @classmethod
    def IS_CHANGED(cls, image, **_kwargs):
        # Hash the source file so cache invalidates on disk changes. Upstream
        # connections have their own IS_CHANGED upstream — we don't need to
        # mix that in here.
        if not image:
            return ""
        try:
            path = folder_paths.get_annotated_filepath(image)
            h = hashlib.sha256()
            with open(path, "rb") as f:
                h.update(f.read())
            return h.digest().hex()
        except Exception:
            return ""

    @classmethod
    def VALIDATE_INPUTS(cls, image, **_kwargs):
        # Empty `image` is OK — process() handles the "no source" case by
        # returning a placeholder. Only reject a non-empty name that doesn't
        # resolve to a real file.
        if image and not folder_paths.exists_annotated_filepath(image):
            return f"Invalid image file: {image}"
        return True


def _load_from_disk(image):
    """Load an image file from the input directory and return (image, mask).

    Mirrors `LoadImage.load_image` — duplicated to keep this module independent
    of nodes.py's internals beyond the public SaveImage class.
    """
    path = folder_paths.get_annotated_filepath(image)
    img = node_helpers.pillow(PILImage.open, path)

    output_images = []
    output_masks = []
    w = h = None
    dtype = comfy.model_management.intermediate_dtype()

    for frame in ImageSequence.Iterator(img):
        frame = node_helpers.pillow(ImageOps.exif_transpose, frame)
        if frame.mode == "I":
            frame = frame.point(lambda v: v * (1 / 255))
        rgb = frame.convert("RGB")

        if not output_images:
            w, h = rgb.size

        if rgb.size != (w, h):
            continue

        arr = np.array(rgb).astype(np.float32) / 255.0
        tensor = torch.from_numpy(arr)[None,]

        if "A" in frame.getbands():
            mask = np.array(frame.getchannel("A")).astype(np.float32) / 255.0
            mask = 1.0 - torch.from_numpy(mask)
        elif frame.mode == "P" and "transparency" in frame.info:
            mask = np.array(frame.convert("RGBA").getchannel("A")).astype(np.float32) / 255.0
            mask = 1.0 - torch.from_numpy(mask)
        else:
            mask = torch.zeros((64, 64), dtype=torch.float32)

        output_images.append(tensor.to(dtype=dtype))
        output_masks.append(mask.unsqueeze(0).to(dtype=dtype))

        if img.format == "MPO":
            break

    if len(output_images) > 1:
        return torch.cat(output_images, dim=0), torch.cat(output_masks, dim=0)
    return output_images[0], output_masks[0]


NODE_CLASS_MAPPINGS = {
    "Image": Image,
}

NODE_DISPLAY_NAME_MAPPINGS = {
    "Image": "Image",
}
