<script setup lang="ts">
// Shared modal chrome for the media "studio" editors (Space Type, Gradient Studio):
// a centered, fixed-size modal with a big preview + actions footer on the left and a
// scrollable controls column on the right. Both surfaces use this so they stay in
// sync — change the chrome here and both editors update.
</script>

<template>
  <div class="fixed inset-0 z-50 flex items-center justify-center bg-black/70">
    <div class="flex h-[620px] max-h-[92vh] w-[1080px] max-w-[95vw] gap-4 rounded-xl bg-neutral-900 p-4 text-white">
      <div class="flex min-h-0 flex-1 flex-col">
        <div class="flex min-h-0 flex-1 items-center justify-center">
          <slot name="preview" />
        </div>
        <div class="mt-3 flex shrink-0 items-center gap-2">
          <slot name="actions" />
        </div>
      </div>
      <div class="flex w-72 shrink-0 flex-col gap-2 overflow-y-auto pr-1 min-h-0">
        <slot name="controls" />
      </div>
    </div>
  </div>
</template>
