<script setup lang="ts">
import { Check, ChevronDown, Search, Sparkles, X as XIcon } from 'lucide-vue-next'
import { TEMPLATE_FONTS } from '~~/shared/template-fonts'

interface FontEntry {
  name: string
  category: string
  curated: boolean
  uploaded?: boolean   // user-uploaded licensed font (top section)
}

const GOOGLE_FONT_LIST: Omit<FontEntry, 'curated'>[] = [
  // Sans-serif
  { name: 'Roboto', category: 'sans' },
  { name: 'Open Sans', category: 'sans' },
  { name: 'Lato', category: 'sans' },
  { name: 'Montserrat', category: 'sans' },
  { name: 'Raleway', category: 'sans' },
  { name: 'Poppins', category: 'sans' },
  { name: 'Nunito', category: 'sans' },
  { name: 'Oswald', category: 'sans' },
  { name: 'Noto Sans', category: 'sans' },
  { name: 'Ubuntu', category: 'sans' },
  { name: 'Quicksand', category: 'sans' },
  { name: 'DM Sans', category: 'sans' },
  { name: 'Plus Jakarta Sans', category: 'sans' },
  { name: 'Figtree', category: 'sans' },
  { name: 'Outfit', category: 'sans' },
  { name: 'Manrope', category: 'sans' },
  { name: 'Jost', category: 'sans' },
  { name: 'Barlow', category: 'sans' },
  { name: 'Mulish', category: 'sans' },
  // Serif
  { name: 'Merriweather', category: 'serif' },
  { name: 'PT Serif', category: 'serif' },
  { name: 'Lora', category: 'serif' },
  { name: 'Libre Baskerville', category: 'serif' },
  { name: 'Cormorant Garamond', category: 'serif' },
  { name: 'EB Garamond', category: 'serif' },
  { name: 'Crimson Text', category: 'serif' },
  { name: 'Spectral', category: 'serif' },
  { name: 'Fraunces', category: 'serif' },
  { name: 'DM Serif Display', category: 'serif' },
  { name: 'Instrument Serif', category: 'serif' },
  // Display / decorative
  { name: 'Barlow Condensed', category: 'display' },
  { name: 'League Spartan', category: 'display' },
  { name: 'Archivo Black', category: 'display' },
  { name: 'Fjalla One', category: 'display' },
  { name: 'Staatliches', category: 'display' },
  { name: 'Righteous', category: 'display' },
  { name: 'Passion One', category: 'display' },
  { name: 'Teko', category: 'display' },
  { name: 'Pacifico', category: 'display' },
  { name: 'Dancing Script', category: 'display' },
  { name: 'Great Vibes', category: 'display' },
  { name: 'Sacramento', category: 'display' },
  { name: 'Caveat', category: 'display' },
  { name: 'Lobster', category: 'display' },
  { name: 'Permanent Marker', category: 'display' },
  // Monospace
  { name: 'JetBrains Mono', category: 'mono' },
  { name: 'Fira Code', category: 'mono' },
  { name: 'Source Code Pro', category: 'mono' },
  { name: 'Space Mono', category: 'mono' },
]

const CURATED_NAMES = new Set(TEMPLATE_FONTS.map(f => f.name))

const { fonts: uploadedFonts, ensure: ensureUploadedFont } = useUploadedFonts()

// Uploaded families take precedence over curated/Google of the same name.
const ALL_FONTS = computed<FontEntry[]>(() => {
  const uploadedNames = new Set(uploadedFonts.value.map(f => f.family))
  return [
    ...uploadedFonts.value.map(f => ({ name: f.family, category: 'brand', curated: false, uploaded: true })),
    ...TEMPLATE_FONTS.filter(f => !uploadedNames.has(f.name))
      .map(f => ({ name: f.name, category: f.category as string, curated: true })),
    ...GOOGLE_FONT_LIST.filter(f => !CURATED_NAMES.has(f.name) && !uploadedNames.has(f.name))
      .map(f => ({ ...f, curated: false })),
  ]
})

const KNOWN_NAMES = computed(() => new Set(ALL_FONTS.value.map(f => f.name)))

/** Load the real face for previews — uploaded via @font-face, else Google. */
function ensurePreview(f: FontEntry) {
  if (f.uploaded) ensureUploadedFont(f.name)
  else if (!f.curated) ensureGoogleFont(f.name)
}

const props = defineProps<{ modelValue: string }>()
const emit = defineEmits<{ 'update:modelValue': [v: string] }>()

const open = ref(false)
const search = ref('')
const triggerRef = ref<HTMLButtonElement>()
const searchRef = ref<HTMLInputElement>()
const dropdownPos = ref({ top: 0, left: 0, width: 0 })

const { ensure: ensureGoogleFont } = useGoogleFontPreview()

const { suggestions, loading: suggestLoading, error: suggestError, hasRun: suggestRan, suggest, clear: clearSuggest } = useFontSuggest()

function runSuggest() { suggest(search.value) }

// Load the real face for each suggestion so the preview row paints in-face.
watch(suggestions, (list) => { for (const s of list) ensureGoogleFont(s.family) })

// A fresh search query invalidates a prior suggestion run.
watch(search, () => { if (suggestRan.value) clearSuggest() })

const filtered = computed(() => {
  const q = search.value.trim().toLowerCase()
  if (!q) return ALL_FONTS.value
  return ALL_FONTS.value.filter(f => f.name.toLowerCase().includes(q))
})

const showCustomApply = computed(() => {
  const q = search.value.trim()
  return q.length > 2 && !KNOWN_NAMES.value.has(q) && filtered.value.length === 0
})

// CSS for each preview face is tiny — load eagerly so previews render on first
// paint. Uploaded faces inject an @font-face; Google fonts a <link>.
watch(filtered, (fonts) => {
  for (const f of fonts) ensurePreview(f)
})

function computePosition() {
  if (!triggerRef.value) return
  const r = triggerRef.value.getBoundingClientRect()
  const dropH = 340
  const spaceBelow = window.innerHeight - r.bottom
  const top = spaceBelow < dropH ? Math.max(4, r.top - dropH - 4) : r.bottom + 4
  dropdownPos.value = { top, left: r.left, width: r.width }
}

function toggle() {
  if (open.value) { open.value = false; return }
  search.value = ''
  open.value = true
  nextTick(() => {
    computePosition()
    // Eagerly load all non-curated preview faces (uploaded + Google)
    for (const f of ALL_FONTS.value) ensurePreview(f)
    nextTick(() => searchRef.value?.focus())
  })
}

function select(name: string) {
  const fam = name.trim()
  if (!fam) return
  // Ensure the real face is available (uploaded → @font-face, else Google).
  if (uploadedFonts.value.some(f => f.family === fam)) ensureUploadedFont(fam)
  else ensureGoogleFont(fam)
  emit('update:modelValue', fam)
  open.value = false
}

function onKeydown(e: KeyboardEvent) {
  if (e.key === 'Escape') {
    open.value = false
    triggerRef.value?.focus()
  }
  if (e.key === 'Enter') {
    e.preventDefault()
    runSuggest()
  }
}

function onClickOutside(e: MouseEvent) {
  if (!open.value) return
  const el = e.target as Node
  if (triggerRef.value?.contains(el)) return
  if (document.getElementById('font-picker-dp')?.contains(el)) return
  open.value = false
}

onMounted(() => document.addEventListener('mousedown', onClickOutside, true))
onUnmounted(() => document.removeEventListener('mousedown', onClickOutside, true))
</script>

<template>
  <!-- Trigger -->
  <button
    ref="triggerRef"
    type="button"
    class="w-full h-9 px-2.5 flex items-center gap-2 bg-white/[0.04] border border-white/[0.06] rounded text-white focus:outline-none focus:border-action/50 hover:border-white/[0.12] transition-colors cursor-pointer"
    @click="toggle"
  >
    <span
      class="flex-1 text-left text-[14px] leading-none truncate"
      :style="{ fontFamily: modelValue || 'Inter' }"
    >{{ modelValue || 'Inter' }}</span>
    <ChevronDown
      class="size-3.5 text-white/35 shrink-0 transition-transform duration-150"
      :class="open ? 'rotate-180' : ''"
    />
  </button>

  <!-- Dropdown — teleported to body so panel overflow: hidden doesn't clip it -->
  <Teleport to="body">
    <div
      v-if="open"
      id="font-picker-dp"
      class="fixed z-[9999] flex flex-col bg-[#1a1a1e] border border-white/[0.1] rounded-xl shadow-[0_12px_48px_rgba(0,0,0,0.7)] overflow-hidden"
      :style="{ top: `${dropdownPos.top}px`, left: `${dropdownPos.left}px`, width: `${Math.max(dropdownPos.width, 240)}px` }"
      @keydown="onKeydown"
    >
      <!-- Search bar -->
      <div class="px-2.5 py-2 flex items-center gap-2 border-b border-white/[0.06]">
        <Search class="size-3.5 text-white/30 shrink-0" />
        <input
          ref="searchRef"
          v-model="search"
          placeholder="Search fonts…"
          spellcheck="false"
          class="flex-1 min-w-0 bg-transparent text-[12px] text-white placeholder-white/30 focus:outline-none"
        />
        <button
          v-if="search"
          tabindex="-1"
          class="text-white/30 hover:text-white/70 cursor-pointer transition-colors"
          @click="search = ''"
        >
          <XIcon class="size-3" />
        </button>
        <button
          type="button"
          tabindex="-1"
          title="Suggest fonts from a description"
          class="shrink-0 flex items-center gap-1 whitespace-nowrap text-[11px] text-white/40 hover:text-white/90 cursor-pointer transition-colors disabled:opacity-40"
          :disabled="suggestLoading"
          @click="runSuggest"
        >
          <Sparkles class="size-3.5" /> Ask AI
        </button>
      </div>

      <!-- Scrollable font list -->
      <div class="overflow-y-auto" style="max-height: 280px;">
        <!-- ✨ Suggested (from a description) -->
        <template v-if="suggestLoading || suggestError || suggestions.length || suggestRan">
          <div class="px-3 pt-2.5 pb-1 text-[9px] uppercase tracking-[0.14em] text-white/40 font-medium select-none flex items-center gap-1.5">
            <Sparkles class="size-2.5" /> Suggested
          </div>
          <div v-if="suggestLoading" class="px-3 py-2 text-[12px] text-white/40 italic">Finding fonts…</div>
          <div v-else-if="suggestError" class="px-3 py-2 text-[12px] text-white/40">{{ suggestError }}</div>
          <div v-else-if="!suggestions.length" class="px-3 py-2 text-[12px] text-white/40">
            No matches — try describing the style differently.
          </div>
          <button
            v-for="s in suggestions"
            :key="'s' + s.family"
            type="button"
            class="w-full px-3 py-2 flex items-center gap-2 hover:bg-white/[0.05] transition-colors cursor-pointer"
            :class="s.family === modelValue ? 'bg-action/[0.08]' : ''"
            @click="select(s.family)"
          >
            <span class="flex-1 min-w-0 text-left">
              <span class="block text-[15px] text-white leading-tight truncate" :style="{ fontFamily: s.family }">{{ s.family }}</span>
              <span class="block text-[10px] text-white/35 leading-tight truncate">{{ s.reason }}</span>
            </span>
            <span class="text-[9px] text-white/20 uppercase tracking-wider shrink-0 select-none">{{ s.category }}</span>
            <Check v-if="s.family === modelValue" class="size-3 text-action shrink-0" />
          </button>
          <div class="mx-3 my-1 border-t border-white/[0.05]" />
        </template>

        <!-- Empty state -->
        <div
          v-if="filtered.length === 0"
          class="px-3 py-5 text-[12px] text-white/30 text-center italic"
        >
          No fonts match "{{ search }}"
        </div>

        <!-- Uploaded (brand) section -->
        <template v-if="filtered.some(f => f.uploaded)">
          <div class="px-3 pt-2.5 pb-1 text-[9px] uppercase tracking-[0.14em] text-action/50 font-medium select-none">Brand fonts</div>
          <button
            v-for="f in filtered.filter(x => x.uploaded)"
            :key="f.name"
            type="button"
            class="w-full px-3 py-2 flex items-center gap-2 hover:bg-white/[0.05] transition-colors cursor-pointer"
            :class="f.name === modelValue ? 'bg-action/[0.08]' : ''"
            @click="select(f.name)"
          >
            <span
              class="flex-1 text-left text-[15px] text-white leading-tight truncate"
              :style="{ fontFamily: f.name }"
            >{{ f.name }}</span>
            <span class="text-[9px] text-action/40 uppercase tracking-wider shrink-0 select-none">brand</span>
            <Check v-if="f.name === modelValue" class="size-3 text-action shrink-0" />
          </button>
        </template>

        <!-- Curated section -->
        <template v-if="filtered.some(f => f.curated)">
          <div
            class="px-3 pb-1 text-[9px] uppercase tracking-[0.14em] text-white/25 font-medium select-none"
            :class="filtered.some(f => f.uploaded) ? 'pt-2.5 border-t border-white/[0.05] mt-0.5' : 'pt-2.5'"
          >Curated</div>
          <button
            v-for="f in filtered.filter(x => x.curated)"
            :key="f.name"
            type="button"
            class="w-full px-3 py-2 flex items-center gap-2 hover:bg-white/[0.05] transition-colors cursor-pointer"
            :class="f.name === modelValue ? 'bg-action/[0.08]' : ''"
            @click="select(f.name)"
          >
            <span
              class="flex-1 text-left text-[15px] text-white leading-tight truncate"
              :style="{ fontFamily: f.name }"
            >{{ f.name }}</span>
            <span class="text-[9px] text-white/20 uppercase tracking-wider shrink-0 select-none">{{ f.category }}</span>
            <Check v-if="f.name === modelValue" class="size-3 text-action shrink-0" />
          </button>
        </template>

        <!-- Google Fonts section -->
        <template v-if="filtered.some(f => !f.curated && !f.uploaded)">
          <div
            class="px-3 pb-1 text-[9px] uppercase tracking-[0.14em] text-white/25 font-medium select-none"
            :class="filtered.some(f => f.curated || f.uploaded) ? 'pt-2.5 border-t border-white/[0.05] mt-0.5' : 'pt-2.5'"
          >Google Fonts</div>
          <button
            v-for="f in filtered.filter(x => !x.curated && !x.uploaded)"
            :key="f.name"
            type="button"
            class="w-full px-3 py-2 flex items-center gap-2 hover:bg-white/[0.05] transition-colors cursor-pointer"
            :class="f.name === modelValue ? 'bg-action/[0.08]' : ''"
            @click="select(f.name)"
          >
            <span
              class="flex-1 text-left text-[15px] text-white leading-tight truncate"
              :style="{ fontFamily: f.name }"
            >{{ f.name }}</span>
            <span class="text-[9px] text-white/20 uppercase tracking-wider shrink-0 select-none">{{ f.category }}</span>
            <Check v-if="f.name === modelValue" class="size-3 text-action shrink-0" />
          </button>
        </template>
      </div>

      <!-- Custom family footer: only shown when search matches nothing in the list -->
      <div
        v-if="showCustomApply"
        class="px-2.5 py-2 border-t border-white/[0.06] flex items-center gap-2"
      >
        <span class="flex-1 text-[11px] text-white/40 truncate">Apply "{{ search }}"</span>
        <button
          type="button"
          class="h-6 px-3 rounded-md bg-action/15 text-action text-[11px] font-medium hover:bg-action/25 transition-colors cursor-pointer shrink-0"
          @click="select(search)"
        >Use</button>
      </div>
    </div>
  </Teleport>
</template>
