"""Turntable segment planner. Pure function (no deps) — decides the keyframe
arcs from whichever real views are wired. Angles: front 0°, right 90°, back
180°, left 270°."""
from __future__ import annotations

_ORDER = ["front", "right", "back", "left"]
_ANGLE = {"front": 0, "right": 90, "back": 180, "left": 270}


def plan_segments(extra_views, direction: str) -> list[tuple[str, str, int]]:
    """Ordered (start_view, end_view, degrees) arcs that walk the provided views
    around the full circle and close back to front. `extra_views` is a subset of
    {"right","back","left"}; front is always present. Segment degrees sum to 360.
    """
    extra = set(extra_views)
    views = [v for v in _ORDER if v == "front" or v in extra]  # ascending by angle, front first
    if len(views) == 1:
        return [("front", "front", 360)]
    seq = views[:] if direction == "left" else [views[0]] + views[:0:-1]
    segs: list[tuple[str, str, int]] = []
    n = len(seq)
    for i in range(n):
        a, b = seq[i], seq[(i + 1) % n]
        if direction == "left":
            deg = (_ANGLE[b] - _ANGLE[a]) % 360
        else:
            deg = (_ANGLE[a] - _ANGLE[b]) % 360
        segs.append((a, b, deg))
    return segs
