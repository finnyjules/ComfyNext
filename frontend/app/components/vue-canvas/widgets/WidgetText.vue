<script setup lang="ts">
defineProps<{ modelValue: any; multiline?: boolean }>()
defineEmits<{ 'update:modelValue': [value: string] }>()
</script>
<template>
  <textarea
    v-if="multiline"
    class="w-full bg-white/[0.18] border border-white/20 rounded-md px-2.5 py-2 text-[13px] leading-relaxed text-foreground resize-y min-h-[92px] outline-none shadow-[0_4px_12px_rgba(0,0,0,0.35)] focus-visible:border-ring focus-visible:ring-ring/50 focus-visible:ring-[3px] transition-[color,box-shadow]"
    :value="modelValue"
    @input="$emit('update:modelValue', ($event.target as HTMLTextAreaElement).value)"
  />
  <input
    v-else
    class="w-full bg-white/5 border border-white/10 rounded px-2 h-7 text-[11px] text-foreground outline-none focus-visible:border-ring focus-visible:ring-ring/50 focus-visible:ring-[3px] transition-[color,box-shadow]"
    :value="modelValue"
    @input="$emit('update:modelValue', ($event.target as HTMLInputElement).value)"
  />
</template>
