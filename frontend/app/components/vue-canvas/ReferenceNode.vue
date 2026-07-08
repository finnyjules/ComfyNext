<!-- frontend/app/components/vue-canvas/ReferenceNode.vue -->
<script setup lang="ts">
import { computed, ref, inject, type ComputedRef } from 'vue'
import { Handle, Position } from '@vue-flow/core'
import { AtSign } from 'lucide-vue-next'
import { listRefNames, resolveRef, type RefRegistry } from '~/lib/refs/registry'

const props = defineProps<{ id: string; data: { properties?: Record<string, any> } }>()
// Read-only registry provided by the layout (Task 7 Step 3).
const activeRegistry = inject<ComputedRef<RefRegistry>>('assetRegistry', computed(() => ({})))

const refName = computed<string | null>(() => props.data?.properties?.comfynext_refName ?? null)
const entry = computed(() => refName.value ? resolveRef(activeRegistry.value, refName.value) : undefined)
const thumbUrl = computed(() => entry.value ? `/view?filename=${encodeURIComponent(entry.value.filename)}&type=input` : null)
const names = computed(() => listRefNames(activeRegistry.value))
const picking = ref(false)

function pick(name: string) {
  ;(props.data.properties ??= {}).comfynext_refName = name
  picking.value = false
}
</script>

<template>
  <div class="relative w-[200px] rounded-xl border border-white/10 bg-neutral-900 text-white shadow-lg">
    <Handle id="output-0" type="source" :position="Position.Right"
      class="!h-3 !w-3 !rounded-full !border-2 !border-white/30 !bg-[#1a1a1a]" :style="{ top: '50%' }" />
    <div class="flex items-center gap-2 border-b border-white/10 px-3 py-2">
      <AtSign class="h-3.5 w-3.5" style="color: var(--var-accent-text)" />
      <span class="text-xs font-medium text-white/80">Reference</span>
    </div>
    <div class="p-2.5">
      <img v-if="thumbUrl" :src="thumbUrl" class="mb-2 h-24 w-full rounded object-cover bg-black/40" />
      <button class="w-full rounded bg-white/5 px-2 py-1 text-left text-[11px]" @click.stop="picking = !picking">
        <span v-if="refName" class="font-mono" style="color: var(--var-accent-text)">@{{ refName }}</span>
        <span v-else class="text-white/40">Pick a reference…</span>
      </button>
      <div v-if="picking" class="mt-1 rounded-md border border-white/10 bg-neutral-900 p-1">
        <button v-for="n in names" :key="n" class="block w-full px-2 py-1 text-left text-[11px] hover:bg-white/10" @click.stop="pick(n)">@{{ n }}</button>
        <p v-if="!names.length" class="px-2 py-1 text-[11px] text-white/40">No references yet</p>
      </div>
    </div>
  </div>
</template>
