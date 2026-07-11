<script setup lang="ts">
/** Four labeled logo slots (primary / mark / wordmark / on-dark). The primary
 *  slot displays the legacy kit.logo as a fallback; writes always go to
 *  kit.logos (clearing primary also clears the legacy string so it doesn't
 *  resurface through the brandLogoUrl fallback). */
import { BRAND_LOGO_SLOT_KEYS, type BrandKit, type BrandLogoSlotKey } from '~~/shared/brand/types'
import { brandLogoUrl } from '~~/shared/brand/resolve'
import { uploadBrandImage } from '~/lib/brand/upload'
import { toast } from 'vue-sonner'

const props = defineProps<{ kit: BrandKit }>()
const emit = defineEmits<{ update: [patch: Partial<BrandKit>] }>()

const SLOT_LABELS: Record<BrandLogoSlotKey, string> = {
  primary: 'Primary', mark: 'Mark', wordmark: 'Wordmark', onDark: 'On dark',
}

function slotUrl(slot: BrandLogoSlotKey): string | undefined {
  return brandLogoUrl(props.kit, slot)
}
function setSlot(slot: BrandLogoSlotKey, url: string) {
  const logos = { ...props.kit.logos, [slot]: url }
  // Clearing primary must also clear the legacy string, or it resurfaces.
  emit('update', slot === 'primary' && !url ? { logos, logo: '' } : { logos })
}
async function onFile(slot: BrandLogoSlotKey, e: Event) {
  const input = e.target as HTMLInputElement
  const file = input.files?.[0]
  input.value = ''
  if (!file) return
  try { setSlot(slot, await uploadBrandImage(file)) }
  catch (err) {
    console.error('[Brand] logo upload:', err)
    toast.error('Logo upload failed')
  }
}
</script>

<template>
  <div class="space-y-1.5 text-xs">
    <div v-for="slot in BRAND_LOGO_SLOT_KEYS" :key="slot" class="flex items-center gap-2">
      <span class="w-16 shrink-0 text-white/60">{{ SLOT_LABELS[slot] }}</span>
      <span
        class="size-7 shrink-0 rounded border border-white/10 bg-[#1a1a1a] bg-center bg-contain bg-no-repeat"
        :class="slot === 'onDark' ? 'bg-[#0a0a0a]' : ''"
        :style="slotUrl(slot) ? { backgroundImage: `url(${JSON.stringify(slotUrl(slot))})` } : {}"
      />
      <input
        type="text" :value="slotUrl(slot) ?? ''" placeholder="https://… or upload"
        class="min-w-0 flex-1 bg-[#1a1a1a] border border-[#2a2a2a] rounded px-1 py-0.5 text-white/90 outline-none"
        @change="setSlot(slot, ($event.target as HTMLInputElement).value.trim())"
      >
      <label class="shrink-0 px-2 py-0.5 rounded bg-white/[0.06] hover:bg-white/[0.1] cursor-pointer text-white/70">
        Upload<input type="file" accept="image/*" class="hidden" @change="onFile(slot, $event)">
      </label>
    </div>
  </div>
</template>
