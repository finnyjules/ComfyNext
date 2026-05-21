"""Tiny helper endpoints for the LoRA Trainer surface.

The frontend uploads images via the stock /upload/image route (which already
supports a `subfolder` field), then posts captions here so they land as the
.txt sidecars that LoadImageTextDataSetFromFolder expects.

Also registers a curated set of base-checkpoint bundles so the surface can
offer one-click downloads when models/checkpoints/ is empty. The bundles are
registered against the same /comfynext/models/{status,download} routes the
toolbox uses.
"""
from __future__ import annotations

import os
import shutil

try:
    from aiohttp import web

    import folder_paths
    from server import PromptServer

    from comfy_extras._model_downloads import ModelBundle, ModelFile, register_bundle

    # Register curated training checkpoints. SDXL and SD1.5 ship as all-in-one
    # checkpoints (model+clip+vae packed) so they work directly with
    # CheckpointLoaderSimple. Flux ships as a multi-file bundle (unet + vae +
    # clip_l + t5xxl) that the trainer wires via UNETLoader/DualCLIPLoader/
    # VAELoader.
    _checkpoints_dir = folder_paths.get_folder_paths("checkpoints")[0]
    _diffusion_dir = folder_paths.get_folder_paths("diffusion_models")[0]
    _vae_dir = folder_paths.get_folder_paths("vae")[0]
    _text_encoders_dir = folder_paths.get_folder_paths("text_encoders")[0]

    register_bundle(ModelBundle(
        key="lora-base-sdxl",
        label="SDXL Base 1.0",
        files=[ModelFile(
            name="sd_xl_base_1.0.safetensors",
            path=os.path.join(_checkpoints_dir, "sd_xl_base_1.0.safetensors"),
            size=6_938_078_334,
            urls=[
                "https://huggingface.co/stabilityai/stable-diffusion-xl-base-1.0/resolve/main/sd_xl_base_1.0.safetensors",
            ],
        )],
    ))

    register_bundle(ModelBundle(
        key="lora-base-sd15",
        label="Stable Diffusion 1.5",
        files=[ModelFile(
            name="v1-5-pruned-emaonly.safetensors",
            path=os.path.join(_checkpoints_dir, "v1-5-pruned-emaonly.safetensors"),
            size=4_265_146_304,
            urls=[
                "https://huggingface.co/stable-diffusion-v1-5/stable-diffusion-v1-5/resolve/main/v1-5-pruned-emaonly.safetensors",
            ],
        )],
    ))

    register_bundle(ModelBundle(
        key="lora-base-flux-schnell",
        label="Flux.1 Schnell",
        files=[
            ModelFile(
                name="flux1-schnell.safetensors",
                path=os.path.join(_diffusion_dir, "flux1-schnell.safetensors"),
                size=23_782_506_688,
                urls=[
                    "https://huggingface.co/black-forest-labs/FLUX.1-schnell/resolve/main/flux1-schnell.safetensors",
                ],
            ),
            ModelFile(
                name="ae.safetensors",
                path=os.path.join(_vae_dir, "ae.safetensors"),
                size=335_304_388,
                urls=[
                    "https://huggingface.co/black-forest-labs/FLUX.1-schnell/resolve/main/ae.safetensors",
                ],
            ),
            ModelFile(
                name="clip_l.safetensors",
                path=os.path.join(_text_encoders_dir, "clip_l.safetensors"),
                size=246_144_152,
                urls=[
                    "https://huggingface.co/comfyanonymous/flux_text_encoders/resolve/main/clip_l.safetensors",
                ],
            ),
            ModelFile(
                name="t5xxl_fp8_e4m3fn.safetensors",
                path=os.path.join(_text_encoders_dir, "t5xxl_fp8_e4m3fn.safetensors"),
                size=4_893_934_904,
                urls=[
                    "https://huggingface.co/comfyanonymous/flux_text_encoders/resolve/main/t5xxl_fp8_e4m3fn.safetensors",
                ],
            ),
        ],
    ))

    _routes_registered = False

    def _safe_folder(folder: str) -> str:
        # Keep this strictly inside input/ — never let the client traverse out.
        input_dir = folder_paths.get_input_directory()
        normalized = os.path.normpath(folder).lstrip("/\\")
        full = os.path.join(input_dir, normalized)
        if os.path.commonpath((input_dir, full)) != input_dir:
            raise ValueError("folder escapes input directory")
        return full

    def _register_routes() -> None:
        global _routes_registered
        if _routes_registered:
            return
        _routes_registered = True

        @PromptServer.instance.routes.post("/comfynext/lora/save_captions")
        async def _save_captions(request):
            """Body: {folder: str, captions: {image_filename: text}}.

            For each (image_filename, text) pair, writes <stem>.txt next to the
            image in input/<folder>/. Returns {written: int}.
            """
            try:
                body = await request.json()
            except Exception:
                return web.json_response({"error": "invalid json"}, status=400)

            folder = body.get("folder") or ""
            captions = body.get("captions") or {}
            if not isinstance(folder, str) or not isinstance(captions, dict):
                return web.json_response({"error": "bad payload"}, status=400)

            try:
                target = _safe_folder(folder)
            except ValueError as e:
                return web.json_response({"error": str(e)}, status=400)
            if not os.path.isdir(target):
                return web.json_response({"error": f"folder not found: {folder}"}, status=404)

            written = 0
            for image_filename, text in captions.items():
                if not isinstance(image_filename, str) or not isinstance(text, str):
                    continue
                stem = os.path.splitext(os.path.basename(image_filename))[0]
                if not stem:
                    continue
                txt_path = os.path.join(target, f"{stem}.txt")
                with open(txt_path, "w", encoding="utf-8") as f:
                    f.write(text)
                written += 1
            return web.json_response({"written": written})

        @PromptServer.instance.routes.post("/comfynext/lora/clear_dataset")
        async def _clear_dataset(request):
            try:
                body = await request.json()
            except Exception:
                return web.json_response({"error": "invalid json"}, status=400)
            folder = body.get("folder") or ""
            if not isinstance(folder, str) or not folder:
                return web.json_response({"error": "bad payload"}, status=400)
            try:
                target = _safe_folder(folder)
            except ValueError as e:
                return web.json_response({"error": str(e)}, status=400)
            if os.path.isdir(target):
                shutil.rmtree(target, ignore_errors=True)
            return web.json_response({"ok": True})

    _register_routes()

except ImportError:
    pass
