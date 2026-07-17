"""Suite-wide import guards for tests-unit.

Pin the top-level `utils` PACKAGE (repo-root utils/) in sys.modules before any
test module runs. Upstream ComfyUI's nodes.py does
`sys.path.insert(0, <repo>/comfy)` at import time, so once any test pulls in
nodes.py (directly or via `from server import PromptServer`), a later plain
`import utils` resolves to comfy/utils.py — a non-package — and
`from utils.install_util import ...` (nodes_glsl.py, app/frontend_management.py,
app/database/db.py) dies with "'utils' is not a package". The live server never
hits this because main.py imports `utils.extra_config` before nodes.py; this
conftest mirrors that ordering for pytest.
"""
import utils.install_util  # noqa: F401
