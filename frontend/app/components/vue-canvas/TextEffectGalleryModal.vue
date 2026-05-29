<script setup lang="ts">
/**
 * TextEffectGalleryModal — picker for the "Text effect" node. Unlike the model
 * galleries (which fetch Replicate cover images), every card here live-renders
 * the user's ACTUAL typed word using a CSS approximation of the effect, so you
 * pick by seeing your word in each style. The real render comes from Ideogram
 * at run time.
 *
 * State path mirrors the other galleries:
 *   node.widgetsValues[effect_idx] = selected effect id
 */
import {
  TEXT_EFFECTS, TEXT_EFFECTS_BY_ID, TEXT_EFFECT_CATEGORY_LABELS,
  type TextEffect, type TextEffectCategory,
} from '~/data/text-effects'

const props = defineProps<{
  nodeId: string
  nodes: any[]
}>()
const emit = defineEmits<{ close: [] }>()

const node = computed(() => props.nodes.find(n => n.id === props.nodeId))

// -- Current effect + the live word ------------------------------------------

const effectWidgetIdx = computed(() => {
  const defs = (node.value?.data?.widgetDefs ?? []) as any[]
  return defs.findIndex(d => d.name === 'effect')
})
const currentEffectId = computed<string | null>(() => {
  const idx = effectWidgetIdx.value
  if (idx < 0) return null
  const v = node.value?.data?.widgetsValues?.[idx]
  return typeof v === 'string' ? v : null
})

// The user's typed word, read live from the node's `text` widget. Falls back to
// a placeholder so cards aren't blank before the user types anything.
const word = computed<string>(() => {
  const defs = (node.value?.data?.widgetDefs ?? []) as any[]
  const idx = defs.findIndex(d => d.name === 'text')
  const v = idx >= 0 ? node.value?.data?.widgetsValues?.[idx] : ''
  const s = typeof v === 'string' ? v.trim() : ''
  return s || 'Type'
})
// Uppercase reads best for these display treatments; cap length so a long
// phrase doesn't blow out the card.
const previewWord = computed(() => {
  const w = word.value.toUpperCase()
  return w.length > 10 ? w.slice(0, 10) : w
})

// -- Filtering ---------------------------------------------------------------

const searchQuery = ref('')
const activeFilterId = ref<string>('all')

const filters = computed(() => {
  const cats: TextEffectCategory[] = ['hype', 'museum']
  const counts = new Map<TextEffectCategory, number>()
  for (const e of TEXT_EFFECTS) counts.set(e.category, (counts.get(e.category) ?? 0) + 1)
  return [
    { id: 'all', label: 'All', count: TEXT_EFFECTS.length },
    ...cats.map(c => ({ id: c, label: TEXT_EFFECT_CATEGORY_LABELS[c], count: counts.get(c) ?? 0 })),
  ]
})

const visibleItems = computed<TextEffect[]>(() => {
  const q = searchQuery.value.trim().toLowerCase()
  return TEXT_EFFECTS.filter((e) => {
    if (activeFilterId.value !== 'all' && e.category !== activeFilterId.value) return false
    if (!q) return true
    return [e.label, e.pitch, ...e.tags].some(s => s.toLowerCase().includes(q))
  })
})

// -- Commit ------------------------------------------------------------------

const draftEffectId = ref<string | null>(currentEffectId.value)
watch(() => props.nodeId, () => { draftEffectId.value = currentEffectId.value })

function onConfirm(item: TextEffect) {
  const idx = effectWidgetIdx.value
  if (idx < 0) { emit('close'); return }
  node.value!.data.widgetsValues[idx] = item.id
  emit('close')
}

const focusedEffect = computed<TextEffect | null>(() =>
  draftEffectId.value ? TEXT_EFFECTS_BY_ID[draftEffectId.value] ?? null : null)
</script>

<template>
  <CatalogModal
    :open="true"
    :title="`Pick a text effect`"
    :subtitle="`${TEXT_EFFECTS.length} effects · live preview of “${word}”`"
    :items="visibleItems"
    :selected-id="currentEffectId"
    :filters="filters"
    :active-filter-id="activeFilterId"
    :search-query="searchQuery"
    search-placeholder="Search effects…"
    :confirm-label="focusedEffect ? `Use ${focusedEffect.label}` : 'Use this'"
    empty-message="No effects match."
    @close="emit('close')"
    @confirm="(item: any) => onConfirm(item as TextEffect)"
    @update:selected-id="(id: string) => draftEffectId = id"
    @update:active-filter-id="(id: string) => activeFilterId = id"
    @update:search-query="(q: string) => searchQuery = q"
  >
    <!-- Card: live-word preview in the effect's CSS approximation. -->
    <template #card="{ item }">
      <div class="fx-card-stage">
        <div
          class="fx-word"
          :class="`fx-${(item as TextEffect).cssPreview}`"
          :style="{ '--fx-accent': (item as TextEffect).accent } as any"
          :data-word="previewWord"
        >{{ previewWord }}</div>
      </div>
      <div class="px-3 pt-2 pb-3 flex flex-col gap-1">
        <span class="text-[13px] font-semibold text-white/90 leading-tight">{{ (item as TextEffect).label }}</span>
        <span class="text-[11px] text-white/50 leading-snug">{{ (item as TextEffect).pitch }}</span>
      </div>
    </template>

    <!-- Detail: bigger preview + the description + tags. -->
    <template #detail="{ item }">
      <div class="p-5 space-y-4">
        <div class="fx-detail-stage">
          <div
            class="fx-word fx-word--lg"
            :class="`fx-${(item as TextEffect).cssPreview}`"
            :style="{ '--fx-accent': (item as TextEffect).accent } as any"
            :data-word="previewWord"
          >{{ previewWord }}</div>
        </div>
        <div>
          <div class="flex items-center gap-2 mb-1">
            <span class="text-sm font-semibold text-white/95">{{ (item as TextEffect).label }}</span>
            <span class="text-[10px] uppercase tracking-[0.08em] px-1.5 py-0.5 rounded bg-white/[0.06] text-white/60">
              {{ TEXT_EFFECT_CATEGORY_LABELS[(item as TextEffect).category] }}
            </span>
          </div>
          <p class="text-[11.5px] text-white/60 leading-relaxed">{{ (item as TextEffect).pitch }}</p>
        </div>
        <div class="flex flex-wrap gap-1">
          <span
            v-for="t in (item as TextEffect).tags"
            :key="t"
            class="text-[10px] uppercase tracking-[0.05em] px-1.5 py-0.5 rounded bg-white/[0.05] text-white/55 border border-white/[0.05]"
          >{{ t }}</span>
        </div>
        <p class="text-[10.5px] text-white/35 leading-relaxed pt-2 border-t border-white/[0.06]">
          Rendered by Ideogram v3. The preview above is a CSS approximation —
          the generated image is the real thing.
        </p>
      </div>
    </template>
  </CatalogModal>
</template>

<style scoped>
.fx-card-stage,
.fx-detail-stage {
  display: flex;
  align-items: center;
  justify-content: center;
  background:
    radial-gradient(ellipse at 50% 40%, rgba(255,255,255,0.05), transparent 70%),
    #0e0e10;
  overflow: hidden;
}
.fx-card-stage { aspect-ratio: 16 / 10; width: 100%; }
.fx-detail-stage { aspect-ratio: 16 / 9; width: 100%; border-radius: 8px; }

.fx-word {
  font-family: ui-sans-serif, system-ui, -apple-system, 'Segoe UI', sans-serif;
  font-weight: 900;
  font-size: 34px;
  letter-spacing: -0.02em;
  line-height: 1;
  text-align: center;
  padding: 0 10px;
  white-space: nowrap;
}
.fx-word--lg { font-size: 64px; }

/* ---- CSS approximation recipes -------------------------------------------
   These don't have to be perfect — they communicate the vibe so the user can
   choose. The AI render is the real output. */

/* Chrome: vertical silver metallic gradient clipped to text. */
.fx-chrome {
  background: linear-gradient(180deg, #f8fbff 0%, #aebccd 38%, #5b6b80 50%, #cdd9e8 62%, #8a99ad 100%);
  -webkit-background-clip: text; background-clip: text;
  color: transparent;
  filter: drop-shadow(0 2px 3px rgba(0,0,0,0.5));
}

/* Holographic: animated rainbow gradient. */
.fx-holo {
  background: linear-gradient(100deg, #ff6ec4, #7873f5, #4ade80, #facc15, #ff6ec4);
  background-size: 300% 100%;
  -webkit-background-clip: text; background-clip: text;
  color: transparent;
  animation: fx-holo-shift 4s linear infinite;
}
@keyframes fx-holo-shift { to { background-position: 300% 0; } }

/* Glitch: RGB channel split via layered text-shadow + slight skew. */
.fx-glitch {
  color: #e8f6ff;
  transform: skewX(-4deg);
  text-shadow: 2px 0 rgba(255,0,80,0.85), -2px 0 rgba(0,225,255,0.85);
}

/* Gradient mesh / acid: bold multi-stop gradient. */
.fx-gradient {
  background: linear-gradient(120deg, var(--fx-accent), #ffffff 45%, var(--fx-accent));
  background-size: 200% 100%;
  -webkit-background-clip: text; background-clip: text;
  color: transparent;
  filter: saturate(1.2);
}

/* Risograph: duotone offset (one accent layer behind via shadow). */
.fx-riso {
  color: #f4f1ea;
  text-shadow: 3px 3px 0 var(--fx-accent);
  filter: contrast(1.05);
}

/* Concrete: heavy gray with emboss. */
.fx-concrete {
  color: #b8bcc2;
  text-shadow: 0 1px 0 #6b7078, 0 2px 1px rgba(0,0,0,0.6), 0 -1px 0 rgba(255,255,255,0.15);
}

/* Neon light-trail: layered glow. */
.fx-neon-trail {
  color: #fff;
  text-shadow:
    0 0 4px var(--fx-accent), 0 0 10px var(--fx-accent),
    0 0 22px var(--fx-accent), 0 0 40px var(--fx-accent);
}

/* Molten: hot gradient + glow. */
.fx-molten {
  background: linear-gradient(180deg, #fff3b0 0%, #ff8a00 45%, #c01500 100%);
  -webkit-background-clip: text; background-clip: text;
  color: transparent;
  filter: drop-shadow(0 0 10px rgba(255,90,0,0.7));
}

/* Frosted glass: translucent with light edge. */
.fx-glass {
  color: rgba(255,255,255,0.18);
  text-shadow: 0 1px 1px rgba(255,255,255,0.4), 0 0 18px rgba(186,230,253,0.45);
  -webkit-text-stroke: 1px rgba(255,255,255,0.5);
}

/* Wireframe: hollow stroked text. */
.fx-outline {
  color: transparent;
  -webkit-text-stroke: 1.5px var(--fx-accent);
  filter: drop-shadow(0 0 6px color-mix(in srgb, var(--fx-accent) 60%, transparent));
}

/* Styled fallback for volumetric effects: accent gradient fill. */
.fx-styled {
  background: linear-gradient(135deg, var(--fx-accent), #ffffff 80%);
  -webkit-background-clip: text; background-clip: text;
  color: transparent;
  filter: drop-shadow(0 2px 6px rgba(0,0,0,0.5));
}
</style>
