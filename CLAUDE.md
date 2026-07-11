# Sailor

## Architecture
- **Frontend**: Nuxt 4 (Vue 3 + TypeScript + Tailwind) at `frontend/`
- **Backend**: ComfyUI Python server at root, runs on `127.0.0.1:8188`
- **Bridge**: `custom_nodes/sailor_bridge/js/bridge.js` — injected into the ComfyUI iframe, communicates with the frontend via `postMessage`
- The canvas runs inside a cross-origin iframe; the frontend wraps it with tabs, toolbar, and panels

## Development
- Frontend: `cd frontend && npm run dev`
- ComfyUI: `cd /Users/julien/Documents/GitHub/Sailor && .venv/bin/python main.py --listen 127.0.0.1 --port 8188`
- Bridge changes require restarting ComfyUI (not hot-reloaded)

## UI Change Priority
When making UI/UX changes, **Vue (frontend) has priority over LiteGraph (bridge/iframe)**. Make changes in the Vue frontend when possible. LiteGraph/bridge modifications are acceptable as a fallback when Vue can't reach the target (e.g., canvas rendering, context menus inside the iframe).
