"""ComfyNext durable Project persistence — Phase 0.

See docs/plans/2026-06-02-phase0-project-persistence-spec.md.

Promotes the implicit `workflow.extra.projectUuid` grouping into a durable,
server-persisted Project so work survives tab close / frontend reload — the
substrate that Versions and Takes persist into.

Two layers:
  * a PURE storage layer (functions taking an explicit `root` dir) — no ComfyUI
    imports, unit-tested in tests-unit/comfy_api_test/projects_storage_test.py;
  * a thin aiohttp route shell registered on the ComfyUI PromptServer, mirroring
    the /comfynext/assets precedent in nodes_timeline.py.

On-disk layout (under the ComfyUI user dir):
    user/comfynext/projects/<uuid>/project.json
    user/comfynext/projects/<uuid>/versions/<vid>.json
"""
from __future__ import annotations

import json
import os
import shutil
import tempfile


# ---------- pure storage layer (dependency-light, unit-tested) --------------

def projects_root(user_dir: str) -> str:
    return os.path.join(user_dir, "comfynext", "projects")


def _is_safe_id(value) -> bool:
    """Guard against path traversal. IDs are our own (uuids / `v_<hex>`), so a
    conservative allowlist is fine: non-empty, no separators, no parent refs."""
    return (
        isinstance(value, str)
        and bool(value)
        and "/" not in value
        and "\\" not in value
        and ".." not in value
        and not value.startswith(".")
    )


def _project_dir(root: str, uuid: str) -> str:
    return os.path.join(root, uuid)


def _project_file(root: str, uuid: str) -> str:
    return os.path.join(_project_dir(root, uuid), "project.json")


def _version_file(root: str, uuid: str, vid: str) -> str:
    return os.path.join(_project_dir(root, uuid), "versions", f"{vid}.json")


def _read_json(path: str):
    try:
        with open(path, "r", encoding="utf-8") as f:
            return json.load(f)
    except (OSError, json.JSONDecodeError):
        return None


def _atomic_write_json(path: str, data) -> None:
    """Write JSON atomically (temp file + os.replace) so a crash mid-write can't
    leave a half-written project.json — concurrent tab saves stay consistent."""
    directory = os.path.dirname(path)
    os.makedirs(directory, exist_ok=True)
    fd, tmp = tempfile.mkstemp(dir=directory, suffix=".tmp")
    try:
        with os.fdopen(fd, "w", encoding="utf-8") as f:
            json.dump(data, f, indent=2)
        os.replace(tmp, path)  # atomic on the same filesystem
    finally:
        if os.path.exists(tmp):
            try:
                os.remove(tmp)
            except OSError:
                pass


def read_project(root: str, uuid: str) -> dict | None:
    if not _is_safe_id(uuid):
        return None
    return _read_json(_project_file(root, uuid))


def write_project(root: str, project: dict) -> dict:
    uuid = project.get("uuid")
    if not _is_safe_id(uuid):
        raise ValueError("invalid project uuid")
    _atomic_write_json(_project_file(root, uuid), project)
    return project


def list_projects(root: str) -> list[dict]:
    """Index view (metadata only) for the Home list — newest first."""
    out: list[dict] = []
    if not os.path.isdir(root):
        return out
    for name in os.listdir(root):
        data = _read_json(_project_file(root, name))
        if not data:
            continue
        out.append({
            "uuid": data.get("uuid", name),
            "name": data.get("name"),
            "cover": data.get("cover"),
            "updatedAt": data.get("updatedAt"),
        })
    out.sort(key=lambda d: d.get("updatedAt") or 0, reverse=True)
    return out


def delete_project(root: str, uuid: str) -> bool:
    if not _is_safe_id(uuid):
        return False
    d = _project_dir(root, uuid)
    if os.path.isdir(d):
        shutil.rmtree(d, ignore_errors=True)
        return True
    return False


def ensure_project(root: str, uuid: str, *, name: str = "Untitled project", now: int = 0) -> dict:
    """Return the project, creating an empty one on first use."""
    existing = read_project(root, uuid)
    if existing:
        return existing
    if not _is_safe_id(uuid):
        raise ValueError("invalid project uuid")
    project = {
        "uuid": uuid,
        "name": name,
        "cover": None,
        "createdAt": now,
        "updatedAt": now,
        "currentVersionId": None,
        "versionIndex": [],
    }
    return write_project(root, project)


def write_version(root: str, uuid: str, version: dict, *, now: int = 0) -> dict:
    """Persist a ProjectVersion body, append it to the project's index, and make
    it current. Returns the updated project. Raises KeyError if the project
    doesn't exist (caller should ensure_project first)."""
    project = read_project(root, uuid)
    if project is None:
        raise KeyError(f"project not found: {uuid}")
    vid = version.get("id")
    if not _is_safe_id(vid):
        raise ValueError("invalid version id")
    _atomic_write_json(_version_file(root, uuid, vid), version)
    meta = {
        "id": vid,
        "name": version.get("name"),
        "createdAt": version.get("createdAt"),
        "parentId": version.get("parentId"),
    }
    index = [m for m in project.get("versionIndex", []) if m.get("id") != vid]
    index.append(meta)
    project["versionIndex"] = index
    project["currentVersionId"] = vid
    project["updatedAt"] = now or version.get("createdAt") or project.get("updatedAt")
    write_project(root, project)
    return project


def read_version(root: str, uuid: str, vid: str) -> dict | None:
    if not (_is_safe_id(uuid) and _is_safe_id(vid)):
        return None
    return _read_json(_version_file(root, uuid, vid))


# ---------- aiohttp routes (thin shell over the storage layer) --------------

try:
    import time as _time
    import uuid as _uuidlib

    import folder_paths
    from aiohttp import web
    from server import PromptServer

    def _root() -> str:
        return projects_root(folder_paths.get_user_directory())

    def _now_ms() -> int:
        return int(_time.time() * 1000)

    @PromptServer.instance.routes.get("/comfynext/projects")
    async def _projects_list_route(_request):
        return web.json_response({"projects": list_projects(_root())})

    @PromptServer.instance.routes.get("/comfynext/projects/{uuid}")
    async def _projects_get_route(request):
        uid = request.match_info["uuid"]
        project = read_project(_root(), uid)
        if project is None:
            return web.json_response({"error": "not found"}, status=404)
        cur = project.get("currentVersionId")
        version = read_version(_root(), uid, cur) if cur else None
        return web.json_response({"project": project, "currentVersion": version})

    @PromptServer.instance.routes.put("/comfynext/projects/{uuid}")
    async def _projects_put_route(request):
        uid = request.match_info["uuid"]
        try:
            body = await request.json()
        except Exception as e:
            return web.json_response({"error": f"bad json: {e}"}, status=400)
        project = read_project(_root(), uid)
        if project is None:
            project = ensure_project(_root(), uid, name=body.get("name") or "Untitled project", now=_now_ms())
        if "name" in body:
            project["name"] = body["name"]
        if "cover" in body:
            project["cover"] = body["cover"]
        project["updatedAt"] = _now_ms()
        write_project(_root(), project)
        return web.json_response({"project": project})

    @PromptServer.instance.routes.delete("/comfynext/projects/{uuid}")
    async def _projects_delete_route(request):
        delete_project(_root(), request.match_info["uuid"])
        return web.json_response({"ok": True})

    @PromptServer.instance.routes.post("/comfynext/projects/{uuid}/versions")
    async def _versions_post_route(request):
        uid = request.match_info["uuid"]
        try:
            body = await request.json()
        except Exception as e:
            return web.json_response({"error": f"bad json: {e}"}, status=400)
        now = _now_ms()
        ensure_project(_root(), uid, name=body.get("projectName") or "Untitled project", now=now)
        version = dict(body.get("version") or body)
        version["id"] = version.get("id") or f"v_{_uuidlib.uuid4().hex[:12]}"
        version.setdefault("createdAt", now)
        version.setdefault("name", "")
        version.setdefault("parentId", None)
        try:
            write_version(_root(), uid, version, now=now)
        except (KeyError, ValueError) as e:
            return web.json_response({"error": str(e)}, status=400)
        return web.json_response({"id": version["id"]})

    @PromptServer.instance.routes.get("/comfynext/projects/{uuid}/versions/{vid}")
    async def _versions_get_route(request):
        version = read_version(_root(), request.match_info["uuid"], request.match_info["vid"])
        if version is None:
            return web.json_response({"error": "not found"}, status=404)
        return web.json_response({"version": version})

except Exception as e:  # pragma: no cover - exercised only at server boot
    # No PromptServer (e.g. imported in a test / headless context) — the pure
    # storage layer above is still usable and tested directly.
    print(f"[ComfyNext] project routes not registered: {e}")


# ComfyUI expects these symbols from a comfy_extras module.
NODE_CLASS_MAPPINGS: dict = {}
NODE_DISPLAY_NAME_MAPPINGS: dict = {}
