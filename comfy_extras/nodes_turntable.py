from __future__ import annotations

"""Turntable node — a product packshot → seamless 360° spin video.

Front only → Luma Ray 2 720p with loop=True (one call, natively seamless; the
back/sides are inferred). Real right/back/left views wired → Seedance 2.0
first→last keyframe segments (each arc interpolates between two REAL supplied
photos, so the faces are correct), concatenated with PyAV; the loop closes by
construction (the final segment ends on the front = the first segment's start).

Front is required (0°); right/back/left sit at 90/180/270°. The pure segment
planner (_turntable_plan) decides the arcs from whatever is wired.
"""

from typing_extensions import override

from comfy_api.latest import ComfyExtension, IO, InputImpl
from comfy_extras._turntable_prompts import simple_spin_instruction, segment_instruction
from comfy_extras._turntable_plan import plan_segments
from comfy_extras._turntable_stitch import stitch_clips


class TurntableNode(IO.ComfyNode):
    @classmethod
    def define_schema(cls):
        return IO.Schema(
            node_id="TurntableNode",
            display_name="Turntable",
            category="api node/video/Replicate",
            description=(
                "Spin a product 360° into a seamless loop. Front only → Luma Ray 2 "
                "loop (back/sides inferred). Wire the real right/back/left views → "
                "Seedance stitches keyframe arcs through the true faces. "
                "~$0.50 front-only; ~$2–$6 with extra views."
            ),
            inputs=[
                IO.Image.Input("image", tooltip="Front view of the product (0°). The spin's start/end frame."),
                IO.Image.Input("right_reference", optional=True, tooltip="True right side (90°) — anchors that face."),
                IO.Image.Input("back_reference", optional=True, tooltip="True back (180°) — anchors that face."),
                IO.Image.Input("left_reference", optional=True, tooltip="True left side (270°) — anchors that face."),
                IO.Combo.Input("direction", options=["left", "right"], default="left", tooltip="Spin/rotation direction."),
                IO.String.Input("instructions", multiline=True, default="", optional=True, tooltip="Optional extra direction, appended."),
            ],
            outputs=[IO.Video.Output(display_name="video")],
            hidden=[IO.Hidden.unique_id],
            is_output_node=True,
            price_badge=IO.PriceBadge(expr='{"type":"usd","usd":0.50,"format":{"approximate":true}}'),
        )

    @classmethod
    async def execute(cls, image=None, right_reference=None, back_reference=None,
                      left_reference=None, direction="left", instructions="") -> IO.NodeOutput:
        if image is None:
            raise RuntimeError("Turntable requires a front image.")

        # Lazy import: video dispatch helpers live in the Replicate node module.
        from comfy_api_nodes.nodes_replicate import (
            _image_tensor_to_data_url, _dispatch_video_prediction, _VIDEO_MODELS_BY_ID,
        )

        views = {"front": image}
        if right_reference is not None:
            views["right"] = right_reference
        if back_reference is not None:
            views["back"] = back_reference
        if left_reference is not None:
            views["left"] = left_reference
        extra = set(views) - {"front"}

        # Path A — front only: Luma Ray 2 loop, single call.
        if not extra:
            spec = _VIDEO_MODELS_BY_ID["luma-ray-2-720p"]
            input_dict = spec.build_input(
                simple_spin_instruction(direction, instructions),
                "1:1", 5, 0, _image_tensor_to_data_url(image), None, {"loop": True},
            )
            video = await _dispatch_video_prediction(
                spec, input_dict, cls=cls, log_prefix="Turntable", model="luma-ray-2-720p")
            return IO.NodeOutput(video)

        # Path B — extra views: Seedance first→last keyframe segments, stitched.
        spec = _VIDEO_MODELS_BY_ID["seedance-2.0"]
        clip_sources = []
        for start_view, end_view, degrees in plan_segments(extra, direction):
            input_dict = spec.build_input(
                segment_instruction(degrees, direction, instructions),
                "1:1", 5, 0, _image_tensor_to_data_url(views[start_view]), None,
                {"end_image_url": _image_tensor_to_data_url(views[end_view])},
            )
            clip = await _dispatch_video_prediction(
                spec, input_dict, cls=cls, log_prefix="Turntable", model="seedance-2.0")
            clip_sources.append(clip.get_stream_source())

        stitched = stitch_clips(clip_sources)
        return IO.NodeOutput(InputImpl.VideoFromFile(stitched))


class TurntableExtension(ComfyExtension):
    @override
    async def get_node_list(self) -> list[type[IO.ComfyNode]]:
        return [TurntableNode]


async def comfy_entrypoint() -> TurntableExtension:
    return TurntableExtension()
