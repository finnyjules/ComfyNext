<script setup lang="ts">
import { STAGING_FAMILIES, STAGINGS } from '~~/shared/template-grid/generate/stagings'
import { getTheme, resolveInk, THEME_PALETTE, THEMES } from '~~/shared/template-grid/generate/themes'

const ctx = inject<any>('gridEditor')

// Group the flat STAGINGS list into the family sections declared next to the
// registry (STAGING_FAMILIES) — the panel never hardcodes a second copy of
// staging→family membership.
const stagingFamilies = computed(() => {
  return Object.entries(STAGING_FAMILIES).map(([family, ids]) => ({
    family,
    stagings: ids.map(id => STAGINGS.find(s => s.id === id)).filter((s): s is typeof STAGINGS[number] => !!s),
  }))
})

// Ink/Accent swatches read the live brand kit to show what's actually
// applied — `setBrandOverride` writes template.brand directly, independent
// of the theme axis, so "current" here is the brand value, not the theme's
// stamped default (that's only used to resolve what "Auto" means).
const currentTheme = computed(() => getTheme(ctx.genTheme.value) ?? getTheme('paper')!)
const currentThemeInk = computed(() => resolveInk(currentTheme.value.field))
const currentForeground = computed(() => ctx.template.value?.brand?.foreground)
const currentAccent = computed(() => ctx.template.value?.brand?.accent)
const isAutoInk = computed(() => currentForeground.value === currentThemeInk.value)
</script>

<template>
  <div data-layout-controls class="px-4 py-3.5 flex flex-col gap-3 border-b border-white/[0.06]">
    <p class="text-[10px] uppercase tracking-[0.12em] text-white/35">Layout</p>

    <div>
      <div class="flex items-center justify-between mb-1.5">
        <span class="text-[9px] uppercase tracking-wide text-white/40">Staging</span>
        <button class="text-[10px]" :class="ctx.genLocks.value.staging ? 'text-action' : 'text-white/30'"
          title="Lock staging so Surprise only rolls the theme" @click="ctx.toggleLock('staging')">
          {{ ctx.genLocks.value.staging ? '🔒' : '🔓' }}
        </button>
      </div>
      <div class="flex flex-col gap-2">
        <div v-for="group in stagingFamilies" :key="group.family">
          <p class="text-[9px] uppercase text-white/30 mb-1">{{ group.family }}</p>
          <div class="flex flex-wrap gap-1.5">
            <button v-for="s in group.stagings" :key="s.id"
              :title="s.supports?.needsImage && !ctx.genHasImage.value ? 'wire an image first' : s.blurb"
              :disabled="s.supports?.needsImage && !ctx.genHasImage.value"
              class="h-8 px-2 rounded-md text-[10px] font-semibold border transition-colors cursor-pointer disabled:cursor-not-allowed disabled:opacity-30"
              :class="ctx.genStaging.value === s.id ? 'bg-white text-black border-white' : 'border-white/10 text-white/60 hover:text-white'"
              @click="ctx.setStaging(s.id)">{{ s.name }}</button>
          </div>
        </div>
      </div>
    </div>

    <div>
      <div class="flex items-center justify-between mb-1.5">
        <span class="text-[9px] uppercase tracking-wide text-white/40">Theme</span>
        <button class="text-[10px]" :class="ctx.genLocks.value.theme ? 'text-action' : 'text-white/30'"
          title="Lock theme so Surprise only rolls the staging" @click="ctx.toggleLock('theme')">
          {{ ctx.genLocks.value.theme ? '🔒' : '🔓' }}
        </button>
      </div>
      <div class="flex flex-wrap gap-1.5">
        <button v-for="th in THEMES" :key="th.id" :title="th.name" :data-theme-swatch="th.id"
          class="size-6 rounded-full border cursor-pointer transition"
          :class="ctx.genTheme.value === th.id ? 'border-white ring-1 ring-action' : 'border-white/20 hover:border-white/50'"
          :style="{ background: th.field }" @click="ctx.setTheme(th.id)" />
      </div>
    </div>

    <div>
      <span class="text-[9px] uppercase tracking-wide text-white/40 block mb-1.5">Ink</span>
      <div class="flex flex-wrap gap-1.5 items-center">
        <button class="h-6 px-2 rounded-full text-[10px] font-semibold border transition-colors cursor-pointer"
          :class="isAutoInk ? 'border-white ring-1 ring-action text-white' : 'border-white/20 text-white/50 hover:border-white/50 hover:text-white'"
          title="Auto — resolved from the theme's field colour" @click="ctx.setBrandOverride('foreground', null)">Auto</button>
        <button v-for="hex in THEME_PALETTE" :key="hex" :title="hex" :data-ink-swatch="hex"
          class="size-6 rounded-full border cursor-pointer transition"
          :class="currentForeground === hex ? 'border-white ring-1 ring-action' : 'border-white/20 hover:border-white/50'"
          :style="{ background: hex }" @click="ctx.setBrandOverride('foreground', hex)" />
      </div>
    </div>

    <div>
      <div class="flex items-center justify-between mb-1.5">
        <span class="text-[9px] uppercase tracking-wide text-white/40">Accent</span>
        <button class="text-[10px] font-semibold px-1.5 h-5 rounded transition-colors cursor-pointer"
          :class="ctx.genAccentOnHero.value ? 'bg-action text-white' : 'bg-white/[0.04] text-white/40 hover:text-white/70'"
          title="Colour the headline tier in the accent instead of the ink" @click="ctx.toggleAccentOnHero()">
          Accent on headline
        </button>
      </div>
      <div class="flex flex-wrap gap-1.5">
        <button v-for="hex in THEME_PALETTE" :key="hex" :title="hex" :data-accent-swatch="hex"
          class="size-6 rounded-full border cursor-pointer transition"
          :class="currentAccent === hex ? 'border-white ring-1 ring-action' : 'border-white/20 hover:border-white/50'"
          :style="{ background: hex }" @click="ctx.setBrandOverride('accent', hex)" />
      </div>
    </div>

    <div class="flex items-center gap-2">
      <button class="flex-1 h-8 rounded-md bg-white/[0.06] hover:bg-white/[0.12] text-[12px] text-white/80 font-semibold cursor-pointer"
        @click="ctx.shuffleLayout()">Shuffle ⇄</button>
      <button class="flex-1 h-8 rounded-md bg-action hover:bg-action/90 text-[12px] text-white font-semibold cursor-pointer"
        @click="ctx.surpriseLayout()">Surprise ✦</button>
    </div>
    <p class="text-[10px] text-white/30 font-mono">seed {{ ctx.genSeed.value }}</p>
  </div>
</template>
