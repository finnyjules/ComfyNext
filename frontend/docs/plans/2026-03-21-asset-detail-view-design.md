# Asset Detail View Design

## Overview

Clicking a thumbnail in the Assets grid opens a full-screen overlay showing the image at large size with metadata, actions, and comments in a right sidebar.

## Layout

Full-screen overlay with dark backdrop. Two-column layout:

- **Left:** Large image, aspect-ratio preserved, centered
- **Right sidebar (360px):** Scrollable metadata panel

## Right Sidebar Sections

1. **Header** — Filename, formatted date ("Mar 21, 2026 at 3:42 PM"), execution time
2. **Actions** — Icon buttons: Like, Save, Download, Open Workflow
3. **Workflow info** — Output node class_type (e.g. "SaveImage"), workflow name if available from extra_pnginfo
4. **Prompt** — Extract text from CLIPTextEncode nodes in the prompt dict. Collapsible if long.
5. **Dimensions** — Image width × height from naturalWidth/naturalHeight
6. **Comments** — Local-only comment list stored in localStorage keyed by promptId

## "Open Workflow" Action

1. Open a new project tab via `openTab({ type: 'project' })`
2. Send `postMessage` to ComfyUI iframe with the prompt/workflow data from history
3. Bridge extension receives message and calls `app.loadGraphData()` with workflow JSON

## Data Source

All metadata from `/history/{prompt_id}`. PNG metadata only used for Open Workflow fallback.

## Not Building

- No image carousel / prev-next
- No server-side comment persistence
- No image editing/annotation
- No sharing/export
