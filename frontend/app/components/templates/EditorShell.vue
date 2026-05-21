<script setup lang="ts">
/** Editor surface that owns the live `useTemplateEditor` state. */
import { Check, Loader2, Plus, RefreshCcw, Save, Image as ImageIcon, Square, Type as TypeIcon } from 'lucide-vue-next'

import type { ImageElement, ShapeElement, Template, TextElement } from '~~/server/templates/schema'

const props = defineProps<{
  initial: Template
  // When true, the editor runs against an in-memory layout (canvas modal
  // mode). Save emits an event instead of POSTing to the file CRUD endpoint
  // so the parent (SmartLayoutEditorModal) can write the result back into
  // the node's widget data.
  embedded?: boolean
  // Optional override for the placeholder values shown while editing. The
  // canvas modal passes the live upstream Text node's value here so the
  // editor previews actual content instead of generic sample copy.
  initialProps?: Record<string, string>
  // Same idea for `{{ brand.x }}` placeholders — wired from the SmartLayout
  // node's brand socket. Empty when nothing's wired (sample brand stays).
  initialBrand?: Record<string, string>
}>()
const emit = defineEmits<{ save: [layout: Template] }>()

const ctx = useTemplateEditor(props.initial)
provide('templateEditor', ctx)

// Seed the composable's sample placeholders from the parent. We keep the
// composable's existing defaults for any role the parent didn't override, so
// editors opened standalone still get realistic-looking copy.
if (props.initialProps && Object.keys(props.initialProps).length > 0) {
  Object.assign(ctx.sampleProps.value, props.initialProps)
}
if (props.initialBrand && Object.keys(props.initialBrand).length > 0) {
  Object.assign(ctx.sampleBrand.value, props.initialBrand)
}
// Stay reactive to upstream changes — if the user edits the wired Text node
// while the modal is open, the preview reflects it.
watch(() => props.initialProps, (next) => {
  if (next && Object.keys(next).length > 0) {
    Object.assign(ctx.sampleProps.value, next)
  }
}, { deep: true })
watch(() => props.initialBrand, (next) => {
  if (next && Object.keys(next).length > 0) {
    Object.assign(ctx.sampleBrand.value, next)
  }
}, { deep: true })

// Override the composable's save when in embedded mode so it commits to the
// node instead of hitting /api/templates. We do this by intercepting the
// Save button click below; the composable's own save() still works for any
// future non-embedded entry point.
async function handleSave() {
  if (props.embedded) {
    // Strip reactivity before emitting so the consumer gets a plain object
    // safe to JSON.stringify into the node widget.
    emit('save', JSON.parse(JSON.stringify(ctx.template.value)))
    ctx.dirty.value = false
  } else {
    await ctx.save()
  }
}

const {
  template, currentAspect, aspect, defaultAspect, editingOverride,
  selectedId, selectedElement,
  dirty, saving, saveError, sampleProps, sampleBrand,
  addElement, deleteElement, setAspect, save,
} = ctx

const aspectKeys = computed(() => Object.keys(template.value.aspects))

// True when the selected element has an override for `aspectKey`, used to
// flag aspect tabs with a small dot so the designer sees at a glance which
// aspects have been tweaked away from the default.
function aspectHasOverrideForSelection(aspectKey: string): boolean {
  if (!selectedElement.value) return false
  if (aspectKey === defaultAspect.value) return false
  const ov = selectedElement.value.overrides?.[aspectKey]
  return !!ov && Object.keys(ov).length > 0
}

function uid(prefix: string) {
  return `${prefix}_${Math.random().toString(36).slice(2, 8)}`
}

function addText() {
  const el: TextElement = {
    id: uid('text'),
    type: 'text',
    role: 'TEXT',
    anchor: 'top-left',
    offset: { x: '8%', y: '8%' },
    size: { w: '60%', h: 'auto' },
    style: { fontSize: 48, fontWeight: 700, color: '#ffffff', align: 'left' },
    content: 'New text',
  }
  addElement(el)
}

function addImage() {
  const el: ImageElement = {
    id: uid('image'),
    type: 'image',
    role: 'IMAGE',
    anchor: 'center',
    offset: { x: 0, y: 0 },
    size: { w: '60%', h: '60%' },
    style: { fit: 'cover' },
    content: '{{ props.hero }}',
  }
  addElement(el)
}

function addShape() {
  const el: ShapeElement = {
    id: uid('shape'),
    type: 'shape',
    shape: 'rect',
    role: 'SHAPE',
    anchor: 'center',
    offset: { x: 0, y: 0 },
    size: { w: 200, h: 100 },
    style: { fill: '#96b4ff', borderRadius: 8 },
  }
  addElement(el)
}
</script>

<template>
  <div class="h-full w-full flex flex-col">
    <!-- Top bar -->
    <div class="shrink-0 h-14 px-4 border-b border-white/[0.06] flex items-center gap-4 bg-[#0e0e10]">
      <div class="flex items-center gap-2 min-w-0">
        <div class="text-[10px] uppercase tracking-[0.14em] text-white/30 font-medium">Template</div>
        <input
          v-model="template.name"
          class="bg-transparent text-[14px] font-medium text-white px-1.5 py-1 rounded hover:bg-white/[0.04] focus:bg-white/[0.06] focus:outline-none w-[280px] max-w-[280px]"
          @input="ctx.dirty.value = true"
        />
      </div>

      <!-- Aspect tabs -->
      <div class="flex items-center gap-1 ml-4">
        <button
          v-for="key in aspectKeys"
          :key="key"
          class="relative h-8 px-3 rounded-md text-[12px] tabular-nums transition-colors cursor-pointer"
          :class="currentAspect === key
            ? 'bg-white/10 text-white font-medium'
            : 'text-white/55 hover:bg-white/[0.04] hover:text-white/85'"
          :title="(template.aspects[key].label || key) + (key === defaultAspect ? '  (default — edits write to base)' : '  (edits write to override)')"
          @click="setAspect(key)"
        >
          {{ key }}
          <!-- Override indicator: visible when the selected element has any
               override stored for this aspect. -->
          <span
            v-if="aspectHasOverrideForSelection(key)"
            class="absolute top-1 right-1 size-1.5 rounded-full bg-[#96b4ff]"
          />
        </button>
      </div>

      <div class="flex-1" />

      <!-- Add element menu -->
      <div class="flex items-center gap-1 mr-2">
        <button class="h-8 px-3 rounded-md bg-white/[0.04] hover:bg-white/[0.08] text-[12px] text-white/70 hover:text-white flex items-center gap-1.5 cursor-pointer" @click="addText">
          <TypeIcon class="size-3.5" />
          Text
        </button>
        <button class="h-8 px-3 rounded-md bg-white/[0.04] hover:bg-white/[0.08] text-[12px] text-white/70 hover:text-white flex items-center gap-1.5 cursor-pointer" @click="addImage">
          <ImageIcon class="size-3.5" />
          Image
        </button>
        <button class="h-8 px-3 rounded-md bg-white/[0.04] hover:bg-white/[0.08] text-[12px] text-white/70 hover:text-white flex items-center gap-1.5 cursor-pointer" @click="addShape">
          <Square class="size-3.5" />
          Shape
        </button>
      </div>

      <!-- Save state -->
      <div class="flex items-center gap-3">
        <span v-if="saveError" class="text-[12px] text-rose-400 truncate max-w-[200px]">{{ saveError }}</span>
        <span v-else-if="saving" class="text-[12px] text-white/45 flex items-center gap-1.5">
          <Loader2 class="size-3 animate-spin" /> Saving…
        </span>
        <span v-else-if="dirty" class="text-[12px] text-amber-300/80">● Unsaved changes</span>
        <span v-else class="text-[12px] text-white/40 flex items-center gap-1.5">
          <Check class="size-3" /> Saved
        </span>
        <button
          class="inline-flex items-center gap-1.5 h-8 px-3 rounded-md bg-white text-[#0a0a0a] text-[12px] font-medium hover:bg-white/90 transition-colors cursor-pointer disabled:opacity-40 disabled:cursor-not-allowed"
          :disabled="!dirty || saving"
          @click="handleSave"
        >
          <Save class="size-3.5" />
          {{ embedded ? 'Save & close' : 'Save' }}
        </button>
      </div>
    </div>

    <!-- Body -->
    <div class="flex-1 flex min-h-0">
      <!-- Canvas pane -->
      <div class="flex-1 min-w-0 relative overflow-hidden bg-[#121212]">
        <TemplatesEditorCanvas />
      </div>

      <!-- Right panel -->
      <div class="w-[320px] shrink-0 border-l border-white/[0.06] bg-[#0e0e10] overflow-y-auto">
        <TemplatesPropertyPanel v-if="selectedElement" />
        <TemplatesLayersPanel v-else />
      </div>
    </div>
  </div>
</template>
