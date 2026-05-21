<script setup lang="ts">
const props = defineProps<{
  id: string
  data: {
    title: string
    text: string
    nodeType?: string
    color?: string
    bgcolor?: string
    size?: [number, number]
  }
}>()

// Simple markdown rendering for MarkdownNote nodes
const renderedHtml = computed(() => {
  if (!props.data.text) return ''
  if (props.data.nodeType !== 'MarkdownNote') return ''

  let html = props.data.text
    // Escape HTML
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    // Headers
    .replace(/^### (.+)$/gm, '<h3>$1</h3>')
    .replace(/^## (.+)$/gm, '<h2>$1</h2>')
    .replace(/^# (.+)$/gm, '<h1>$1</h1>')
    // Bold & italic
    .replace(/\*\*(.+?)\*\*/g, '<strong>$1</strong>')
    .replace(/\*(.+?)\*/g, '<em>$1</em>')
    // Code blocks
    .replace(/```[\s\S]*?```/g, (m) => `<pre>${m.slice(3, -3).trim()}</pre>`)
    .replace(/`([^`]+)`/g, '<code>$1</code>')
    // Links
    .replace(/\[([^\]]+)\]\(([^)]+)\)/g, '<a href="$2">$1</a>')
    // Line breaks
    .replace(/\n/g, '<br>')

  return html
})

const isMarkdown = computed(() => props.data.nodeType === 'MarkdownNote')
</script>

<template>
  <div
    class="comfy-note rounded-xl border border-white/10 select-none backdrop-blur-sm"
    :style="{
      width: data.size?.[0] ? `${data.size[0]}px` : '260px',
      background: data.bgcolor
        ? `color-mix(in srgb, ${data.bgcolor} 25%, #1a1a1a)`
        : '#1e1e1e',
    }"
  >
    <div class="flex items-center gap-2 px-3 py-2 border-b border-white/5">
      <div class="size-2 rounded-full shrink-0 bg-white/30" />
      <span class="text-xs font-semibold text-white/90 truncate">{{ data.title }}</span>
    </div>
    <!-- Markdown content -->
    <div v-if="isMarkdown && renderedHtml" class="note-markdown px-3 py-2 text-xs text-white/70 break-words leading-relaxed" v-html="renderedHtml" />
    <!-- Plain text content -->
    <div v-else-if="data.text" class="px-3 py-2 text-xs text-white/70 whitespace-pre-wrap break-words leading-relaxed">{{ data.text }}</div>
  </div>
</template>

<style scoped>
.comfy-note {
  box-shadow: 0 4px 16px rgba(0, 0, 0, 0.4), 0 1px 4px rgba(0, 0, 0, 0.2);
}

.note-markdown :deep(h1) { font-size: 1.1em; font-weight: 700; margin: 0.3em 0; color: rgba(255,255,255,0.9); }
.note-markdown :deep(h2) { font-size: 1em; font-weight: 600; margin: 0.3em 0; color: rgba(255,255,255,0.85); }
.note-markdown :deep(h3) { font-size: 0.95em; font-weight: 600; margin: 0.2em 0; color: rgba(255,255,255,0.8); }
.note-markdown :deep(strong) { font-weight: 600; color: rgba(255,255,255,0.85); }
.note-markdown :deep(a) { color: #60a5fa; text-decoration: underline; }
.note-markdown :deep(code) { background: rgba(255,255,255,0.08); padding: 0.1em 0.3em; border-radius: 3px; font-family: monospace; font-size: 0.9em; }
.note-markdown :deep(pre) { background: rgba(0,0,0,0.3); padding: 0.5em; border-radius: 6px; overflow-x: auto; font-family: monospace; font-size: 0.85em; margin: 0.3em 0; }
</style>
