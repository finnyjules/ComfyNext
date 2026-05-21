"""Text-conditioned and click-based mask nodes.

Both lazily load their models from HuggingFace on first execute and cache them
in module globals. First run will download (CLIPSeg ~150MB, SAM ~370MB); later
runs reuse the in-memory model.
"""

from __future__ import annotations

import numpy as np
import torch
import torch.nn.functional as F
from PIL import Image as PILImage
from typing_extensions import override

from comfy_api.latest import ComfyExtension, IO
from comfy_extras._live_preview import save_live_preview


_CLIPSEG_PROCESSOR = None
_CLIPSEG_MODEL = None

def _load_clipseg(device: torch.device):
    global _CLIPSEG_PROCESSOR, _CLIPSEG_MODEL
    if _CLIPSEG_MODEL is None:
        from transformers import CLIPSegProcessor, CLIPSegForImageSegmentation
        _CLIPSEG_PROCESSOR = CLIPSegProcessor.from_pretrained("CIDAS/clipseg-rd64-refined")
        _CLIPSEG_MODEL = CLIPSegForImageSegmentation.from_pretrained("CIDAS/clipseg-rd64-refined").eval()
    if _CLIPSEG_MODEL.device != device:
        _CLIPSEG_MODEL.to(device)
    return _CLIPSEG_PROCESSOR, _CLIPSEG_MODEL


_SAM_PROCESSOR = None
_SAM_MODEL = None

def _load_sam(device: torch.device):
    global _SAM_PROCESSOR, _SAM_MODEL
    if _SAM_MODEL is None:
        from transformers import SamProcessor, SamModel
        _SAM_PROCESSOR = SamProcessor.from_pretrained("facebook/sam-vit-base")
        _SAM_MODEL = SamModel.from_pretrained("facebook/sam-vit-base").eval()
    if _SAM_MODEL.device != device:
        _SAM_MODEL.to(device)
    return _SAM_PROCESSOR, _SAM_MODEL


def _image_to_pil(image: torch.Tensor) -> PILImage.Image:
    """Convert ComfyUI image tensor [B,H,W,3] to PIL Image (first batch)."""
    arr = (image[0].clamp(0.0, 1.0).cpu().numpy() * 255.0).astype(np.uint8)
    return PILImage.fromarray(arr)


def _mask_preview(image: torch.Tensor, mask: torch.Tensor) -> torch.Tensor:
    """Blend the mask over the source image in red so the preview pane
    shows both the input and the resulting selection."""
    # image: [B, H, W, 3], mask: [B, H, W]
    m = mask.unsqueeze(-1).clamp(0.0, 1.0)
    red = torch.zeros_like(image)
    red[..., 0] = 1.0
    return (image * (1.0 - m * 0.5) + red * m * 0.5).clamp(0.0, 1.0)


class MaskByTextNode(IO.ComfyNode):
    @classmethod
    def define_schema(cls):
        return IO.Schema(
            node_id="MaskByText",
            display_name="Mask by Text",
            description="Generate a mask from a text prompt describing the area (CLIPSeg).",
            category="image/mask",
            inputs=[
                IO.Image.Input("image"),
                IO.String.Input(
                    "prompt",
                    default="object",
                    tooltip="What to select. Examples: 'the dog', 'sky', 'red car'.",
                ),
                IO.Float.Input(
                    "threshold",
                    default=0.0,
                    min=0.0,
                    max=1.0,
                    step=0.01,
                    tooltip="If > 0, hard-threshold the mask to 0/1 at this level.",
                ),
                IO.Float.Input(
                    "feather",
                    default=0.0,
                    min=0.0,
                    max=30.0,
                    step=0.5,
                    tooltip="Soften the mask edges (gaussian blur radius).",
                ),
                IO.Boolean.Input("invert", default=False),
            ],
            outputs=[
                IO.Mask.Output(display_name="mask"),
            ],
            hidden=[IO.Hidden.unique_id],
            is_output_node=True,
        )

    @classmethod
    def execute(cls, image, prompt, threshold, feather, invert) -> IO.NodeOutput:
        device = image.device
        proc, model = _load_clipseg(device)
        b, h, w, _ = image.shape
        pil = _image_to_pil(image)
        inputs = proc(text=[prompt or "object"], images=[pil], return_tensors="pt", padding=True)
        inputs = {k: v.to(device) for k, v in inputs.items()}
        with torch.no_grad():
            out = model(**inputs)
        # out.logits shape varies — handle both [1, H', W'] and [H', W'].
        logits = out.logits.float()
        if logits.dim() == 2:
            logits = logits.unsqueeze(0)
        mask_low = torch.sigmoid(logits).unsqueeze(1)  # [1, 1, H', W']
        mask = F.interpolate(mask_low, size=(h, w), mode="bilinear", align_corners=False)
        mask = mask.squeeze(0).squeeze(0).to(image.dtype)
        if threshold > 0.0:
            mask = (mask > threshold).to(image.dtype)
        if feather > 0.0:
            from math import ceil as _ceil
            from torchvision.transforms.functional import gaussian_blur
            ksize = 2 * _ceil(3.0 * feather) + 1
            mask = gaussian_blur(mask.unsqueeze(0).unsqueeze(0), kernel_size=ksize, sigma=feather).squeeze()
        if invert:
            mask = 1.0 - mask
        mask = mask.clamp(0.0, 1.0).unsqueeze(0)  # [1, H, W]
        preview = _mask_preview(image, mask)
        return IO.NodeOutput(mask, ui=save_live_preview(preview, str(cls.hidden.unique_id)))


class MaskExtractorNode(IO.ComfyNode):
    @classmethod
    def define_schema(cls):
        return IO.Schema(
            node_id="MaskExtractor",
            display_name="Mask Extractor",
            description="Click the preview to select (SAM). Shift-click adds, Alt-Shift-click subtracts.",
            category="image/mask",
            inputs=[
                IO.Image.Input("image"),
                IO.String.Input(
                    "points",
                    default='[{"x":0.5,"y":0.5,"label":1}]',
                    tooltip="JSON list of click points {x, y, label}. Managed by the UI.",
                ),
                IO.Float.Input(
                    "feather",
                    default=0.0,
                    min=0.0,
                    max=30.0,
                    step=0.5,
                ),
                IO.Boolean.Input("invert", default=False),
            ],
            outputs=[
                IO.Mask.Output(display_name="mask"),
            ],
            hidden=[IO.Hidden.unique_id],
            is_output_node=True,
        )

    @classmethod
    def execute(cls, image, points, feather, invert) -> IO.NodeOutput:
        import json
        try:
            pts = json.loads(points) if points else []
        except Exception:
            pts = []
        if not isinstance(pts, list):
            pts = []
        if not pts:
            pts = [{"x": 0.5, "y": 0.5, "label": 1}]

        device = image.device
        proc, model = _load_sam(device)
        b, h, w, _ = image.shape
        pil = _image_to_pil(image)
        pw, ph = pil.size  # PIL width, height
        coords = [
            [max(0, min(pw - 1, int(float(p["x"]) * pw))),
             max(0, min(ph - 1, int(float(p["y"]) * ph)))]
            for p in pts
        ]
        labels = [int(p.get("label", 1)) for p in pts]

        # input_points shape: [batch][num_points][2], input_labels: [batch][num_points]
        inputs = proc(pil,
                      input_points=[coords],
                      input_labels=[labels],
                      return_tensors="pt")
        inputs = {k: v.to(device) if hasattr(v, "to") else v for k, v in inputs.items()}
        with torch.no_grad():
            outputs = model(**inputs, multimask_output=True)
        masks = proc.image_processor.post_process_masks(
            outputs.pred_masks.cpu(),
            inputs["original_sizes"].cpu(),
            inputs["reshaped_input_sizes"].cpu(),
        )
        # post_process_masks returns a list (one entry per image) of tensors
        # shaped [num_prompts, num_masks, H, W]. Pick the highest-IoU candidate.
        scores = outputs.iou_scores[0, 0]  # [num_masks]
        best = int(scores.argmax().item())
        mask = masks[0][0][best].to(image.dtype)
        if feather > 0.0:
            from math import ceil as _ceil
            from torchvision.transforms.functional import gaussian_blur
            ksize = 2 * _ceil(3.0 * feather) + 1
            mask = gaussian_blur(mask.unsqueeze(0).unsqueeze(0), kernel_size=ksize, sigma=feather).squeeze()
        if invert:
            mask = 1.0 - mask
        mask = mask.clamp(0.0, 1.0).unsqueeze(0)  # [1, H, W]
        preview = _mask_preview(image, mask)
        return IO.NodeOutput(mask, ui=save_live_preview(preview, str(cls.hidden.unique_id)))


class MatteMLExtension(ComfyExtension):
    @override
    async def get_node_list(self) -> list[type[IO.ComfyNode]]:
        return [MaskByTextNode, MaskExtractorNode]


async def comfy_entrypoint() -> MatteMLExtension:
    return MatteMLExtension()
