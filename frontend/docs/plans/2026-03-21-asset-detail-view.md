# Asset Detail View Implementation Plan

> **For Claude:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task.

**Goal:** Clicking an image in the Assets grid opens a full-screen overlay with the image, metadata, actions (like, save, download, open workflow), prompt text, dimensions, and comments.

**Architecture:** New `AssetDetailOverlay.vue` component rendered inside `AssetsHistory.vue` via a reactive `selectedItem` ref. Fetches full history data for the selected prompt. "Open Workflow" sends a `loadWorkflow` postMessage to the bridge iframe which calls `app.loadGraphData()`.

**Tech Stack:** Vue 3 Composition API, Tailwind CSS, Lucide icons, localStorage for comments, postMessage for bridge communication.

---

### Task 1: Create AssetDetailOverlay component with image + close

**Files:**
- Create: `app/components/AssetDetailOverlay.vue`
- Modify: `app/components/AssetsHistory.vue`

**Step 1: Create the overlay component**

Create `app/components/AssetDetailOverlay.vue`:

```vue
<script setup lang="ts">
import { X } from 'lucide-vue-next'

interface DetailImage {
  filename: string
  subfolder: string
  type: string
}

interface Props {
  promptId: string
  image: DetailImage
}

const props = defineProps<Props>()
const emit = defineEmits<{ close: [] }>()

function imageUrl(img: DetailImage): string {
  const params = new URLSearchParams({ filename: img.filename, type: img.type })
  if (img.subfolder) params.set('subfolder', img.subfolder)
  return `/view?${params}`
}

function onBackdropClick(e: MouseEvent) {
  if (e.target === e.currentTarget) emit('close')
}

onMounted(() => {
  const handler = (e: KeyboardEvent) => { if (e.key === 'Escape') emit('close') }
  window.addEventListener('keydown', handler)
  onUnmounted(() => window.removeEventListener('keydown', handler))
})
</script>

<template>
  <Teleport to="body">
    <div
      class="fixed inset-0 z-[9999] flex bg-black/80 backdrop-blur-sm"
      @click="onBackdropClick"
    >
      <!-- Image area -->
      <div class="flex-1 flex items-center justify-center p-8 min-w-0">
        <img
          :src="imageUrl(image)"
          :alt="image.filename"
          class="max-w-full max-h-full object-contain rounded-lg"
        />
      </div>

      <!-- Right sidebar -->
      <div class="w-[360px] shrink-0 bg-[#1a1a1a] border-l border-[#2a2a2a] flex flex-col overflow-y-auto">
        <!-- Close button -->
        <div class="flex items-center justify-between p-4 border-b border-[#2a2a2a]">
          <span class="text-sm font-medium text-white truncate">{{ image.filename }}</span>
          <button class="text-white/40 hover:text-white cursor-pointer" @click="emit('close')">
            <X class="size-4" />
          </button>
        </div>

        <!-- Placeholder for metadata sections -->
        <div class="p-4 text-white/40 text-xs">Details loading...</div>
      </div>
    </div>
  </Teleport>
</template>
```

**Step 2: Wire it up in AssetsHistory.vue**

Add to the `<script setup>` in AssetsHistory.vue, after the existing refs:

```typescript
const selectedImage = ref<{ promptId: string; image: { filename: string; subfolder: string; type: string } } | null>(null)
```

Add click handler to each thumbnail div (the `v-for` image div):

```html
@click="selectedImage = { promptId: img.promptId, image: img }"
```

Add overlay at the bottom of the `<template>`, before the closing `</div>`:

```html
<AssetDetailOverlay
  v-if="selectedImage"
  :prompt-id="selectedImage.promptId"
  :image="selectedImage.image"
  @close="selectedImage = null"
/>
```

**Step 3: Verify it opens and closes**

Run the dev server, click a thumbnail, verify the overlay opens with the image. Press Escape or click backdrop to close.

**Step 4: Commit**

```bash
git add app/components/AssetDetailOverlay.vue app/components/AssetsHistory.vue
git commit -m "feat: add asset detail overlay with image display"
```

---

### Task 2: Fetch and display metadata (date, time, node, workflow)

**Files:**
- Modify: `app/components/AssetDetailOverlay.vue`

**Step 1: Fetch history data for the prompt**

Add to the `<script setup>`:

```typescript
import { Heart, Bookmark, Download, Play, Clock, Layers, Image as ImageIcon } from 'lucide-vue-next'

interface HistoryData {
  date: string
  executionTime: string | null
  outputNode: string | null
  promptText: string | null
  dimensions: { width: number; height: number } | null
}

const historyData = ref<HistoryData | null>(null)
const imageDimensions = ref<{ width: number; height: number } | null>(null)

async function fetchHistoryData() {
  try {
    const res = await fetch(`/history/${props.promptId}`)
    const data = await res.json()
    const entry = data[props.promptId] ?? Object.values(data)[0]
    if (!entry) return

    // Date
    const messages = entry.status?.messages ?? []
    const startMsg = messages.find((m: any) => m[0] === 'execution_start')
    const endMsg = messages.find((m: any) => m[0] === 'execution_success' || m[0] === 'execution_error')
    const timestamp = startMsg?.[1]?.timestamp ?? 0
    const date = timestamp ? new Date(timestamp).toLocaleString(undefined, {
      month: 'short', day: 'numeric', year: 'numeric', hour: 'numeric', minute: '2-digit',
    }) : 'Unknown'

    // Execution time
    let executionTime: string | null = null
    if (startMsg?.[1]?.timestamp && endMsg?.[1]?.timestamp) {
      const secs = (endMsg[1].timestamp - startMsg[1].timestamp) / 1000
      executionTime = `${secs.toFixed(1)}s`
    }

    // Find output node (the node that produced this image)
    let outputNode: string | null = null
    const prompt = entry.prompt?.[2] ?? entry.prompt // prompt dict
    if (prompt && typeof prompt === 'object') {
      for (const [nodeId, nodeOutput] of Object.entries(entry.outputs ?? {})) {
        if ((nodeOutput as any).images?.some((img: any) => img.filename === props.image.filename)) {
          outputNode = (prompt[nodeId] as any)?.class_type ?? null
          break
        }
      }
    }

    // Extract prompt text from CLIPTextEncode nodes
    let promptText: string | null = null
    if (prompt && typeof prompt === 'object') {
      for (const node of Object.values(prompt) as any[]) {
        if (node.class_type?.includes('CLIPTextEncode') || node.class_type?.includes('TextEncode')) {
          const text = node.inputs?.text
          if (text && typeof text === 'string' && text.length > 0) {
            promptText = text
            break
          }
        }
      }
    }

    historyData.value = { date, executionTime, outputNode, promptText, dimensions: null }
  } catch (e) {
    console.error('[AssetDetail] Failed to fetch history:', e)
  }
}

// Get image dimensions
function onImageLoad(e: Event) {
  const img = e.target as HTMLImageElement
  imageDimensions.value = { width: img.naturalWidth, height: img.naturalHeight }
}

onMounted(fetchHistoryData)
```

**Step 2: Build the sidebar template**

Replace the placeholder `<div class="p-4 text-white/40 text-xs">Details loading...</div>` with:

```html
<div class="flex flex-col gap-0">
  <!-- Date & time -->
  <div class="px-4 py-3 border-b border-[#2a2a2a]">
    <div class="text-xs text-white/50 mb-1">Generated</div>
    <div class="text-sm text-white">{{ historyData?.date ?? '...' }}</div>
    <div v-if="historyData?.executionTime" class="text-xs text-white/40 mt-0.5 flex items-center gap-1">
      <Clock class="size-3" /> {{ historyData.executionTime }}
    </div>
  </div>

  <!-- Actions -->
  <div class="px-4 py-3 border-b border-[#2a2a2a] flex items-center gap-3">
    <button class="p-2 rounded-lg hover:bg-white/10 text-white/50 hover:text-white transition-colors cursor-pointer" title="Like">
      <Heart class="size-5" />
    </button>
    <button class="p-2 rounded-lg hover:bg-white/10 text-white/50 hover:text-white transition-colors cursor-pointer" title="Save">
      <Bookmark class="size-5" />
    </button>
    <button class="p-2 rounded-lg hover:bg-white/10 text-white/50 hover:text-white transition-colors cursor-pointer" title="Download" @click="downloadImage">
      <Download class="size-5" />
    </button>
    <button class="p-2 rounded-lg hover:bg-white/10 text-white/50 hover:text-white transition-colors cursor-pointer" title="Open Workflow" @click="openWorkflow">
      <Play class="size-5" />
    </button>
  </div>

  <!-- Workflow info -->
  <div v-if="historyData?.outputNode" class="px-4 py-3 border-b border-[#2a2a2a]">
    <div class="text-xs text-white/50 mb-1">Output node</div>
    <div class="text-sm text-white flex items-center gap-1.5">
      <Layers class="size-3.5 text-white/40 shrink-0" />
      {{ historyData.outputNode }}
    </div>
  </div>

  <!-- Prompt -->
  <div v-if="historyData?.promptText" class="px-4 py-3 border-b border-[#2a2a2a]">
    <div class="text-xs text-white/50 mb-1">Prompt</div>
    <p class="text-sm text-white/80 whitespace-pre-wrap break-words leading-relaxed">{{ historyData.promptText }}</p>
  </div>

  <!-- Dimensions -->
  <div v-if="imageDimensions" class="px-4 py-3 border-b border-[#2a2a2a]">
    <div class="text-xs text-white/50 mb-1">Dimensions</div>
    <div class="text-sm text-white flex items-center gap-1.5">
      <ImageIcon class="size-3.5 text-white/40 shrink-0" />
      {{ imageDimensions.width }} × {{ imageDimensions.height }}
    </div>
  </div>
</div>
```

Add `@load="onImageLoad"` to the `<img>` tag in the image area.

**Step 3: Add download helper**

```typescript
function downloadImage() {
  const a = document.createElement('a')
  a.href = imageUrl(props.image)
  a.download = props.image.filename
  a.click()
}
```

**Step 4: Commit**

```bash
git add app/components/AssetDetailOverlay.vue
git commit -m "feat: add metadata sidebar with date, node, prompt, dimensions"
```

---

### Task 3: Add comments section with localStorage persistence

**Files:**
- Modify: `app/components/AssetDetailOverlay.vue`

**Step 1: Add comment state and persistence**

Add to script setup:

```typescript
import { Send } from 'lucide-vue-next'

interface Comment {
  id: string
  text: string
  timestamp: number
}

const comments = ref<Comment[]>([])
const newComment = ref('')

const storageKey = computed(() => `sailor-comments-${props.promptId}`)

function loadComments() {
  try {
    const raw = localStorage.getItem(storageKey.value)
    if (raw) comments.value = JSON.parse(raw)
  } catch {}
}

function saveComments() {
  localStorage.setItem(storageKey.value, JSON.stringify(comments.value))
}

function addComment() {
  const text = newComment.value.trim()
  if (!text) return
  comments.value.push({ id: crypto.randomUUID(), text, timestamp: Date.now() })
  newComment.value = ''
  saveComments()
}

function formatCommentTime(ts: number): string {
  return new Date(ts).toLocaleString(undefined, {
    month: 'short', day: 'numeric', hour: 'numeric', minute: '2-digit',
  })
}

onMounted(loadComments)
```

**Step 2: Add comments template**

After the dimensions section, add:

```html
<!-- Comments -->
<div class="px-4 py-3 flex-1 flex flex-col min-h-0">
  <div class="text-xs text-white/50 mb-3">Comments</div>

  <!-- Comment list -->
  <div class="flex-1 overflow-y-auto space-y-3 mb-3">
    <div v-for="comment in comments" :key="comment.id" class="text-sm">
      <div class="text-white/80 whitespace-pre-wrap break-words">{{ comment.text }}</div>
      <div class="text-[11px] text-white/30 mt-0.5">{{ formatCommentTime(comment.timestamp) }}</div>
    </div>
    <div v-if="comments.length === 0" class="text-xs text-white/20">No comments yet</div>
  </div>

  <!-- Input -->
  <div class="flex gap-2 items-center">
    <input
      v-model="newComment"
      type="text"
      placeholder="Add a comment..."
      class="flex-1 h-8 bg-[#252525] border border-[#3f3f46] rounded px-3 text-sm text-white placeholder:text-white/30 focus:outline-none focus:border-[#525258]"
      @keydown.enter="addComment"
    />
    <button
      class="p-1.5 rounded hover:bg-white/10 text-white/40 hover:text-white transition-colors cursor-pointer"
      @click="addComment"
    >
      <Send class="size-4" />
    </button>
  </div>
</div>
```

**Step 3: Commit**

```bash
git add app/components/AssetDetailOverlay.vue
git commit -m "feat: add comments section with localStorage persistence"
```

---

### Task 4: Implement "Open Workflow" via bridge

**Files:**
- Modify: `app/components/AssetDetailOverlay.vue`
- Modify: `custom_nodes/sailor_bridge/js/bridge.js` (in `/Users/julien/Documents/GitHub/Sailor/`)

**Step 1: Store full history entry and add openWorkflow function**

Add a `historyEntry` ref to store the raw response, and the `openWorkflow` function:

```typescript
const historyEntry = ref<any>(null)

// Inside fetchHistoryData(), after getting `entry`, add:
// historyEntry.value = entry

const { openTab } = useTabs()

function openWorkflow() {
  if (!historyEntry.value) return

  // Extract workflow from extra_pnginfo or prompt
  const prompt = historyEntry.value.prompt
  const extraData = Array.isArray(prompt) ? prompt[3] : null
  const workflow = extraData?.extra_pnginfo?.workflow ?? null
  const promptDict = Array.isArray(prompt) ? prompt[2] : prompt

  // Open a new project tab
  openTab({ type: 'project', label: `Workflow (${props.image.filename})` })

  // Wait for iframe to load, then send workflow
  setTimeout(() => {
    const iframes = document.querySelectorAll('iframe[src*="8188"]')
    const targetIframe = iframes[iframes.length - 1] as HTMLIFrameElement
    if (targetIframe?.contentWindow) {
      targetIframe.contentWindow.postMessage({
        type: 'sailor',
        action: 'loadWorkflow',
        workflow,
        prompt: promptDict,
      }, '*')
    }
  }, 2000)

  emit('close')
}
```

**Step 2: Add loadWorkflow handler in bridge.js**

In the `window.addEventListener("message", ...)` handler in bridge.js, add after the `toggleQueue` block:

```javascript
if (action === "loadWorkflow") {
  const { workflow, prompt } = event.data;
  if (workflow && window.app) {
    try {
      window.app.loadGraphData(workflow);
      console.log("[Sailor Bridge] Loaded workflow from asset detail");
    } catch (e) {
      console.error("[Sailor Bridge] Failed to load workflow:", e);
    }
  }
}
```

**Step 3: Commit**

```bash
git add app/components/AssetDetailOverlay.vue
cd /Users/julien/Documents/GitHub/Sailor && git add custom_nodes/sailor_bridge/js/bridge.js
git commit -m "feat: open workflow from asset detail via bridge postMessage"
```

---

### Task 5: Polish and edge cases

**Files:**
- Modify: `app/components/AssetDetailOverlay.vue`

**Step 1: Add loading state for metadata**

Show skeleton/loading indicator while `historyData` is null:

```html
<div v-if="!historyData" class="px-4 py-3">
  <div class="h-3 w-24 bg-white/10 rounded animate-pulse mb-2" />
  <div class="h-3 w-32 bg-white/10 rounded animate-pulse" />
</div>
```

**Step 2: Handle missing prompt text gracefully**

Some workflows (like API-based ones) may not have CLIPTextEncode nodes. The template already uses `v-if` so this is handled. Add a broader search for prompt text:

```typescript
// Also check for 'positive' or 'text' inputs in any node
if (!promptText && prompt && typeof prompt === 'object') {
  for (const node of Object.values(prompt) as any[]) {
    const text = node.inputs?.text ?? node.inputs?.positive
    if (text && typeof text === 'string' && text.length > 5) {
      promptText = text
      break
    }
  }
}
```

**Step 3: Commit**

```bash
git add app/components/AssetDetailOverlay.vue
git commit -m "feat: polish asset detail with loading state and edge cases"
```
