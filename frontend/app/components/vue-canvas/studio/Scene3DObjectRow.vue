<script setup lang="ts">
// One object-list row plus its subtree. Recursive (`Scene3DObjectRow` refers to
// itself by name), which is why this is a real component rather than more
// markup inside the surface.
import { computed, ref } from 'vue'
import { Box, Lightbulb, Folder, ChevronRight, ChevronDown, Eye, EyeOff, Copy, Trash2, RotateCcw } from 'lucide-vue-next'
import type { SceneObject } from '~/lib/scene3d/config'
import { childrenOf } from '~/lib/scene3d/hierarchy'

const props = defineProps<{
  object: SceneObject
  objects: SceneObject[]
  selectedIds: string[]
  glbError: Record<string, boolean>
  depth: number
}>()
const emit = defineEmits<{
  select: [id: string, additive: boolean]
  remove: [id: string]
  duplicate: [id: string]
  retry: [id: string]
  toggleVisible: [id: string]
}>()

const children = computed(() => childrenOf(props.objects, props.object.id))
// Expand state is LOCAL UI state on purpose: persisting it would dirty the
// document on a disclosure click and sync a cosmetic toggle across windows.
const expanded = ref(true)
const icon = computed(() =>
  props.object.kind === 'light' ? Lightbulb : props.object.kind === 'group' ? Folder : Box)
</script>

<template>
  <div>
    <div class="group flex items-center gap-2 rounded px-2 py-1 text-xs"
      :class="selectedIds.includes(object.id) ? 'bg-white/15' : 'hover:bg-white/5'"
      :style="{ paddingLeft: `${8 + depth * 12}px` }"
      @click="emit('select', object.id, $event.shiftKey || $event.metaKey || $event.ctrlKey)">
      <button v-if="children.length" type="button" class="-ml-1 shrink-0 opacity-60 hover:opacity-100"
        @click.stop="expanded = !expanded">
        <component :is="expanded ? ChevronDown : ChevronRight" class="h-3 w-3" />
      </button>
      <span v-else class="w-2 shrink-0" />
      <component :is="icon" class="h-3.5 w-3.5 shrink-0 opacity-60" />
      <span class="flex-1 truncate" :class="glbError[object.id] ? 'text-red-400' : ''">{{ object.name }}</span>
      <span v-if="children.length" class="shrink-0 text-[10px] tabular-nums opacity-40">{{ children.length }}</span>
      <button v-if="glbError[object.id]" type="button" class="text-red-400 opacity-90 hover:opacity-100"
        title="Load failed — retry" @click.stop="emit('retry', object.id)"><RotateCcw class="h-3.5 w-3.5" /></button>
      <button type="button" class="opacity-0 group-hover:opacity-70" @click.stop="emit('toggleVisible', object.id)">
        <component :is="object.visible ? Eye : EyeOff" class="h-3.5 w-3.5" />
      </button>
      <button type="button" class="opacity-0 group-hover:opacity-70" @click.stop="emit('duplicate', object.id)"><Copy class="h-3.5 w-3.5" /></button>
      <button type="button" class="opacity-0 group-hover:opacity-70" @click.stop="emit('remove', object.id)"><Trash2 class="h-3.5 w-3.5" /></button>
    </div>
    <template v-if="expanded">
      <Scene3DObjectRow v-for="c in children" :key="c.id"
        :object="c" :objects="objects" :selected-ids="selectedIds" :glb-error="glbError" :depth="depth + 1"
        @select="(id, additive) => emit('select', id, additive)"
        @remove="(id) => emit('remove', id)"
        @duplicate="(id) => emit('duplicate', id)"
        @retry="(id) => emit('retry', id)"
        @toggle-visible="(id) => emit('toggleVisible', id)" />
    </template>
  </div>
</template>
