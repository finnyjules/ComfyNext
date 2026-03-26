# Vue Node Editor Design

## Goal

Replace the LiteGraph canvas with a fully interactive Vue-based node editor when the `Comfy.VueNodes.Enabled` ("Modern node design") setting is on. The editor must match ComfyNext's existing dark design system and support all interactions: drag, connect, edit widgets, run workflows.

## Technology

**Vue Flow** (`@vue-flow/core`) — a Vue 3 node graph library. Handles pan/zoom, node dragging, connection drawing, edge routing. We build custom node components for the visual layer.

## Architecture

### Toggle Mechanism

- Setting: `Comfy.VueNodes.Enabled` (already exists in `SettingsModal.vue`)
- When **off**: project tabs render the ComfyUI iframe (current behavior)
- When **on**: project tabs render the `<VueNodeCanvas>` component
- The ComfyUI iframe stays loaded in the background for execution

### Data Flow

```
LiteGraph workflow JSON (from file / bridge)
    |
    v
useVueNodes() composable
    - convertFromLiteGraph() -> Vue Flow nodes + edges
    - convertToLiteGraph() -> LiteGraph JSON (for Run/save)
    |
    v
<VueNodeCanvas> (Vue Flow instance)
    - Custom <ComfyNode> components per node
    - <ComfyEdge> custom edge component
    |
    v
ComfyUI API (/prompt endpoint) for execution
```

### Key Composable: `useVueNodes()`

Located at `frontend/app/composables/useVueNodes.ts`:

- `convertFromLiteGraph(workflow: GraphData)` — maps LiteGraph nodes/links to Vue Flow format, resolving widget definitions from `/object_info`
- `convertToLiteGraph(nodes, edges)` — serializes back for execution
- Manages selection state, clipboard (copy/paste), undo/redo stack
- Provides `addNode(type, position)`, `removeNodes(ids)`, `connect(source, target)`

### Widget Definitions

The `/object_info` endpoint (already queried by `useNodeSearch`) returns widget specs per node type:
- Input types: `INT`, `FLOAT`, `STRING`, `BOOLEAN`, `COMBO` (dropdown), `IMAGE`
- Each input has: name, type, default value, min/max/step (for numbers), options (for combos)

## Component Hierarchy

```
VueNodeCanvas.vue          — Vue Flow wrapper, toolbar, minimap
  ComfyNode.vue            — Custom node component (registered as Vue Flow node type)
    ComfyNodeTitle.vue     — Title bar with category color, name, cost badge
    ComfyNodePort.vue      — Input/output port circles with labels
    ComfyNodeWidget.vue    — Widget renderer (dispatches to specific widget types)
      WidgetCombo.vue      — Dropdown selector
      WidgetText.vue       — Text input / textarea
      WidgetNumber.vue     — Number input with slider
      WidgetToggle.vue     — Boolean toggle
      WidgetImage.vue      — Image preview
      WidgetSeed.vue       — Seed input with randomize toggle
  ComfyEdge.vue            — Custom edge with type-colored bezier curves
```

## Visual Design

### Node Appearance

- **Background:** `#1a1a1a`
- **Border:** `1px solid #2a2a2a`, `border-radius: 12px`
- **Min width:** 220px, auto-height based on content
- **Shadow:** `0 4px 16px rgba(0,0,0,0.4)`

### Title Bar

- Height: 32px
- Background: node category color at 15% opacity
- Left: colored dot (8px) matching category
- Center: node display name (12px, semibold, white/90)
- Right: cost badge if applicable (10px, muted)

### Ports

- Circle: 10px diameter
- Color: by data type (MODEL=purple-400, CLIP=yellow-400, IMAGE=blue-400, LATENT=pink-400, VAE=red-400, CONDITIONING=orange-400, MASK=emerald-400, default=white/30)
- Label: 10px, white/60, positioned beside the port
- Inputs on left edge, outputs on right edge

### Widgets (inside node body)

- Use existing `ui/` components with `data-slot="comfy-node-field"` sizing
- Padding: 8px horizontal, 4px vertical between widgets
- Dropdowns, text inputs, number sliders all use the dark theme tokens

### States

- **Selected:** `ring-2 ring-[#818cf8]` (indigo accent)
- **Running:** Pulsing border animation (1.5s, indigo)
- **Error:** `ring-2 ring-red-500`
- **Muted/bypassed:** 40% opacity

### Edges

- Bezier curves, 2px stroke
- Color: matches source output port type color
- Selected: 3px stroke + glow
- Running: animated dash pattern flowing along the edge

### Background

- Dot grid: reuse existing `rgba(255,255,255,0.08)` pattern from bridge.js
- Background color: matches canvas area (`#0a0a0a`)

## Integration Points

### With Existing Tab System

- `useTabs()` tracks which tab is active
- Each project tab gets its own Vue Flow instance state
- Workflow loading: same `loadWorkflow` action, but data goes to Vue Flow instead of iframe postMessage

### With Run/Execution

- On "Run" click: `convertToLiteGraph()` → POST to `/prompt` API
- Progress events (from existing bridge SSE): update node running states in Vue Flow
- Execution complete: update preview images on output nodes

### With Node Search

- Existing `NodeSearchDialog.vue` works as-is
- `addNode()` creates a new Vue Flow node at cursor/center position

### With Explain Feature

- `useExplain()` already works with `GraphData` — just needs the Vue Flow → GraphData conversion

## Migration Path

1. Build the editor behind the `Comfy.VueNodes.Enabled` toggle (off by default)
2. LiteGraph mode remains the default and fully functional
3. Users can switch between modes per-session
4. Once Vue editor reaches parity, consider making it the default
