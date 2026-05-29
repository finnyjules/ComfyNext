<script setup lang="ts">
/**
 * "Get Started" modal — appears on a fresh blank project. Mad-libs picker:
 *
 *   I want to create [output]
 *                from [input]
 *               using [model]   →   [ Start ]   Skip
 *
 * The middle row only shows when the picked model actually consumes an
 * upstream asset; pure prompt-to-X paths collapse it ("Create X using Y").
 *
 * On Start, the parent layout drops a source artifact (when from ≠ prompt)
 * + the generator node, wired together — beginners get a runnable graph in
 * three clicks. Skip leaves a blank canvas for power users.
 */
import { X, ChevronDown, Sparkles, Image as ImageIcon, Film, AudioWaveform, MessageSquareText, Box as BoxIcon } from 'lucide-vue-next'
import {
  type IOType,
  type Capability,
  CAPABILITIES,
  INPUT_TYPES,
  OUTPUT_TYPES,
  inputsFor,
  capabilitiesFor,
} from '~/data/node-capabilities'
import { getGeneratorIcon, getModelBrand } from '~/data/generator-icons'

const emit = defineEmits<{
  start: [payload: { capability: Capability }]
  skip: []
}>()

const OUTPUT_ICONS: Record<string, any> = {
  image: ImageIcon,
  video: Film,
  audio: AudioWaveform,
  text:  MessageSquareText,
  '3d':  BoxIcon,
}
const INPUT_ICONS: Record<string, any> = {
  prompt: Sparkles,
  image:  ImageIcon,
  video:  Film,
  audio:  AudioWaveform,
  text:   MessageSquareText,
}

const output = ref<IOType | null>(null)
const input = ref<IOType | null>(null)
const selected = ref<Capability | null>(null)

const openSlot = ref<'output' | 'input' | 'model' | null>(null)

// Available inputs for the chosen output, in a stable visual order.
const availableInputs = computed(() => {
  if (!output.value) return []
  const reachable = new Set(inputsFor(output.value))
  return INPUT_TYPES.filter((i) => reachable.has(i.id))
})

const availableModels = computed<Capability[]>(() => {
  if (!output.value || !input.value) return []
  return capabilitiesFor(input.value, output.value)
})

function pickOutput(o: IOType) {
  output.value = o
  // Reset downstream slots if the previous picks no longer make sense.
  if (input.value && !inputsFor(o).includes(input.value)) input.value = null
  if (selected.value && (selected.value.to !== o)) selected.value = null
  openSlot.value = 'input'  // auto-advance
}

function pickInput(i: IOType) {
  input.value = i
  if (selected.value && (selected.value.from !== i)) selected.value = null
  openSlot.value = 'model'
}

function pickModel(c: Capability) {
  selected.value = c
  openSlot.value = null
}

function start() {
  if (!selected.value) return
  emit('start', { capability: selected.value })
}

function outputLabel(id: IOType): string {
  return OUTPUT_TYPES.find((o) => o.id === id)?.label || id
}
function inputLabel(id: IOType): string {
  return INPUT_TYPES.find((i) => i.id === id)?.label || id
}
</script>

<template>
  <!-- Backdrop -->
  <div class="fixed inset-0 z-[100] flex items-center justify-center bg-black/60 backdrop-blur-sm p-6" @click.self="emit('skip')">
    <!-- Modal panel -->
    <div class="relative w-[640px] max-w-full bg-[#161616] border border-white/10 rounded-2xl shadow-2xl">
      <!-- Close -->
      <button
        class="absolute top-4 right-4 size-7 rounded-md flex items-center justify-center text-white/40 hover:text-white/85 hover:bg-white/[0.06] transition-colors cursor-pointer"
        title="Skip — open a blank canvas"
        @click="emit('skip')"
      >
        <X class="size-4" />
      </button>

      <div class="px-8 pt-8 pb-6">
        <h2 class="text-[20px] font-medium text-white tracking-[0.1px] mb-1">
          What do you want to make?
        </h2>
        <p class="text-[13px] text-white/45 mb-6">
          Pick a path and we'll set up the canvas for you.
        </p>

        <!-- Mad-libs row -->
        <div class="flex flex-wrap items-center gap-x-2 gap-y-3 text-[18px] text-white/85 leading-relaxed">
          <span>I want to create</span>

          <!-- Output slot -->
          <div class="relative">
            <button
              class="inline-flex items-center gap-2 px-3 py-1.5 rounded-lg border transition-colors cursor-pointer"
              :class="output ? 'bg-white/[0.06] border-white/15 text-white' : 'bg-white/[0.03] border-white/10 text-white/55 hover:text-white/85 hover:border-white/20'"
              @click="openSlot = openSlot === 'output' ? null : 'output'"
            >
              <component :is="output ? OUTPUT_ICONS[output] : Sparkles" class="size-4 shrink-0" :stroke-width="1.75" />
              <span>{{ output ? outputLabel(output) : '…' }}</span>
              <ChevronDown class="size-3.5 text-white/40" />
            </button>
            <!-- Popup -->
            <div
              v-if="openSlot === 'output'"
              class="absolute z-10 left-0 top-full mt-1.5 min-w-[200px] flex flex-col gap-0.5 bg-[#1a1a1a]/95 backdrop-blur-md border border-white/10 rounded-lg p-1.5 shadow-xl"
            >
              <button
                v-for="opt in OUTPUT_TYPES"
                :key="opt.id"
                class="flex items-center gap-2 px-3 py-1.5 rounded-md text-left transition-colors cursor-pointer hover:bg-white/[0.08] text-[14px] text-white/85"
                @click="pickOutput(opt.id)"
              >
                <component :is="OUTPUT_ICONS[opt.id]" class="size-4 text-white/70" :stroke-width="1.75" />
                <span>{{ opt.label }}</span>
              </button>
            </div>
          </div>

          <!-- Input slot (always present so users see how the path expands) -->
          <span class="text-white/45">from</span>
          <div class="relative">
            <button
              class="inline-flex items-center gap-2 px-3 py-1.5 rounded-lg border transition-colors cursor-pointer disabled:opacity-40 disabled:cursor-not-allowed"
              :class="input ? 'bg-white/[0.06] border-white/15 text-white' : 'bg-white/[0.03] border-white/10 text-white/55 hover:text-white/85 hover:border-white/20'"
              :disabled="!output"
              @click="openSlot = openSlot === 'input' ? null : 'input'"
            >
              <component :is="input ? INPUT_ICONS[input] : Sparkles" class="size-4 shrink-0" :stroke-width="1.75" />
              <span>{{ input ? inputLabel(input) : '…' }}</span>
              <ChevronDown class="size-3.5 text-white/40" />
            </button>
            <div
              v-if="openSlot === 'input' && output"
              class="absolute z-10 left-0 top-full mt-1.5 min-w-[200px] flex flex-col gap-0.5 bg-[#1a1a1a]/95 backdrop-blur-md border border-white/10 rounded-lg p-1.5 shadow-xl"
            >
              <button
                v-for="opt in availableInputs"
                :key="opt.id"
                class="flex items-center gap-2 px-3 py-1.5 rounded-md text-left transition-colors cursor-pointer hover:bg-white/[0.08] text-[14px] text-white/85"
                @click="pickInput(opt.id)"
              >
                <component :is="INPUT_ICONS[opt.id]" class="size-4 text-white/70" :stroke-width="1.75" />
                <span>{{ opt.label }}</span>
              </button>
            </div>
          </div>

          <span class="text-white/45">using</span>
          <div class="relative">
            <button
              class="inline-flex items-center gap-2 px-3 py-1.5 rounded-lg border transition-colors cursor-pointer disabled:opacity-40 disabled:cursor-not-allowed"
              :class="selected ? 'bg-white/[0.06] border-white/15 text-white' : 'bg-white/[0.03] border-white/10 text-white/55 hover:text-white/85 hover:border-white/20'"
              :disabled="!input"
              @click="openSlot = openSlot === 'model' ? null : 'model'"
            >
              <component
                :is="selected ? (getGeneratorIcon(selected.nodeType) || Sparkles) : Sparkles"
                class="size-4 shrink-0"
                :stroke-width="1.75"
              />
              <span>{{ selected ? selected.useCase : 'pick a model' }}</span>
              <ChevronDown class="size-3.5 text-white/40" />
            </button>
            <div
              v-if="openSlot === 'model' && input"
              class="absolute z-10 left-0 top-full mt-1.5 w-[320px] max-h-[320px] overflow-y-auto flex flex-col gap-0.5 bg-[#1a1a1a]/95 backdrop-blur-md border border-white/10 rounded-lg p-1.5 shadow-xl"
            >
              <button
                v-for="cap in availableModels"
                :key="`${cap.nodeType}-${cap.from}`"
                class="flex items-start gap-2.5 px-3 py-2 rounded-md text-left transition-colors cursor-pointer hover:bg-white/[0.08]"
                @click="pickModel(cap)"
              >
                <component :is="getGeneratorIcon(cap.nodeType) || Sparkles" class="size-4 text-white/85 shrink-0 mt-0.5" :stroke-width="1.75" />
                <div class="flex flex-col min-w-0 flex-1">
                  <span class="text-[13px] text-white/90 truncate">{{ cap.useCase }}</span>
                  <span class="text-[11px] text-white/45 truncate">{{ cap.model }}</span>
                </div>
                <span v-if="getModelBrand(cap.nodeType)" class="text-[10px] uppercase tracking-wider text-white/40 mt-0.5">
                  {{ getModelBrand(cap.nodeType) }}
                </span>
              </button>
              <div v-if="!availableModels.length" class="px-3 py-2 text-[12px] text-white/45">
                No models for this combo yet.
              </div>
            </div>
          </div>
        </div>

        <!-- Actions -->
        <div class="mt-8 flex items-center justify-end gap-3">
          <button
            class="text-[12px] text-white/45 hover:text-white/85 transition-colors cursor-pointer"
            @click="emit('skip')"
          >
            Skip — start with a blank canvas
          </button>
          <button
            class="flex items-center gap-2 px-5 h-9 rounded-lg bg-comfy-blue/90 hover:bg-comfy-blue text-white text-[13px] font-medium transition-colors cursor-pointer disabled:opacity-40 disabled:cursor-not-allowed"
            :disabled="!selected"
            @click="start"
          >
            <Sparkles class="size-3.5" />
            Start
          </button>
        </div>
      </div>
    </div>
  </div>
</template>
