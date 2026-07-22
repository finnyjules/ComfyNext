"""Sailor durable Project persistence — Phase 0.

See docs/plans/2026-06-02-phase0-project-persistence-spec.md.

Promotes the implicit `workflow.extra.projectUuid` grouping into a durable,
server-persisted Project so work survives tab close / frontend reload — the
substrate that Versions and Takes persist into.

Two layers:
  * a PURE storage layer (functions taking an explicit `root` dir) — no ComfyUI
    imports, unit-tested in tests-unit/comfy_api_test/projects_storage_test.py;
  * a thin aiohttp route shell registered on the ComfyUI PromptServer, mirroring
    the /sailor/assets precedent in nodes_timeline.py.

On-disk layout (under the ComfyUI user dir):
    user/sailor/projects/<uuid>/project.json
    user/sailor/projects/<uuid>/versions/<vid>.json
"""
from __future__ import annotations

import datetime
import json
import os
import shutil
import tempfile
import uuid as uuidlib


# ---------- pure storage layer (dependency-light, unit-tested) --------------

def projects_root(user_dir: str) -> str:
    return os.path.join(user_dir, "sailor", "projects")


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


# The rolling autosave overwrites versions/current.json in place, so a stale
# client saving after a fresh one silently destroys the only durable copy of
# the newer graph. Before each overwrite of ROLLING_VERSION_ID we archive the
# outgoing body as an immutable `b_<createdAt>` backup version — spaced at
# least BACKUP_MIN_INTERVAL_MS apart (state-time, not wall-time) so the 3 s
# debounced autosave doesn't spray one per keystroke burst, and pruned to the
# newest BACKUP_KEEP. Backups live in the normal versionIndex (parentId
# "current"), so the existing version menu restores them with no UI changes.
ROLLING_VERSION_ID = "current"
BACKUP_PREFIX = "b_"
BACKUP_MIN_INTERVAL_MS = 10 * 60 * 1000
BACKUP_KEEP = 20


class StaleRollingWriteError(Exception):
    """Invariant: a rolling-current write must carry a doc savedAt >= the stored
    one — a stale window may not clobber a fresher save. Missing stamps on
    either side pass (legacy docs must keep saving)."""

    def __init__(self, stored_saved_at: int):
        super().__init__(f"stale rolling write: stored savedAt {stored_saved_at} is newer")
        self.stored_saved_at = stored_saved_at


def _doc_saved_at(version: dict) -> int | None:
    """The client recency stamp at version["workflow"]["savedAt"], or None."""
    workflow = version.get("workflow") if isinstance(version, dict) else None
    if not isinstance(workflow, dict):
        return None
    saved_at = workflow.get("savedAt")
    # bool is a subclass of int — exclude it explicitly.
    if isinstance(saved_at, bool) or not isinstance(saved_at, (int, float)):
        return None
    return int(saved_at)


def _archive_rolling_version(root: str, uuid: str, project: dict, *, now: int) -> None:
    """Archive the current rolling body into the project's index (mutated in
    place; caller persists). Best-effort: any failure skips the backup, never
    the save itself."""
    try:
        old = _read_json(_version_file(root, uuid, ROLLING_VERSION_ID))
        if not isinstance(old, dict):
            return
        old_ts = old.get("createdAt") or now
        index = list(project.get("versionIndex", []))
        backup_ts = [m.get("createdAt") or 0 for m in index
                     if str(m.get("id", "")).startswith(BACKUP_PREFIX)]
        if backup_ts and old_ts - max(backup_ts) <= BACKUP_MIN_INTERVAL_MS:
            return
        bid = f"{BACKUP_PREFIX}{old_ts}"
        if not _is_safe_id(bid):
            return
        body = dict(old)
        body["id"] = bid
        body["name"] = "Auto backup"
        _atomic_write_json(_version_file(root, uuid, bid), body)
        index = [m for m in index if m.get("id") != bid]
        index.append({"id": bid, "name": "Auto backup", "createdAt": old_ts,
                      "parentId": ROLLING_VERSION_ID})
        backups = sorted(
            (m for m in index if str(m.get("id", "")).startswith(BACKUP_PREFIX)),
            key=lambda m: m.get("createdAt") or 0, reverse=True)
        for meta in backups[BACKUP_KEEP:]:
            index = [m for m in index if m.get("id") != meta["id"]]
            try:
                os.remove(_version_file(root, uuid, meta["id"]))
            except OSError:
                pass
        project["versionIndex"] = index
    except OSError:
        pass


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
    if vid == ROLLING_VERSION_ID:
        old = _read_json(_version_file(root, uuid, ROLLING_VERSION_ID))
        old_saved_at = _doc_saved_at(old) if isinstance(old, dict) else None
        new_saved_at = _doc_saved_at(version)
        if old_saved_at is not None and new_saved_at is not None and new_saved_at < old_saved_at:
            raise StaleRollingWriteError(old_saved_at)
        _archive_rolling_version(root, uuid, project, now=now)
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


def _generations_file(root: str, uuid: str) -> str:
    return os.path.join(_project_dir(root, uuid), "generations.jsonl")


def list_generations(root: str, uuid: str) -> list[dict]:
    """All recorded runs for a project, newest first. Corrupt or truncated
    lines (e.g. a crash mid-append) are skipped, never fatal."""
    if not _is_safe_id(uuid):
        return []
    out: list[dict] = []
    try:
        with open(_generations_file(root, uuid), "r", encoding="utf-8") as f:
            for line in f:
                line = line.strip()
                if not line:
                    continue
                try:
                    rec = json.loads(line)
                except json.JSONDecodeError:
                    continue
                if isinstance(rec, dict):
                    out.append(rec)
    except OSError:
        return []
    out.sort(key=lambda g: g.get("ts") or 0, reverse=True)
    return out


def append_generation(root: str, uuid: str, record: dict, *, now: int = 0) -> dict | None:
    """Append one run record (JSONL). Dedup by promptId so history backfill is
    idempotent — returns None when that promptId is already recorded."""
    if not _is_safe_id(uuid):
        raise ValueError("invalid project uuid")
    pid = record.get("promptId")
    if pid and any(g.get("promptId") == pid for g in list_generations(root, uuid)):
        return None
    rec = dict(record)
    rec.setdefault("id", f"g_{uuidlib.uuid4().hex[:12]}")
    rec.setdefault("ts", now)
    path = _generations_file(root, uuid)
    os.makedirs(os.path.dirname(path), exist_ok=True)
    with open(path, "a", encoding="utf-8") as f:
        f.write(json.dumps(rec) + "\n")
    return rec


def spend_file(user_dir: str) -> str:
    """Global spend ledger — NOT under projects/, so deleting a project keeps
    its historical spend (the ledger stays accurate)."""
    return os.path.join(user_dir, "sailor", "spend.jsonl")


def append_spend(path: str, entry: dict) -> None:
    """Append one ledger line. Free runs (no usd, no credits) are not logged."""
    usd = entry.get("usd") or 0
    credits = entry.get("credits") or 0
    if usd <= 0 and credits <= 0:
        return
    os.makedirs(os.path.dirname(path), exist_ok=True)
    with open(path, "a", encoding="utf-8") as f:
        f.write(json.dumps(entry) + "\n")


def _month_key(ts_ms: int) -> str:
    dt = datetime.datetime.fromtimestamp((ts_ms or 0) / 1000, datetime.timezone.utc)
    return dt.strftime("%Y-%m")


def spend_summary(path: str, *, now_ms: int) -> dict:
    """Totals for the current UTC calendar month, all time, and per project."""
    month = {"usd": 0, "credits": 0}
    total = {"usd": 0, "credits": 0}
    by_project: dict[str, dict] = {}
    cur = _month_key(now_ms)
    try:
        with open(path, "r", encoding="utf-8") as f:
            lines = f.readlines()
    except OSError:
        lines = []
    for line in lines:
        line = line.strip()
        if not line:
            continue
        try:
            e = json.loads(line)
        except json.JSONDecodeError:
            continue
        if not isinstance(e, dict):
            continue
        usd = float(e.get("usd") or 0)
        credits = e.get("credits") or 0
        total["usd"] += usd
        total["credits"] += credits
        if _month_key(e.get("ts") or 0) == cur:
            month["usd"] += usd
            month["credits"] += credits
        pu = e.get("projectUuid") or "unknown"
        bp = by_project.setdefault(pu, {"uuid": pu, "usd": 0, "credits": 0})
        bp["usd"] += usd
        bp["credits"] += credits
    ranked = sorted(by_project.values(), key=lambda d: -d["usd"])
    return {"month": month, "total": total, "byProject": ranked}


# ---------- aiohttp routes (thin shell over the storage layer) --------------

try:
    import time as _time
    import uuid as _uuidlib

    import folder_paths
    from aiohttp import web
    from server import PromptServer

    def _migrate_legacy_user_dir() -> None:
        """One-time rename of the pre-rebrand user data dir (Sailor was formerly
        "ComfyNext"). Moves <user>/comfynext -> <user>/sailor in place so existing
        projects, assets, spend, and timeline data survive the rename on
        environments (e.g. the Fly volume) that still hold the legacy dir. Idempotent:
        no-ops once the new dir exists."""
        try:
            base = folder_paths.get_user_directory()
            legacy = os.path.join(base, "comfynext")
            current = os.path.join(base, "sailor")
            if os.path.isdir(legacy) and not os.path.exists(current):
                os.rename(legacy, current)
        except Exception:
            pass  # never let a data migration block server boot

    def _migrate_legacy_project_keys() -> None:
        """One-time rebrand migration for saved project JSON. Pre-rename projects
        store node properties under `comfynext_*` keys and annotations under
        `workflow.extra.comfynext`; the renamed frontend reads `sailor_*` /
        `extra.sailor`, so that config is invisible until the KEYS are renamed.
        KEYS ONLY — values are preserved verbatim: they legitimately reference
        on-disk files that keep legacy names (e.g. input/comfynext_frame_*.png).
        Guarded by a marker file so the walk runs once per volume; atomic writes
        mirror _atomic_write's tmp+replace pattern."""
        try:
            root = projects_root(folder_paths.get_user_directory())
            marker = os.path.join(os.path.dirname(root), ".migrated-project-keys-v1")
            if os.path.exists(marker) or not os.path.isdir(root):
                return

            def rename_key(k):
                if k == "comfynext":
                    return "sailor"
                if isinstance(k, str) and k.startswith("comfynext_"):
                    return "sailor_" + k[len("comfynext_"):]
                return k

            def walk(obj):
                if isinstance(obj, dict):
                    out = {}
                    for k, v in obj.items():
                        nk = rename_key(k)
                        if nk in out:  # half-migrated: keep existing sailor_* value
                            continue
                        out[nk] = walk(v)
                    return out
                if isinstance(obj, list):
                    return [walk(v) for v in obj]
                return obj

            for dirpath, _dirs, files in os.walk(root):
                for name in files:
                    if not name.endswith(".json"):
                        continue
                    path = os.path.join(dirpath, name)
                    try:
                        with open(path, "r", encoding="utf-8") as f:
                            raw = f.read()
                        if '"comfynext' not in raw:
                            continue  # keys always appear quote-prefixed in JSON
                        migrated = walk(json.loads(raw))
                        tmp = path + ".migtmp"
                        with open(tmp, "w", encoding="utf-8") as f:
                            json.dump(migrated, f, ensure_ascii=False, separators=(",", ":"))
                        os.replace(tmp, path)
                    except Exception:
                        continue  # skip unreadable file, migrate the rest
            with open(marker, "w", encoding="utf-8") as f:
                f.write("1\n")
        except Exception:
            pass  # never let a data migration block server boot

    _migrate_legacy_user_dir()
    _migrate_legacy_project_keys()

    def _root() -> str:
        return projects_root(folder_paths.get_user_directory())

    def _now_ms() -> int:
        return int(_time.time() * 1000)

    @PromptServer.instance.routes.get("/sailor/projects")
    async def _projects_list_route(_request):
        return web.json_response({"projects": list_projects(_root())})

    @PromptServer.instance.routes.get("/sailor/projects/{uuid}")
    async def _projects_get_route(request):
        uid = request.match_info["uuid"]
        project = read_project(_root(), uid)
        if project is None:
            return web.json_response({"error": "not found"}, status=404)
        cur = project.get("currentVersionId")
        version = read_version(_root(), uid, cur) if cur else None
        return web.json_response({"project": project, "currentVersion": version})

    @PromptServer.instance.routes.put("/sailor/projects/{uuid}")
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

    @PromptServer.instance.routes.delete("/sailor/projects/{uuid}")
    async def _projects_delete_route(request):
        delete_project(_root(), request.match_info["uuid"])
        return web.json_response({"ok": True})

    @PromptServer.instance.routes.post("/sailor/projects/{uuid}/versions")
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
        except StaleRollingWriteError as e:
            return web.json_response({"error": "stale", "storedSavedAt": e.stored_saved_at}, status=409)
        except (KeyError, ValueError) as e:
            return web.json_response({"error": str(e)}, status=400)
        return web.json_response({"id": version["id"]})

    @PromptServer.instance.routes.get("/sailor/projects/{uuid}/versions/{vid}")
    async def _versions_get_route(request):
        version = read_version(_root(), request.match_info["uuid"], request.match_info["vid"])
        if version is None:
            return web.json_response({"error": "not found"}, status=404)
        return web.json_response({"version": version})

    @PromptServer.instance.routes.post("/sailor/projects/{uuid}/generations")
    async def _generations_post_route(request):
        uid = request.match_info["uuid"]
        try:
            body = await request.json()
        except Exception as e:
            return web.json_response({"error": f"bad json: {e}"}, status=400)
        now = _now_ms()
        record = dict(body.get("generation") or {})
        record.setdefault("id", f"g_{_uuidlib.uuid4().hex[:12]}")
        record.setdefault("ts", now)
        try:
            ensure_project(_root(), uid, name=body.get("projectName") or "Untitled project", now=now)
            stored = append_generation(_root(), uid, record, now=now)
        except ValueError as e:
            return web.json_response({"error": str(e)}, status=400)
        if stored is None:  # promptId already recorded (backfill re-post)
            return web.json_response({"id": record["id"], "deduped": True})
        append_spend(spend_file(folder_paths.get_user_directory()), {
            "ts": stored.get("ts"),
            "projectUuid": uid,
            "promptId": stored.get("promptId"),
            "usd": stored.get("usd"),
            "credits": stored.get("credits"),
        })
        project = read_project(_root(), uid)
        if project:
            project["updatedAt"] = now
            write_project(_root(), project)
        return web.json_response({"id": stored["id"]})

    @PromptServer.instance.routes.get("/sailor/projects/{uuid}/generations")
    async def _generations_list_route(request):
        return web.json_response({"generations": list_generations(_root(), request.match_info["uuid"])})

    @PromptServer.instance.routes.get("/sailor/spend/summary")
    async def _spend_summary_route(_request):
        path = spend_file(folder_paths.get_user_directory())
        return web.json_response(spend_summary(path, now_ms=_now_ms()))

except Exception as e:  # pragma: no cover - exercised only at server boot
    # No PromptServer (e.g. imported in a test / headless context) — the pure
    # storage layer above is still usable and tested directly.
    print(f"[Sailor] project routes not registered: {e}")


# ComfyUI expects these symbols from a comfy_extras module.
NODE_CLASS_MAPPINGS: dict = {}
NODE_DISPLAY_NAME_MAPPINGS: dict = {}
