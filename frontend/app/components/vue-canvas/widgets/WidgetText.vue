<script setup lang="ts">
defineProps<{ modelValue: any; multiline?: boolean }>()
defineEmits<{ 'update:modelValue': [value: string] }>()
</script>
<template>
  <textarea
    v-if="multiline"
    class="w-full bg-[#2a2a2a] border border-[#3a3a3a] rounded-md px-2 py-1 text-[10px] text-white/80 resize-y min-h-[60px] focus:outline-none focus:border-white/20"
    :value="modelValue"
    @input="$emit('update:modelValue', ($event.target as HTMLTextAreaElement).value)"
  />
  <input
    v-else
    class="w-full bg-[#2a2a2a] border border-[#3a3a3a] rounded-md px-2 py-1 text-[10px] text-white/80 focus:outline-none focus:border-white/20"
    :value="modelValue"
    @input="$emit('update:modelValue', ($event.target as HTMLInputElement).value)"
  />
</template>
