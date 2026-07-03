#!/usr/bin/env python
"""Download a [start,end] audio segment of a YouTube video as mp3, for voice
cloning. Invoked by /api/voice-clone/from-youtube.

Usage: youtube_voice_clip.py <url> <start_sec> <end_sec> <out_path.mp3>

Prints the output path on success; exits non-zero with a message on stderr on
failure. Uses a pip-provided ffmpeg (imageio-ffmpeg) so no system ffmpeg is
needed. The clip is capped at 60s (MiniMax voice cloning wants a short clean
sample, not a whole video)."""
import os
import sys

import static_ffmpeg
import yt_dlp

# Add cached static ffmpeg + ffprobe to PATH so yt-dlp's segment download +
# audio extraction work without a system ffmpeg install.
static_ffmpeg.add_paths()

MAX_CLIP_SEC = 60.0


def main() -> int:
    if len(sys.argv) != 5:
        print("usage: youtube_voice_clip.py <url> <start> <end> <out.mp3>", file=sys.stderr)
        return 2
    url, start_s, end_s, out_path = sys.argv[1], sys.argv[2], sys.argv[3], sys.argv[4]
    try:
        start = max(0.0, float(start_s))
        end = float(end_s)
    except ValueError:
        print("start and end must be numbers (seconds)", file=sys.stderr)
        return 2
    if end <= start:
        print("end must be greater than start", file=sys.stderr)
        return 2
    end = min(end, start + MAX_CLIP_SEC)

    base = out_path[:-4] if out_path.lower().endswith(".mp3") else out_path
    ydl_opts = {
        "format": "bestaudio/best",
        "download_ranges": yt_dlp.utils.download_range_func(None, [(start, end)]),
        "force_keyframes_at_cuts": True,
        "postprocessors": [{
            "key": "FFmpegExtractAudio",
            "preferredcodec": "mp3",
            "preferredquality": "192",
        }],
        "outtmpl": base + ".%(ext)s",
        "quiet": True,
        "no_warnings": True,
        "noprogress": True,
        "noplaylist": True,
    }
    try:
        with yt_dlp.YoutubeDL(ydl_opts) as ydl:
            ydl.download([url])
    except Exception as e:  # noqa: BLE001 — surface any yt-dlp failure cleanly
        print(f"download failed: {e}", file=sys.stderr)
        return 1

    final = base + ".mp3"
    if not os.path.isfile(final) or os.path.getsize(final) == 0:
        print("no audio produced (check the URL and timestamps)", file=sys.stderr)
        return 1

    # Host on fal (public CDN) so MiniMax voice-cloning — a proxy that fetches
    # voice_file externally — can download it. A Replicate Files URL is auth-gated
    # and fails ("invalid file ext"). Print the public URL prefixed so the route
    # picks it out cleanly.
    try:
        url_out = _upload_fal(final)
    except Exception as e:  # noqa: BLE001
        print(f"upload failed: {e}", file=sys.stderr)
        return 1
    finally:
        try:
            os.remove(final)
        except OSError:
            pass
    print(f"FALURL:{url_out}")
    return 0


def _fal_token() -> str:
    for name in ("FAL_KEY", "NUXT_FAL_TOKEN"):
        v = os.environ.get(name, "").strip()
        if v:
            return v
    here = os.path.dirname(os.path.abspath(__file__))
    root = os.path.dirname(here)
    for p in (os.path.join(root, "frontend", ".env"), os.path.join(root, ".env")):
        try:
            with open(p, "r", encoding="utf-8") as f:
                for line in f:
                    s = line.strip()
                    for name in ("FAL_KEY", "NUXT_FAL_TOKEN"):
                        if s.startswith(name + "="):
                            v = s.split("=", 1)[1].strip().strip('"').strip("'")
                            if v:
                                return v
        except OSError:
            continue
    raise RuntimeError("FAL_KEY not found (set it in frontend/.env)")


def _upload_fal(path: str) -> str:
    import json
    import urllib.request
    key = _fal_token()
    init_req = urllib.request.Request(
        "https://rest.alpha.fal.ai/storage/upload/initiate?storage_type=fal-cdn-v3",
        data=json.dumps({"content_type": "audio/mpeg", "file_name": os.path.basename(path)}).encode(),
        headers={"Authorization": f"Key {key}", "Content-Type": "application/json"},
    )
    init = json.loads(urllib.request.urlopen(init_req).read().decode())
    file_url, upload_url = init.get("file_url"), init.get("upload_url")
    if not (file_url and upload_url):
        raise RuntimeError(f"fal initiate returned no urls: {init}")
    with open(path, "rb") as f:
        data = f.read()
    urllib.request.urlopen(urllib.request.Request(
        upload_url, data=data, method="PUT", headers={"Content-Type": "audio/mpeg"}))
    return file_url


if __name__ == "__main__":
    raise SystemExit(main())
