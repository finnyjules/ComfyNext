<script setup lang="ts">
// Settings → Models. Lists every downloadable model bundle with its on-disk
// status and download size, and lets the user fetch missing ones with live
// progress. Reuses the module-level useModelDownloads composable, so a download
// started here (or from the Toolbox) keeps running and stays in sync across both.
import { Loader2, CloudDownload, Check, RotateCw } from 'lucide-vue-next'

const { download, inflight, modelsReady, bundleInfo, probeModelStatus, ensureModels, ALL_MODEL_BUNDLES } = useModelDownloads()

onMounted(() => { for (const k of ALL_MODEL_BUNDLES) probeModelStatus(k) })

function fmtSize(bytes: number): string {
  if (!bytes) return ''
  if (bytes >= 1024 * 1024 * 1024) return `${(bytes / 1024 / 1024 / 1024).toFixed(1)} GB`
  return `${Math.round(bytes / 1024 / 1024)} MB`
}
function labelFor(key: string): string {
  return bundleInfo[key]?.label || key
}
function isReady(key: string): boolean {
  return modelsReady.has(key)
}
function isDownloading(key: string): boolean {
  return inflight.has(key)
}
function isErrored(key: string): boolean {
  return download.activeKey === key && download.phase === 'error'
}
function progressPct(key: string): number {
  if (download.activeKey !== key || !download.total) return 0
  return Math.min(100, Math.round((download.downloaded / download.total) * 100))
}
function statusLine(key: string): string {
  if (isErrored(key)) return download.message || 'Download failed.'
  if (isDownloading(key)) {
    if (download.activeKey === key && download.phase === 'downloading' && download.total) {
      return `${fmtSize(download.downloaded)} / ${fmtSize(download.total)}`
    }
    if (download.activeKey === key && download.phase === 'preparing') return 'Preparing…'
    return 'Starting…'
  }
  if (isReady(key)) return 'Installed'
  const size = bundleInfo[key]?.size
  return size ? `${fmtSize(size)} download` : 'Not installed'
}
</script>

<template>
  <div class="flex flex-col gap-1">
    <p class="text-[11px] text-white/35 pb-2">
      On-device models for local nodes (background removal, upscaling, face tools…). They
      download once and run free on your machine. Downloads continue if you close this window.
    </p>

    <div
      v-for="key in ALL_MODEL_BUNDLES"
      :key="key"
      class="flex items-center gap-3 py-3 border-b border-[#2a2a2a] last:border-0"
    >
      <!-- Status icon -->
      <div class="shrink-0 size-7 rounded-lg flex items-center justify-center"
        :class="isReady(key) ? 'bg-emerald-500/15 text-emerald-400' : 'bg-white/[0.06] text-white/40'">
        <Loader2 v-if="isDownloading(key)" class="size-3.5 animate-spin" />
        <Check v-else-if="isReady(key)" class="size-3.5" />
        <CloudDownload v-else class="size-3.5" />
      </div>

      <!-- Label + status -->
      <div class="flex-1 min-w-0">
        <div class="text-[13px] text-white/80 truncate">{{ labelFor(key) }}</div>
        <div class="text-[11px] mt-0.5 truncate"
          :class="isErrored(key) ? 'text-red-400' : isReady(key) ? 'text-emerald-400/70' : 'text-white/35'">
          {{ statusLine(key) }}
        </div>
        <!-- Progress bar while downloading -->
        <div v-if="isDownloading(key) && !isErrored(key)" class="mt-1.5 h-1 rounded-full bg-white/10 overflow-hidden">
          <div class="h-full bg-blue-500 transition-[width] duration-200" :style="{ width: progressPct(key) + '%' }" />
        </div>
      </div>

      <!-- Action -->
      <div class="shrink-0">
        <span v-if="isReady(key)" class="text-[11px] text-white/30">✓</span>
        <span v-else-if="isDownloading(key)" class="text-[11px] text-white/45 tabular-nums">
          {{ progressPct(key) }}%
        </span>
        <button
          v-else
          class="flex items-center gap-1.5 px-2.5 h-7 rounded-lg bg-white/[0.06] hover:bg-white/[0.12] text-white/75 hover:text-white text-[11px] transition-colors cursor-pointer"
          @click="ensureModels(key)"
        >
          <RotateCw v-if="isErrored(key)" class="size-3" />
          <CloudDownload v-else class="size-3" />
          {{ isErrored(key) ? 'Retry' : 'Download' }}
        </button>
      </div>
    </div>
  </div>
</template>
