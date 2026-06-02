from __future__ import annotations

import os
import av
import torch
import folder_paths
import json
from typing import Optional
from typing_extensions import override
from fractions import Fraction
from comfy_api.latest import ComfyExtension, io, ui, Input, InputImpl, Types
from comfy.cli_args import args

class SaveWEBM(io.ComfyNode):
    @classmethod
    def define_schema(cls):
        return io.Schema(
            node_id="SaveWEBM",
            search_aliases=["export webm"],
            category="image/video",
            is_experimental=True,
            inputs=[
                io.Image.Input("images"),
                io.String.Input("filename_prefix", default="ComfyUI"),
                io.Combo.Input("codec", options=["vp9", "av1"]),
                io.Float.Input("fps", default=24.0, min=0.01, max=1000.0, step=0.01),
                io.Float.Input("crf", default=32.0, min=0, max=63.0, step=1, tooltip="Higher crf means lower quality with a smaller file size, lower crf means higher quality higher filesize."),
            ],
            hidden=[io.Hidden.prompt, io.Hidden.extra_pnginfo],
            is_output_node=True,
        )

    @classmethod
    def execute(cls, images, codec, fps, filename_prefix, crf) -> io.NodeOutput:
        full_output_folder, filename, counter, subfolder, filename_prefix = folder_paths.get_save_image_path(
            filename_prefix, folder_paths.get_output_directory(), images[0].shape[1], images[0].shape[0]
        )

        file = f"{filename}_{counter:05}_.webm"
        container = av.open(os.path.join(full_output_folder, file), mode="w")

        if cls.hidden.prompt is not None:
            container.metadata["prompt"] = json.dumps(cls.hidden.prompt)

        if cls.hidden.extra_pnginfo is not None:
            for x in cls.hidden.extra_pnginfo:
                container.metadata[x] = json.dumps(cls.hidden.extra_pnginfo[x])

        codec_map = {"vp9": "libvpx-vp9", "av1": "libsvtav1"}
        stream = container.add_stream(codec_map[codec], rate=Fraction(round(fps * 1000), 1000))
        stream.width = images.shape[-2]
        stream.height = images.shape[-3]
        stream.pix_fmt = "yuv420p10le" if codec == "av1" else "yuv420p"
        stream.bit_rate = 0
        stream.options = {'crf': str(crf)}
        if codec == "av1":
            stream.options["preset"] = "6"

        for frame in images:
            frame = av.VideoFrame.from_ndarray(torch.clamp(frame[..., :3] * 255, min=0, max=255).to(device=torch.device("cpu"), dtype=torch.uint8).numpy(), format="rgb24")
            for packet in stream.encode(frame):
                container.mux(packet)
        container.mux(stream.encode())
        container.close()

        return io.NodeOutput(ui=ui.PreviewVideo([ui.SavedResult(file, subfolder, io.FolderType.output)]))

class SaveVideo(io.ComfyNode):
    @classmethod
    def define_schema(cls):
        return io.Schema(
            node_id="SaveVideo",
            search_aliases=["export video"],
            display_name="Save Video",
            category="image/video",
            essentials_category="Basics",
            description="Saves the input images to your ComfyUI output directory.",
            inputs=[
                io.Video.Input("video", tooltip="The video to save."),
                io.String.Input("filename_prefix", default="video/ComfyUI", tooltip="The prefix for the file to save. This may include formatting information such as %date:yyyy-MM-dd% or %Empty Latent Image.width% to include values from nodes."),
                io.Combo.Input("format", options=Types.VideoContainer.as_input(), default="auto", tooltip="The format to save the video as."),
                io.Combo.Input("codec", options=Types.VideoCodec.as_input(), default="auto", tooltip="The codec to use for the video."),
            ],
            hidden=[io.Hidden.prompt, io.Hidden.extra_pnginfo],
            is_output_node=True,
        )

    @classmethod
    def execute(cls, video: Input.Video, filename_prefix, format: str, codec) -> io.NodeOutput:
        width, height = video.get_dimensions()
        full_output_folder, filename, counter, subfolder, filename_prefix = folder_paths.get_save_image_path(
            filename_prefix,
            folder_paths.get_output_directory(),
            width,
            height
        )
        saved_metadata = None
        if not args.disable_metadata:
            metadata = {}
            if cls.hidden.extra_pnginfo is not None:
                metadata.update(cls.hidden.extra_pnginfo)
            if cls.hidden.prompt is not None:
                metadata["prompt"] = cls.hidden.prompt
            if len(metadata) > 0:
                saved_metadata = metadata
        file = f"{filename}_{counter:05}_.{Types.VideoContainer.get_extension(format)}"
        video.save_to(
            os.path.join(full_output_folder, file),
            format=Types.VideoContainer(format),
            codec=codec,
            metadata=saved_metadata
        )

        return io.NodeOutput(ui=ui.PreviewVideo([ui.SavedResult(file, subfolder, io.FolderType.output)]))


class CreateVideo(io.ComfyNode):
    @classmethod
    def define_schema(cls):
        return io.Schema(
            node_id="CreateVideo",
            search_aliases=["images to video"],
            display_name="Create Video",
            category="image/video",
            description="Create a video from images.",
            inputs=[
                io.Image.Input("images", tooltip="The images to create a video from."),
                io.Float.Input("fps", default=30.0, min=1.0, max=120.0, step=1.0),
                io.Audio.Input("audio", optional=True, tooltip="The audio to add to the video."),
            ],
            outputs=[
                io.Video.Output(),
            ],
        )

    @classmethod
    def execute(cls, images: Input.Image, fps: float, audio: Optional[Input.Audio] = None) -> io.NodeOutput:
        return io.NodeOutput(
            InputImpl.VideoFromComponents(Types.VideoComponents(images=images, audio=audio, frame_rate=Fraction(fps)))
        )

class GetVideoComponents(io.ComfyNode):
    @classmethod
    def define_schema(cls):
        return io.Schema(
            node_id="GetVideoComponents",
            search_aliases=["extract frames", "split video", "video to images", "demux"],
            display_name="Get Video Components",
            category="image/video",
            description="Extracts all components from a video: frames, audio, and framerate.",
            inputs=[
                io.Video.Input("video", tooltip="The video to extract components from."),
            ],
            outputs=[
                io.Image.Output(display_name="images"),
                io.Audio.Output(display_name="audio"),
                io.Float.Output(display_name="fps"),
            ],
        )

    @classmethod
    def execute(cls, video: Input.Video) -> io.NodeOutput:
        components = video.get_components()
        return io.NodeOutput(components.images, components.audio, float(components.frame_rate))


class LoadVideo(io.ComfyNode):
    @classmethod
    def define_schema(cls):
        input_dir = folder_paths.get_input_directory()
        files = [f for f in os.listdir(input_dir) if os.path.isfile(os.path.join(input_dir, f))]
        files = folder_paths.filter_files_content_types(files, ["video"])
        return io.Schema(
            node_id="LoadVideo",
            search_aliases=["import video", "open video", "video file"],
            display_name="Load Video",
            category="image/video",
            essentials_category="Basics",
            inputs=[
                io.Combo.Input("file", options=sorted(files), upload=io.UploadType.video),
            ],
            outputs=[
                io.Video.Output(),
            ],
        )

    @classmethod
    def execute(cls, file) -> io.NodeOutput:
        video_path = folder_paths.get_annotated_filepath(file)
        return io.NodeOutput(InputImpl.VideoFromFile(video_path))

    @classmethod
    def fingerprint_inputs(s, file):
        video_path = folder_paths.get_annotated_filepath(file)
        mod_time = os.path.getmtime(video_path)
        # Instead of hashing the file, we can just use the modification time to avoid
        # rehashing large files.
        return mod_time

    @classmethod
    def validate_inputs(s, file):
        if not folder_paths.exists_annotated_filepath(file):
            return "Invalid video file: {}".format(file)

        return True

class VideoSlice(io.ComfyNode):
    @classmethod
    def define_schema(cls):
        return io.Schema(
            node_id="Video Slice",
            display_name="Video Slice",
            search_aliases=[
                "trim video duration",
                "skip first frames",
                "frame load cap",
                "start time",
            ],
            category="image/video",
            essentials_category="Video Tools",
            inputs=[
                io.Video.Input("video"),
                io.Float.Input(
                    "start_time",
                    default=0.0,
                    max=1e5,
                    min=-1e5,
                    step=0.001,
                    tooltip="Start time in seconds",
                ),
                io.Float.Input(
                    "duration",
                    default=0.0,
                    min=0.0,
                    step=0.001,
                    tooltip="Duration in seconds, or 0 for unlimited duration",
                ),
                io.Boolean.Input(
                    "strict_duration",
                    default=False,
                    tooltip="If True, when the specified duration is not possible, an error will be raised.",
                ),
            ],
            outputs=[
                io.Video.Output(),
            ],
        )

    @classmethod
    def execute(cls, video: io.Video.Type, start_time: float, duration: float, strict_duration: bool) -> io.NodeOutput:
        trimmed = video.as_trimmed(start_time, duration, strict_duration=strict_duration)
        if trimmed is not None:
            return io.NodeOutput(trimmed)
        raise ValueError(
            f"Failed to slice video:\nSource duration: {video.get_duration()}\nStart time: {start_time}\nTarget duration: {duration}"
        )


class PreviewVideo(io.ComfyNode):
    """Preview a video directly inside the node, saving to a temp directory."""
    @classmethod
    def define_schema(cls):
        return io.Schema(
            node_id="PreviewVideo",
            display_name="Preview Video",
            category="image/video",
            description="Previews a video inside the node.",
            inputs=[
                io.Video.Input("video", tooltip="The video to preview."),
            ],
            outputs=[
                io.Video.Output(display_name="video", tooltip="Pass-through of the input video."),
            ],
            is_output_node=True,
        )

    @classmethod
    def execute(cls, video: Input.Video) -> io.NodeOutput:
        # Save to temp directory for preview
        width, height = video.get_dimensions()
        full_output_folder, filename, counter, subfolder, filename_prefix = folder_paths.get_save_image_path(
            "preview_video",
            folder_paths.get_temp_directory(),
            width,
            height,
        )
        file = f"{filename}_{counter:05}_.mp4"
        video.save_to(os.path.join(full_output_folder, file))

        return io.NodeOutput(
            video,
            ui=ui.PreviewVideo([ui.SavedResult(file, subfolder, io.FolderType.temp)]),
        )


class Video(io.ComfyNode):
    """Unified `Video` artifact node.

    Mirror of the Image / Audio / Text pattern. Acts as a source when the
    file widget is set, as a preview/pass-through when upstream video is
    wired, and as an exporter when `export` is on. The artifact card UI
    lives in `frontend/app/components/vue-canvas/ArtifactVideoNode.vue`.
    """

    @classmethod
    def define_schema(cls):
        input_dir = folder_paths.get_input_directory()
        files = [f for f in os.listdir(input_dir) if os.path.isfile(os.path.join(input_dir, f))]
        files = folder_paths.filter_files_content_types(files, ["video"])
        options = [""] + sorted(files)
        return io.Schema(
            node_id="Video",
            display_name="Video",
            description="Unified video artifact — load from disk, preview upstream, optionally export.",
            search_aliases=["video", "clip", "movie", "load video", "preview video", "save video"],
            category="image/video",
            essentials_category="Basics",
            is_output_node=True,
            inputs=[
                io.Combo.Input(
                    "file",
                    options=options,
                    default="",
                    upload=io.UploadType.video,
                    tooltip="File to load when no upstream is connected. Ignored when something is wired into `source`.",
                ),
                io.Boolean.Input(
                    "export",
                    default=False,
                    tooltip="Also save a copy to the output directory on run. Off = preview only.",
                ),
                io.String.Input("filename_prefix", default="video/ComfyUI"),
                io.Video.Input(
                    "source",
                    optional=True,
                    tooltip="Upstream video. Takes priority over the file widget.",
                ),
            ],
            outputs=[
                io.Video.Output(display_name="video"),
            ],
        )

    @classmethod
    def execute(cls, file, export, filename_prefix, source=None) -> io.NodeOutput:
        # Resolve source: upstream wins, then file widget. If neither, return
        # the pass-through with no UI preview — the card will stay empty.
        if source is not None:
            video = source
        elif file:
            video_path = folder_paths.get_annotated_filepath(file)
            video = InputImpl.VideoFromFile(video_path)
        else:
            return io.NodeOutput(None, ui={"images": []})

        # Always emit a preview (same path PreviewVideo uses).
        width, height = video.get_dimensions()
        full_output_folder, filename, counter, subfolder, _ = folder_paths.get_save_image_path(
            "preview_video",
            folder_paths.get_temp_directory(),
            width,
            height,
        )
        preview_file = f"{filename}_{counter:05}_.mp4"
        video.save_to(os.path.join(full_output_folder, preview_file))
        preview_ui = ui.PreviewVideo([ui.SavedResult(preview_file, subfolder, io.FolderType.temp)])

        if export:
            # Save a permanent copy to the output dir and point the card's
            # preview at *that* (FolderType.output) instead of the temp file.
            # ComfyUI wipes temp/ on restart, so a temp-only preview leaves the
            # canvas card broken even though the export survives in Assets —
            # same durability fix as the Image node.
            out_folder, out_name, out_counter, out_sub, _ = folder_paths.get_save_image_path(
                filename_prefix,
                folder_paths.get_output_directory(),
                width,
                height,
            )
            out_file = f"{out_name}_{out_counter:05}_.mp4"
            video.save_to(os.path.join(out_folder, out_file))
            preview_ui = ui.PreviewVideo([ui.SavedResult(out_file, out_sub, io.FolderType.output)])

        return io.NodeOutput(video, ui=preview_ui)

    @classmethod
    def fingerprint_inputs(cls, file, **_kwargs):
        if not file:
            return ""
        try:
            video_path = folder_paths.get_annotated_filepath(file)
            return os.path.getmtime(video_path)
        except Exception:
            return ""


class VideoExtension(ComfyExtension):
    @override
    async def get_node_list(self) -> list[type[io.ComfyNode]]:
        return [
            SaveWEBM,
            SaveVideo,
            CreateVideo,
            GetVideoComponents,
            LoadVideo,
            VideoSlice,
            PreviewVideo,
            Video,
        ]

async def comfy_entrypoint() -> VideoExtension:
    return VideoExtension()
