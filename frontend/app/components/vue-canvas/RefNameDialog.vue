<script setup lang="ts">
import { ref, watch, nextTick } from 'vue'
import { normalizeRefName } from '~/lib/refs/registry'

const props = defineProps<{ open: boolean; suggested?: string }>()
const emit = defineEmits<{ (e: 'confirm', name: string, text: string): void; (e: 'cancel'): void }>()

const name = ref('')
const text = ref('')
const nameInput = ref<HTMLInputElement | null>(null)
watch(() => props.open, (o) => {
  if (!o) return
  name.value = props.suggested ?? ''
  text.value = ''
  // Autofocus the handle field so the user can type immediately.
  nextTick(() => nameInput.value?.focus())
})

const valid = () => !!normalizeRefName(name.value)
function confirm() {
  const n = normalizeRefName(name.value)
  if (!n) return
  emit('confirm', n, text.value.trim())
}
</script>

<template>
  <!-- Teleported to <body>: VueFlow node wrappers carry a pan/zoom transform, so
       a `fixed` overlay rendered inside a node would anchor to the node, not the
       viewport. Matches the LightTableModal / edit-menu pattern in this canvas. -->
  <Teleport to="body">
    <div v-if="open" class="fixed inset-0 z-[95] flex items-center justify-center bg-black/50" @click.self="emit('cancel')">
      <div class="w-[320px] rounded-xl border border-white/10 bg-neutral-900 p-4 text-white shadow-2xl">
        <p class="text-sm font-medium">Name this reference</p>
        <p class="mt-0.5 text-[11px] text-white/45">Reuse it anywhere as <span class="font-mono" style="color: var(--var-accent-text)">@{{ normalizeRefName(name) || 'name' }}</span></p>
        <input
          ref="nameInput"
          v-model="name"
          placeholder="tracksuit"
          class="mt-3 w-full rounded bg-white/5 border border-white/10 px-2 py-1.5 text-xs outline-none focus:border-white/25"
          @keydown.enter="confirm"
          @keydown.esc.stop="emit('cancel')"
        />
        <input
          v-model="text"
          placeholder="text for prompts (optional): black Nike tracksuit"
          class="mt-2 w-full rounded bg-white/5 border border-white/10 px-2 py-1.5 text-[11px] outline-none focus:border-white/25"
          @keydown.enter="confirm"
          @keydown.esc.stop="emit('cancel')"
        />
        <div class="mt-3 flex justify-end gap-2">
          <button class="rounded px-2.5 py-1 text-[11px] text-white/60 hover:text-white" @click="emit('cancel')">Cancel</button>
          <button class="rounded px-2.5 py-1 text-[11px] disabled:opacity-40" style="background: var(--var-accent); color: #111" :disabled="!valid()" @click="confirm">Create</button>
        </div>
      </div>
    </div>
  </Teleport>
</template>
