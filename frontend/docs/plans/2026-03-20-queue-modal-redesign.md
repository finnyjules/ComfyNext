# Queue Modal Redesign

## Problem

The queue popup currently shows only "Prompt #X" with a dot indicator. ComfyUI's native queue shows richer data: thumbnails, filenames, durations, progress bars, and failed items. We want to match that level of detail in our queue modal.

## Data Sources

- **`/queue`** — `queue_running` (active) + `queue_pending` (waiting). Each item is a tuple: `[number, prompt_id, prompt, extra_data, outputs_to_execute]`.
- **`/history`** — Dict keyed by `prompt_id`. Each entry has `status` (with `status_str`, `completed`) and `outputs` (with image filenames, subfolder, type).
- **Bridge events** — `execution_start`, `progress` (with `percent`), `execution_complete` relayed via postMessage from ComfyUI iframe.

## Data Model

```ts
interface QueueItem {
  promptId: string
  status: 'running' | 'pending' | 'completed' | 'failed'
  progress?: number        // 0-100, from bridge events
  images?: { filename: string, subfolder: string, type: string }[]
  executionTime?: number   // seconds
  timestamp?: number       // for sorting/grouping
}
```

## Fetching Strategy

- On popup open: fetch `/queue` and `/history` in parallel.
- While open: poll both every 2s.
- On close: stop polling.
- Store per-prompt progress in a `Map<promptId, number>` updated by bridge events.

## UI Sections

### Running Items (top)
- Pulsing blue indicator + "Running"
- Progress bar (blue `#818cf8`) with percentage
- Prompt ID as subtitle

### Pending Items (below running)
- Gray dot + "Pending"
- Prompt ID

### History Items (scrollable, below)
- Grouped by day ("Today", "Yesterday", etc.)
- Each item: 48x48 thumbnail (from `/view?filename=...&type=output`), output filename, duration
- Failed items: red icon, "Failed" label, no thumbnail

### Empty State
- Play icon + "No items in queue / Run a workflow to see it here"

## Thumbnail Loading

Images from `/view?filename={name}&subfolder={subfolder}&type=output` via server middleware proxy. Lazy-loaded `<img>` with fallback background color.

## Out of Scope

- No filtering tabs (All/Completed/Failed)
- No clear queue button
- No drag-to-reorder
- No click-to-open-workflow
