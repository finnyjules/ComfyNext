import { app } from "../../../scripts/app.js";
import { api } from "../../../scripts/api.js";

console.log("[ComfyNext Bridge] Module loaded");

app.registerExtension({
  name: "ComfyNext.Bridge",
  async setup() {
    console.log("[ComfyNext Bridge] setup() called, isEmbedded:", window.parent !== window);
    const isEmbedded = window.parent !== window;

    // When embedded in ComfyNext, hide ComfyUI's own chrome
    if (isEmbedded) {
      const style = document.createElement("style");
      style.textContent = `
        /* Unify all panel dividers to match border-comfy-input: solid 1px rgb(34,34,34) */
        .border-dashed { border-style: solid !important; }
        .p-divider-dashed::before {
          border-top-style: solid !important;
          border-top-color: rgb(34, 34, 34) !important;
        }
        /* All PrimeVue toolbars — harmonize border color */
        .p-toolbar {
          border-color: rgb(34, 34, 34) !important;
        }
        /* All PrimeVue dividers */
        .p-divider::before {
          border-color: rgb(34, 34, 34) !important;
          border-style: solid !important;
        }
        /* Tailwind border-comfy-input elements — ensure consistent color */
        .border-comfy-input {
          border-color: rgb(34, 34, 34) !important;
        }
        /* All tab panel borders */
        .p-tablist, [data-pc-section="tablist"] {
          border-color: rgb(34, 34, 34) !important;
        }

        /* Hide ComfyUI's sidebar toolbar (icon strip), but keep the side panel visible */
        .floating-sidebar,
        [class*="floating-sidebar"] { display: none !important; }

        /* Hide bottom status bar */
        .status-bar,
        [class*="status-bar-"] { display: none !important; }

        /* Hide ComfyUI's bottom-right canvas toolbar (select/zoom/minimap) */
        .graph-canvas-panel,
        [class*="graph-canvas-panel"],
        .comfyui-canvas-menu,
        [class*="canvas-controls"] { display: none !important; }

        /* Slide-in animation for sidebar panel */
        @keyframes comfynext-slide-in {
          from { transform: translateX(-100%); }
          to { transform: translateX(0); }
        }
        .side-bar-panel {
          animation: comfynext-slide-in 0.3s cubic-bezier(0.16, 1, 0.3, 1) both !important;
          will-change: transform !important;
          border-right: 1px solid rgb(34, 34, 34) !important;
          border-left: 1px solid rgb(34, 34, 34) !important;
        }

        /* Hide all splitter resize gutters next to sidebar panels (left and right) */
        .side-bar-panel + .p-splitter-gutter,
        .side-bar-panel + [class*="splitter-gutter"],
        .side-bar-panel + [data-pc-section="gutter"],
        .p-splitter-gutter:has(+ .side-bar-panel),
        [class*="splitter-gutter"]:has(+ .side-bar-panel),
        [data-pc-section="gutter"]:has(+ .side-bar-panel),
        .p-splitter-gutter {
          display: none !important;
        }

        /* Add thin border to right-side splitter panels (Workflow Overview etc.) */
        .p-splitter-panel:last-child,
        [data-pc-section="panel"]:last-child,
        .p-splitterpanel:last-child {
          border-left: 1px solid rgb(34, 34, 34) !important;
        }

        /* Also target the gutter replacement — if gutter is hidden, ensure adjacent panels get a border */
        .p-splitter > *:not(:first-child):not(.p-splitter-gutter):not([data-pc-section="gutter"]) {
          border-left: 1px solid rgb(34, 34, 34) !important;
        }

        /* Context menu redesign */
        .litecontextmenu,
        .litegraph .litecontextmenu {
          background: #1a1a1a !important;
          border: 1px solid #2a2a2a !important;
          border-radius: 8px !important;
          box-shadow: 0 4px 16px rgba(0, 0, 0, 0.4), 0 1px 4px rgba(0, 0, 0, 0.2) !important;
          padding: 3px !important;
          min-width: 140px !important;
          backdrop-filter: blur(12px) !important;
          overflow: hidden !important;
        }

        .litecontextmenu .litemenu-entry {
          display: flex !important;
          align-items: center !important;
          justify-content: space-between !important;
          background: transparent !important;
          color: rgba(255, 255, 255, 0.8) !important;
          padding: 4px 8px !important;
          margin: 0 !important;
          border: none !important;
          border-radius: 6px !important;
          font-size: 11px !important;
          font-weight: 400 !important;
          line-height: 1.3 !important;
          font-family: -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, sans-serif !important;
          transition: background 0.1s ease !important;
          cursor: pointer !important;
          box-sizing: border-box !important;
          height: auto !important;
          min-height: 24px !important;
        }

        .litecontextmenu .litemenu-entry:hover {
          background: rgba(255, 255, 255, 0.08) !important;
          color: #fff !important;
        }

        .litecontextmenu .litemenu-entry.disabled,
        .litecontextmenu .litemenu-entry.disabled:hover {
          color: rgba(255, 255, 255, 0.25) !important;
          background: transparent !important;
          cursor: default !important;
        }

        .litecontextmenu .litemenu-entry .icon {
          display: none !important;
        }

        .litecontextmenu .litemenu-entry.separator,
        .litecontextmenu .separator {
          height: 1px !important;
          min-height: 1px !important;
          background: rgba(255, 255, 255, 0.06) !important;
          margin: 2px 6px !important;
          padding: 0 !important;
          border: none !important;
          display: block !important;
        }

        /* Submenu arrow — override ::after pseudo-element with chevron SVG */
        .litecontextmenu .litemenu-entry.has_submenu {
          position: relative !important;
          padding-right: 24px !important;
        }
        .litecontextmenu .litemenu-entry.has_submenu::after,
        .litemenu-entry.has_submenu::after {
          content: "" !important;
          position: absolute !important;
          right: 6px !important;
          top: 50% !important;
          transform: translateY(-50%) !important;
          width: 10px !important;
          height: 10px !important;
          background-image: url("data:image/svg+xml,%3Csvg xmlns='http://www.w3.org/2000/svg' width='10' height='10' viewBox='0 0 24 24' fill='none' stroke='rgba(255,255,255,0.35)' stroke-width='2.5' stroke-linecap='round' stroke-linejoin='round'%3E%3Cpath d='m9 18 6-6-6-6'/%3E%3C/svg%3E") !important;
          background-size: 10px 10px !important;
          background-repeat: no-repeat !important;
        }

        /* Search input in context menu */
        .litecontextmenu input {
          background: #0a0a0a !important;
          border: 1px solid #2a2a2a !important;
          border-radius: 6px !important;
          color: rgba(255, 255, 255, 0.8) !important;
          padding: 4px 8px !important;
          font-size: 11px !important;
          margin: 3px !important;
          outline: none !important;
          width: calc(100% - 6px) !important;
          box-sizing: border-box !important;
          font-family: -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, sans-serif !important;
        }

        .litecontextmenu input:focus {
          border-color: rgba(255, 255, 255, 0.15) !important;
        }

        .litecontextmenu input::placeholder {
          color: rgba(255, 255, 255, 0.3) !important;
        }

        /* ComfyUI Vue-based context menu overrides */
        .comfy-context-menu,
        [class*="context-menu"] .p-menu,
        .p-contextmenu {
          background: #1a1a1a !important;
          border: 1px solid #2a2a2a !important;
          border-radius: 8px !important;
          box-shadow: 0 4px 16px rgba(0, 0, 0, 0.4), 0 1px 4px rgba(0, 0, 0, 0.2) !important;
          padding: 3px !important;
          overflow: hidden !important;
        }

        .p-contextmenu .p-menuitem-link,
        .p-contextmenu .p-menuitem-content {
          background: transparent !important;
          color: rgba(255, 255, 255, 0.8) !important;
          padding: 4px 8px !important;
          border-radius: 6px !important;
          font-size: 11px !important;
          transition: background 0.1s ease !important;
        }

        .p-contextmenu .p-menuitem:not(.p-disabled) > .p-menuitem-content:hover,
        .p-contextmenu .p-menuitem-link:hover {
          background: rgba(255, 255, 255, 0.08) !important;
          color: #fff !important;
        }

        .p-contextmenu .p-menuitem.p-disabled .p-menuitem-content,
        .p-contextmenu .p-menuitem.p-disabled .p-menuitem-link {
          color: rgba(255, 255, 255, 0.25) !important;
        }

        .p-contextmenu .p-menuitem-separator {
          border-color: rgba(255, 255, 255, 0.06) !important;
          margin: 2px 6px !important;
        }

        /* PrimeVue submenu chevron icon */
        .p-contextmenu .p-submenu-icon,
        .p-contextmenu .p-menuitem-icon.p-submenu-icon {
          width: 10px !important;
          height: 10px !important;
          color: rgba(255, 255, 255, 0.35) !important;
          margin-left: auto !important;
        }

        /* Reduce node search dialog size (~50% smaller) */
        .invisible-dialog-root {
          zoom: 0.55 !important;
        }
      `;
      // Append late to ensure our styles override all loaded stylesheets
      document.head.appendChild(style);
      // Re-append after a delay to guarantee last-in-source-order
      setTimeout(() => document.head.appendChild(style), 2000);
      setTimeout(() => document.head.appendChild(style), 5000);

      function hideComfyChrome() {
        const vueApp = document.getElementById("vue-app");
        if (!vueApp) return;

        // 1. Hide the workflow tabs bar (shows "Unsaved Workflow" etc)
        const tabsEl = document.querySelector('[class*="workflow-tabs"]');
        if (tabsEl) tabsEl.style.display = "none";

        document.querySelectorAll("[class]").forEach((el) => {
          const cls = typeof el.className === "string" ? el.className : "";
          if (cls.includes("workflow-tabs-height") && !cls.includes("calc")) {
            el.style.display = "none";
          }
        });

        // 2. Hide the "N active" queue button and the native queue panel
        document.querySelectorAll("button").forEach((btn) => {
          const text = btn.textContent?.trim();
          if (text && /\d+\s*active/i.test(text)) {
            btn.style.display = "none";
          }
        });

        // 2b. Hide the native "Job Queue" panel overlay
        document.querySelectorAll("div").forEach((el) => {
          const cls = typeof el.className === "string" ? el.className : "";
          if (cls.includes("w-[350px]") && cls.includes("pointer-events-auto")) {
            el.style.display = "none";
          }
        });

        // 3. Hide the left sidebar toolbar (narrow icon strip only, not the panel)
        const rootChild = vueApp.firstElementChild;
        if (rootChild) {
          for (const child of rootChild.children) {
            const rect = child.getBoundingClientRect();
            // Sidebar toolbar is narrow (40-80px) and full height
            if (rect.width > 20 && rect.width < 100 && rect.height > 200) {
              child.style.display = "none";
            }
          }
        }

        // 4. Hide the bottom status bar (FPS, node counts etc.)
        document.querySelectorAll("footer, [class*='status']").forEach((el) => {
          const text = el.textContent || "";
          if (/FPS/i.test(text) || /N:\s*\d/i.test(text)) {
            el.style.display = "none";
          }
        });

        // 5. Hide the bottom-right canvas menu (select/hand/zoom toolbar)
        // Find by zoom percentage text (e.g. "10%", "100%") and hide ancestor toolbar
        const allSpans = document.querySelectorAll("span, div, button");
        for (const el of allSpans) {
          if (el.children.length === 0 && /^\d+%$/.test(el.textContent?.trim() || "")) {
            // Walk up to find a toolbar-like container (positioned, small width)
            let parent = el.parentElement;
            for (let i = 0; i < 6 && parent; i++) {
              const rect = parent.getBoundingClientRect();
              if (rect.width > 100 && rect.width < 500 && rect.height < 80) {
                const cs = window.getComputedStyle(parent);
                if (cs.position === "absolute" || cs.position === "fixed") {
                  parent.style.display = "none";
                  break;
                }
              }
              parent = parent.parentElement;
            }
            break;
          }
        }
      }

      // Convert any dashed/dotted borders anywhere in the UI to solid 1px rgba(255,255,255,0.06)
      function fixDashedBorders() {
        document.querySelectorAll("*").forEach((el) => {
          const cs = window.getComputedStyle(el);
          for (const side of ["Top", "Right", "Bottom", "Left"]) {
            const style = cs[`border${side}Style`];
            if (style === "dashed" || style === "dotted") {
              el.style[`border${side}Style`] = "solid";
              el.style[`border${side}Width`] = "1px";
              el.style[`border${side}Color`] = "rgba(255, 255, 255, 0.06)";
            }
          }
        });
      }

      // Run after short delay then observe
      setTimeout(hideComfyChrome, 500);
      setTimeout(hideComfyChrome, 1500);
      setTimeout(hideComfyChrome, 3000);
      setTimeout(fixDashedBorders, 2000);
      setTimeout(fixDashedBorders, 4000);

      const observer = new MutationObserver(() => hideComfyChrome());
      observer.observe(document.body, { childList: true, subtree: true });
      setTimeout(() => observer.disconnect(), 15000);

      // Persistent observer for dashed borders — runs whenever side panels change
      const borderObserver = new MutationObserver(() => fixDashedBorders());
      borderObserver.observe(document.body, { childList: true, subtree: true });

      // Override grid rendering to draw dots instead of lines
      function patchGridToDots() {
        const LGCanvas = window.LGraphCanvas;
        if (!LGCanvas || LGCanvas._comfynextGridPatched) return;
        LGCanvas._comfynextGridPatched = true;

        const origDrawBack = LGCanvas.prototype.drawBackCanvas;
        LGCanvas.prototype.drawBackCanvas = function () {
          // Suppress ALL grid-related properties before calling original
          const savedRenderGrid = this.render_grid;
          const savedRenderCanvasBorder = this.render_canvas_border;
          const savedBgImage = this.background_image;
          this.render_grid = false;
          this.render_canvas_border = false;
          this.background_image = null;

          origDrawBack.call(this);

          // Restore original values
          this.render_grid = savedRenderGrid;
          this.render_canvas_border = savedRenderCanvasBorder;
          this.background_image = savedBgImage;

          // Now draw dot grid on the background canvas
          const canvas = this.bgcanvas || this.canvas;
          const ctx = canvas.getContext("2d");
          if (!ctx) return;

          const s = this.ds?.scale || 1;
          const offset = this.ds?.offset || [0, 0];
          const gridSize = 64;

          const startX = (offset[0] % gridSize) * s;
          const startY = (offset[1] % gridSize) * s;

          ctx.save();
          ctx.fillStyle = "rgba(255, 255, 255, 0.08)";

          const dotRadius = Math.max(0.8, s * 0.8);

          for (let x = startX; x < canvas.width; x += gridSize * s) {
            for (let y = startY; y < canvas.height; y += gridSize * s) {
              ctx.beginPath();
              ctx.arc(x, y, dotRadius, 0, Math.PI * 2);
              ctx.fill();
            }
          }

          ctx.restore();
        };
      }

      // Fix context menu submenu positioning: align to originating entry, not top
      function patchContextMenuPosition() {
        const LG = window.LiteGraph;
        if (!LG?.ContextMenu || LG.ContextMenu._comfynextPatched) return;
        LG.ContextMenu._comfynextPatched = true;

        // Use MutationObserver to reposition submenus when they appear
        const menuObserver = new MutationObserver((mutations) => {
          for (const mutation of mutations) {
            for (const node of mutation.addedNodes) {
              if (node.nodeType !== 1) continue;
              const menu = node.classList?.contains("litecontextmenu") ? node : null;
              if (!menu) continue;

              // Check if this is a submenu (positioned to the right of a parent)
              // Find the hovered entry in any existing context menu
              const allMenus = document.querySelectorAll(".litecontextmenu");
              if (allMenus.length < 2) continue; // Only one menu — it's the root

              // Find the parent menu (the one that was there before this one)
              let parentMenu = null;
              for (const m of allMenus) {
                if (m !== menu) {
                  parentMenu = m;
                }
              }
              if (!parentMenu) continue;

              // Find the hovered/active entry in the parent
              const hoveredEntry = parentMenu.querySelector(".litemenu-entry:hover, .litemenu-entry.selected");
              if (hoveredEntry) {
                const entryRect = hoveredEntry.getBoundingClientRect();
                menu.style.top = entryRect.top + "px";
              }
            }
          }
        });
        menuObserver.observe(document.body, { childList: true });
      }

      // Retry patching until LGraphCanvas/LiteGraph is available
      function tryPatchGrid() {
        if (window.LGraphCanvas) {
          patchGridToDots();
        }
        if (window.LiteGraph?.ContextMenu) {
          patchContextMenuPosition();
        }
        if (!window.LGraphCanvas || !window.LiteGraph?.ContextMenu) {
          setTimeout(tryPatchGrid, 500);
        }
      }
      setTimeout(tryPatchGrid, 1000);
    }

    // Helper: get LiteGraph canvas from various possible paths
    function getCanvas() {
      return (
        window.comfyAPI?.app?.app?.canvas ||
        window.app?.canvas ||
        window.LGraphCanvas?.active_canvas ||
        document.querySelector("canvas")?.__litegraph_canvas ||
        null
      );
    }

    // Helper: try to execute a ComfyUI command by ID via Pinia
    function tryExecuteCommand(cmdId) {
      if (!cmdId) return;
      try {
        const vueApp = document.getElementById("vue-app");
        const pinia = vueApp?.__vue_app__?.config?.globalProperties?.$pinia;
        const commandStore = pinia?._s?.get("command");
        if (commandStore?.execute) {
          commandStore.execute(cmdId);
        } else if (commandStore?.commands) {
          let cmd = null;
          if (typeof commandStore.commands.get === "function") {
            cmd = commandStore.commands.get(cmdId);
          } else if (commandStore.commands[cmdId]) {
            cmd = commandStore.commands[cmdId];
          }
          if (cmd?.execute) cmd.execute();
          else if (cmd?.function) cmd.function();
        }
      } catch (e) {
        console.warn("[ComfyNext Bridge] tryExecuteCommand error:", cmdId, e);
      }
    }

    // Listen for postMessage commands from the parent ComfyNext wrapper
    window.addEventListener("message", (event) => {
      if (!event.data || event.data.type !== "comfynext") return;

      const { action } = event.data;
      console.log("[ComfyNext Bridge] received action:", action, "payload:", JSON.stringify(event.data));

      if (action === "loadWorkflow") {
        const { workflow, prompt } = event.data;
        if (workflow && window.app) {
          try {
            window.app.loadGraphData(workflow);
            console.log("[ComfyNext Bridge] Loaded workflow");
            postToParent({ event: "workflow_loaded" });
          } catch (e) {
            console.error("[ComfyNext Bridge] Failed to load workflow:", e);
            postToParent({ event: "workflow_loaded" }); // still signal so overlay clears
          }
        }
      }

      if (action === "getWorkflow") {
        try {
          if (window.app) {
            const workflow = window.app.serializeGraph?.() || window.app.graph?.serialize?.();
            if (workflow) {
              postToParent({ event: "workflow_data", workflow });
            }
          }
        } catch (e) {
          console.warn("[ComfyNext Bridge] getWorkflow error:", e);
        }
      }

      if (action === "toggleQueue") {
        const allButtons = document.querySelectorAll("button");
        for (const btn of allButtons) {
          const text = btn.textContent?.trim();
          if (text && /\d+\s*active/i.test(text)) {
            btn.click();
            return;
          }
        }
      }

      if (action === "purchaseCredits") {
        (async () => {
          try {
            const amount = event.data.amount;
            const vueApp = document.getElementById("vue-app");
            const pinia = vueApp?.__vue_app__?.config?.globalProperties?.$pinia;

            if (!pinia?._s) {
              postToParent({ event: "purchase_error", msg: "Pinia not found" });
              return;
            }

            // Try workspace billing first (POST /billing/topup)
            const workspaceStore = pinia._s.get("workspace");
            if (workspaceStore) {
              try {
                const authStore = pinia._s.get("firebaseAuth");
                const token = authStore?.currentUser?.accessToken || (await authStore?.currentUser?.getIdToken?.());
                if (token) {
                  const res = await fetch("https://api.comfy.org/billing/topup", {
                    method: "POST",
                    headers: { Authorization: `Bearer ${token}`, "Content-Type": "application/json" },
                    body: JSON.stringify({ amount_cents: amount * 100 }),
                  });
                  const data = await res.json();
                  if (data.checkout_url) {
                    postToParent({ event: "checkout_url", url: data.checkout_url });
                    return;
                  }
                  if (data.status === "completed") {
                    // Payment succeeded immediately (stored payment method)
                    postToParent({ event: "checkout_url", url: null });
                    setTimeout(() => fetchCredits(), 2000);
                    return;
                  }
                }
              } catch (e) {
                // Fall through to legacy
              }
            }

            // Fallback: legacy flow (POST /customers/credit)
            const authStore = pinia._s.get("firebaseAuth");
            if (authStore?.purchaseCredits) {
              await authStore.purchaseCredits(amount);
              // purchaseCredits opens window.open internally
              postToParent({ event: "checkout_url", url: null });
            } else {
              postToParent({ event: "purchase_error", msg: "No purchase method found" });
            }
          } catch (e) {
            console.error("[ComfyNext Bridge] purchaseCredits error:", e);
            postToParent({ event: "purchase_error", msg: e.message });
          }
        })();
      }

      if (action === "toggleSidebarTab") {
        const tabId = event.data.tabId; // e.g. "node-library"
        try {
          const vueApp = document.getElementById("vue-app");
          const pinia = vueApp?.__vue_app__?.config?.globalProperties?.$pinia;
          if (pinia?._s) {
            const commandStore = pinia._s.get("command");
            const cmdId = `Workspace.ToggleSidebarTab.${tabId}`;
            let cmd = null;

            if (commandStore?.commands) {
              // commands could be a Map or an Array
              if (typeof commandStore.commands.get === "function") {
                cmd = commandStore.commands.get(cmdId);
              } else if (Array.isArray(commandStore.commands)) {
                cmd = commandStore.commands.find((c) => c.id === cmdId);
              } else if (typeof commandStore.commands === "object") {
                cmd = commandStore.commands[cmdId];
              }
            }

            // Try execute method or function property
            if (cmd?.execute) { cmd.execute(); return; }
            if (cmd?.function) { cmd.function(); return; }

            // Fallback: try commandStore.execute directly
            if (commandStore?.execute) {
              commandStore.execute(cmdId);
              return;
            }
            console.warn("[ComfyNext Bridge] toggleSidebarTab: command not found:", cmdId);
          }
        } catch (e) {
          console.warn("[ComfyNext Bridge] toggleSidebarTab error:", e);
        }
      }

      if (action === "addNodeAtCenter") {
        try {
          const canvas = getCanvas();
          const graph = canvas?.graph || window.app?.graph;
          if (graph && window.LiteGraph) {
            const node = window.LiteGraph.createNode(event.data.nodeType);
            if (node) {
              const canvasEl = canvas?.canvas || document.querySelector("canvas");
              if (canvas?.ds && canvasEl) {
                const rect = canvasEl.getBoundingClientRect();
                const center = canvas.ds.convertOffsetToCanvas(rect.width / 2, rect.height / 2);
                node.pos = [center[0], center[1]];
              } else {
                node.pos = [300, 300];
              }
              graph.add(node);
              if (canvas) canvas.setDirty(true, true);
              postToParent({ event: "node_added", nodeType: event.data.nodeType });
            }
          }
        } catch (e) {
          console.error("[ComfyNext Bridge] addNodeAtCenter error:", e);
        }
      }

      if (action === "setCanvasTool") {
        try {
          const tool = event.data.tool;
          const canvas = getCanvas();
          if (canvas) {
            if (tool === "hand") {
              canvas.dragging_canvas = false;
              canvas.read_only = true;
              canvas.allow_interaction = false;
              canvas.allow_dragcanvas = true;
              canvas.allow_dragnodes = false;
              canvas.allow_searchbox = false;
            } else {
              // select mode (default)
              canvas.read_only = false;
              canvas.allow_interaction = true;
              canvas.allow_dragcanvas = true;
              canvas.allow_dragnodes = true;
              canvas.allow_searchbox = true;
            }
          } else {
            // Fallback: try Pinia command
            const cmdId = tool === "hand" ? "Workspace.ToggleCanvasPanMode" : "Workspace.ToggleCanvasSelectMode";
            tryExecuteCommand(cmdId);
          }
        } catch (e) {
          console.warn("[ComfyNext Bridge] setCanvasTool error:", e);
        }
      }

      if (action === "canvasZoom") {
        try {
          const canvas = getCanvas();
          if (canvas) {
            const direction = event.data.direction;
            if (direction === "in") {
              const center = [canvas.canvas.width / 2, canvas.canvas.height / 2];
              canvas.ds.changeScale(canvas.ds.scale * 1.2, center);
              canvas.setDirty(true, true);
            } else if (direction === "out") {
              const center = [canvas.canvas.width / 2, canvas.canvas.height / 2];
              canvas.ds.changeScale(canvas.ds.scale * 0.8, center);
              canvas.setDirty(true, true);
            } else if (direction === "reset") {
              canvas.ds.reset();
              canvas.setDirty(true, true);
            }
          } else {
            const cmdMap = { in: "Comfy.Canvas.ZoomIn", out: "Comfy.Canvas.ZoomOut", reset: "Comfy.Canvas.FitView" };
            tryExecuteCommand(cmdMap[event.data.direction] || "");
          }
        } catch (e) {
          console.warn("[ComfyNext Bridge] canvasZoom error:", e);
        }
      }

      if (action === "toggleMinimap") {
        try {
          const canvas = getCanvas();
          if (canvas) {
            canvas.show_info = !canvas.show_info;
            canvas.setDirty(true, true);
          } else {
            tryExecuteCommand("Comfy.Canvas.ToggleMinimap");
          }
        } catch (e) {
          console.warn("[ComfyNext Bridge] toggleMinimap error:", e);
        }
      }

      if (action === "signOut") {
        (async () => {
          try {
            const vueApp = document.getElementById("vue-app");
            const pinia = vueApp?.__vue_app__?.config?.globalProperties?.$pinia;
            const authStore = pinia?._s?.get("firebaseAuth");
            if (authStore?.logout) {
              await authStore.logout();
              postToParent({ event: "signed_out" });
            }
          } catch (e) {
            console.error("[ComfyNext Bridge] signOut error:", e);
          }
        })();
      }

      if (action === "openBillingPortal") {
        (async () => {
          try {
            const vueApp = document.getElementById("vue-app");
            const pinia = vueApp?.__vue_app__?.config?.globalProperties?.$pinia;
            const authStore = pinia?._s?.get("firebaseAuth");
            if (authStore?.accessBillingPortal) {
              await authStore.accessBillingPortal();
            }
          } catch (e) {
            console.error("[ComfyNext Bridge] openBillingPortal error:", e);
          }
        })();
      }

      if (action === "extractGraphRegion") {
        try {
          const canvas = getCanvas();
          if (!canvas || !canvas.graph) {
            postToParent({ event: "graph_extract_failed", error: "No graph found" });
            return;
          }

          const region = event.data.region;
          const scale = canvas.ds?.scale || 1;
          const offset = canvas.ds?.offset || [0, 0];

          // Convert screen-space region to graph-space
          const graphRegion = {
            x: (region.x / scale) - offset[0],
            y: (region.y / scale) - offset[1],
            width: region.width / scale,
            height: region.height / scale,
          };

          // Find nodes whose bounding box overlaps the region
          const allNodes = canvas.graph._nodes || canvas.graph.nodes || [];
          const matchedNodes = allNodes.filter((node) => {
            const nx = node.pos[0];
            const ny = node.pos[1];
            const nw = node.size[0];
            const nh = node.size[1];
            return !(
              nx + nw < graphRegion.x ||
              nx > graphRegion.x + graphRegion.width ||
              ny + nh < graphRegion.y ||
              ny > graphRegion.y + graphRegion.height
            );
          });

          const matchedNodeIds = new Set(matchedNodes.map((n) => n.id));

          // Extract node data
          const nodes = matchedNodes.map((node) => ({
            id: node.id,
            type: node.type,
            title: node.title || node.type,
            inputs: (node.inputs || []).map((inp) => ({
              name: inp.name,
              type: inp.type,
              link: inp.link,
            })),
            outputs: (node.outputs || []).map((out) => ({
              name: out.name,
              type: out.type,
              links: out.links,
            })),
            widgets_values: node.widgets_values || [],
            properties: node.properties || {},
          }));

          // Get connections between matched nodes
          const allLinks = canvas.graph.links || {};
          const links = [];
          const linkEntries = typeof allLinks.forEach === "function"
            ? allLinks
            : Object.values(allLinks);
          linkEntries.forEach((link) => {
            if (!link) return;
            if (matchedNodeIds.has(link.origin_id) || matchedNodeIds.has(link.target_id)) {
              links.push({
                id: link.id,
                origin_id: link.origin_id,
                origin_slot: link.origin_slot,
                target_id: link.target_id,
                target_slot: link.target_slot,
                type: link.type,
              });
            }
          });

          postToParent({ event: "graph_region_extracted", nodes, links });
        } catch (e) {
          console.error("[ComfyNext Bridge] extractGraphRegion error:", e);
          postToParent({ event: "graph_extract_failed", error: e.message });
        }
      }

      if (action === "highlightNode") {
        try {
          const canvas = getCanvas();
          if (!canvas || !canvas.graph) return;
          const nodeId = event.data.nodeId;
          const node = canvas.graph.getNodeById(nodeId);
          if (!node) return;

          // Store original colors to restore later
          if (!window._comfynextHighlight) {
            window._comfynextHighlight = {};
          }
          // Clear any previous highlight first
          if (window._comfynextHighlight.nodeId != null && window._comfynextHighlight.nodeId !== nodeId) {
            const prevNode = canvas.graph.getNodeById(window._comfynextHighlight.nodeId);
            if (prevNode) {
              prevNode.color = window._comfynextHighlight.originalColor;
              prevNode.boxcolor = window._comfynextHighlight.originalBoxColor;
            }
          }

          window._comfynextHighlight = {
            nodeId,
            originalColor: node.color,
            originalBoxColor: node.boxcolor,
          };

          // Apply highlight style
          node.color = "#1e3a5f";
          node.boxcolor = "#4a9eff";
          canvas.setDirty(true, true);
        } catch (e) {
          console.warn("[ComfyNext Bridge] highlightNode error:", e);
        }
      }

      if (action === "clearHighlight") {
        try {
          const canvas = getCanvas();
          if (!canvas || !canvas.graph || !window._comfynextHighlight?.nodeId) return;
          const node = canvas.graph.getNodeById(window._comfynextHighlight.nodeId);
          if (node) {
            node.color = window._comfynextHighlight.originalColor;
            node.boxcolor = window._comfynextHighlight.originalBoxColor;
            canvas.setDirty(true, true);
          }
          window._comfynextHighlight = {};
        } catch (e) {
          console.warn("[ComfyNext Bridge] clearHighlight error:", e);
        }
      }

      if (action === "getWorkflow") {
        try {
          const canvas = getCanvas();
          const graph = canvas?.graph || window.app?.graph;
          if (graph) {
            const workflow = graph.serialize();
            postToParent({ event: "workflow_data", workflow });
          } else {
            postToParent({ event: "workflow_data", workflow: null });
          }
        } catch (e) {
          console.error("[ComfyNext Bridge] getWorkflow error:", e);
          postToParent({ event: "workflow_data", workflow: null });
        }
      }

      if (action === "queuePrompt") {
        // Trigger ComfyUI's native queue prompt (same as clicking Run)
        try {
          if (window.app?.queuePrompt) {
            window.app.queuePrompt(0); // 0 = front of queue
            console.log("[ComfyNext Bridge] Queued prompt via app.queuePrompt");
          } else {
            // Fallback: try the command system
            tryExecuteCommand("Comfy.QueuePrompt");
          }
        } catch (e) {
          console.error("[ComfyNext Bridge] queuePrompt error:", e);
        }
      }

      if (action === "getPrompt") {
        // Serialize the current graph into the format needed for /prompt API
        try {
          if (window.app?.graphToPrompt) {
            const result = await window.app.graphToPrompt();
            postToParent({ event: "prompt_data", prompt: result });
          } else {
            postToParent({ event: "prompt_data", prompt: null });
          }
        } catch (e) {
          console.error("[ComfyNext Bridge] getPrompt error:", e);
          postToParent({ event: "prompt_data", prompt: null });
        }
      }

      if (action === "openSettings") {
        if (window.comfyAPI?.settings?.ComfySettingsDialog) {
          const dialog = window.comfyAPI.settings.ComfySettingsDialog;
          if (typeof dialog?.show === "function") {
            dialog.show();
            return;
          }
        }
        const allButtons = document.querySelectorAll("button");
        for (const btn of allButtons) {
          const label = btn.textContent?.trim();
          const ariaLabel = btn.getAttribute("aria-label");
          if (label === "Settings" || ariaLabel === "Settings") {
            btn.click();
            return;
          }
        }
      }
    });

    // Space key: intercept inside iframe and forward to Vue frontend (NodeSearchDialog)
    document.addEventListener("keydown", (e) => {
      if (e.code === "Space" && !e.ctrlKey && !e.metaKey && !e.altKey && !e.shiftKey) {
        const tag = e.target?.tagName?.toLowerCase();
        if (tag === "input" || tag === "textarea" || tag === "select") return;
        if (e.target?.isContentEditable) return;
        e.preventDefault();
        e.stopPropagation();
        if (window.parent !== window) {
          window.parent.postMessage({ type: "comfynext-bridge", event: "open_node_search" }, "*");
        }
      }
    }, true); // capture phase to beat LiteGraph's handler

    // Forward ComfyUI execution events to parent
    function postToParent(data) {
      console.log("[ComfyNext Bridge] postToParent:", data.event || data.status || "unknown");
      if (window.parent !== window) {
        window.parent.postMessage({ type: "comfynext-bridge", ...data }, "*");
      }
    }

    // Track execution progress
    api.addEventListener("execution_start", (evt) => {
      postToParent({ event: "execution_start", prompt_id: evt.detail?.prompt_id });
    });

    api.addEventListener("progress", (evt) => {
      const { value, max, prompt_id, node } = evt.detail;
      const percent = Math.round((value / max) * 100);
      postToParent({ event: "progress", percent, prompt_id, node_id: node });
    });

    api.addEventListener("executing", (evt) => {
      if (evt.detail === null) {
        postToParent({ event: "execution_complete" });
      } else {
        // Forward which node is currently executing
        postToParent({
          event: "executing",
          node_id: evt.detail.node || evt.detail,
          display_node: evt.detail.display_node,
          prompt_id: evt.detail.prompt_id,
        });
      }
    });

    api.addEventListener("execution_error", () => {
      postToParent({ event: "execution_complete" });
    });

    // Fetch credit balance via Pinia store with correct conversion
    async function fetchCredits() {
      try {
        const vueApp = document.getElementById("vue-app");
        const pinia =
          vueApp?.__vue_app__?.config?.globalProperties?.$pinia;
        if (!pinia?._s) return;

        const authStore = pinia._s.get("firebaseAuth");
        if (!authStore) {
          console.log("[ComfyNext Bridge] fetchCredits: no authStore");
          return;
        }

        console.log("[ComfyNext Bridge] fetchCredits: authenticated=", authStore.isAuthenticated, "hasBalance=", !!authStore.balance, "hasUser=", !!authStore.currentUser);

        if (!authStore.isAuthenticated && !authStore.currentUser) {
          console.log("[ComfyNext Bridge] fetchCredits: user not authenticated yet");
          return;
        }

        if (!authStore.balance && authStore.fetchBalance) {
          console.log("[ComfyNext Bridge] fetchCredits: calling fetchBalance()...");
          await authStore.fetchBalance();
          console.log("[ComfyNext Bridge] fetchCredits: after fetchBalance, balance=", authStore.balance);
        }

        if (authStore.balance) {
          const cents =
            authStore.balance.effective_balance_micros ??
            authStore.balance.amount_micros ??
            0;
          const credits = Math.round(cents * 2.11);
          console.log("[ComfyNext Bridge] fetchCredits: cents=", cents, "credits=", credits);
          postToParent({ event: "credits_update", credits });
        } else {
          console.log("[ComfyNext Bridge] fetchCredits: no balance available");
        }
      } catch (e) {
        console.error("[ComfyNext Bridge] fetchCredits error:", e);
      }
    }

    // Fetch user profile data from Firebase auth store
    async function fetchUserProfile() {
      try {
        const vueApp = document.getElementById("vue-app");
        const pinia = vueApp?.__vue_app__?.config?.globalProperties?.$pinia;
        if (!pinia?._s) return;

        const authStore = pinia._s.get("firebaseAuth");
        if (!authStore?.currentUser) return;

        const user = authStore.currentUser;
        postToParent({
          event: "user_profile",
          profile: {
            email: user.email || null,
            displayName: user.displayName || null,
            photoURL: user.photoURL || null,
            uid: user.uid || null,
            providerId: user.providerData?.[0]?.providerId || null,
          },
        });
      } catch (e) {
        // Silently retry on next interval
      }
    }

    setTimeout(fetchCredits, 3000);
    setTimeout(fetchCredits, 6000);
    setTimeout(fetchCredits, 12000);
    setTimeout(fetchCredits, 20000);
    setTimeout(fetchCredits, 30000);
    setInterval(fetchCredits, 60000);

    setTimeout(fetchUserProfile, 4000);
    setTimeout(fetchUserProfile, 10000);
    setTimeout(fetchUserProfile, 20000);

    postToParent({ status: "ready" });
  },
});
