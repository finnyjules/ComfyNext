<script setup lang="ts">
import {
  X, Monitor, Paintbrush, MousePointer2, Zap, FolderOpen, ChevronDown, Sparkles,
} from 'lucide-vue-next'

const { settingsOpen, closeSettings } = useSettingsModal()
const { getLocalSetting, setLocalSetting } = useLocalSettings()

// Settings data
const settings = ref<Record<string, any>>({})
const loading = ref(false)
const activeCategory = ref('general')

const COMFY_API = '/comfyui'

// Settings definitions grouped by category
const categories = [
  { id: 'general', label: 'General', icon: Monitor },
  { id: 'canvas', label: 'Canvas', icon: MousePointer2 },
  { id: 'appearance', label: 'Appearance', icon: Paintbrush },
  { id: 'execution', label: 'Execution', icon: Zap },
  { id: 'workflow', label: 'Workflow', icon: FolderOpen },
  { id: 'ai', label: 'AI', icon: Sparkles },
]

interface SettingDef {
  id: string
  label: string
  type: 'toggle' | 'select' | 'number' | 'slider' | 'text'
  local?: boolean
  options?: { label: string, value: any }[]
  min?: number
  max?: number
  step?: number
  description?: string
}

const settingsByCategory: Record<string, SettingDef[]> = {
  general: [
    { id: 'Comfy.Locale', label: 'Language', type: 'select', options: [
      { label: 'English', value: 'en' },
      { label: '中文', value: 'zh' },
      { label: '日本語', value: 'ja' },
      { label: '한국어', value: 'ko' },
      { label: 'Русский', value: 'ru' },
      { label: 'Français', value: 'fr' },
    ] },
    { id: 'Comfy.EnableTooltips', label: 'Enable tooltips', type: 'toggle' },
    { id: 'Comfy.ConfirmClear', label: 'Confirm before clearing workflow', type: 'toggle' },
    { id: 'Comfy.DevMode', label: 'Developer mode', type: 'toggle', description: 'Show API save button and other dev tools' },
    { id: 'Comfy.Window.UnloadConfirmation', label: 'Confirm before closing window', type: 'toggle' },
    { id: 'Comfy.Notification.ShowVersionUpdates', label: 'Show version update notifications', type: 'toggle' },
  ],
  canvas: [
    { id: 'Comfy.Canvas.LeftMouseClickBehavior', label: 'Left click behavior', type: 'select', options: [
      { label: 'Select', value: 'Select' },
      { label: 'Panning', value: 'Panning' },
    ] },
    { id: 'Comfy.Canvas.MouseWheelScroll', label: 'Mouse wheel action', type: 'select', options: [
      { label: 'Zoom in/out', value: 'Zoom in/out' },
      { label: 'Panning', value: 'Panning' },
    ] },
    { id: 'Comfy.LinkRenderMode', label: 'Link render mode', type: 'select', options: [
      { label: 'Spline', value: 2 },
      { label: 'Linear', value: 1 },
      { label: 'Straight', value: 0 },
      { label: 'Hidden', value: 4 },
    ] },
    { id: 'Comfy.Graph.ZoomSpeed', label: 'Zoom speed', type: 'slider', min: 0.5, max: 3, step: 0.1 },
    { id: 'Comfy.SnapToGrid.GridSize', label: 'Snap to grid size', type: 'number', min: 1, max: 500 },
    { id: 'Comfy.Canvas.SelectionToolbox', label: 'Show selection toolbox', type: 'toggle' },
    { id: 'Comfy.Graph.CtrlShiftZoom', label: 'Fast zoom shortcut (Ctrl+Shift+Drag)', type: 'toggle' },
    { id: 'Comfy.EnableWorkflowViewRestore', label: 'Restore canvas position per workflow', type: 'toggle' },
  ],
  appearance: [
    { id: 'Comfy.VueNodes.Enabled', label: 'Modern node design', type: 'toggle', description: 'Use the new Vue-based node rendering', local: true },
    { id: 'Comfy.Node.Opacity', label: 'Node opacity', type: 'slider', min: 0.1, max: 1, step: 0.05 },
    { id: 'Comfy.Graph.CanvasInfo', label: 'Show canvas info (FPS)', type: 'toggle' },
    { id: 'Comfy.Graph.LinkMarkers', label: 'Link midpoint markers', type: 'select', options: [
      { label: 'None', value: 'None' },
      { label: 'Arrow', value: 'Arrow' },
      { label: 'Circle', value: 'Circle' },
    ] },
    { id: 'Comfy.NodeBadge.NodeSourceBadgeMode', label: 'Node source badge', type: 'select', options: [
      { label: 'None', value: 'None' },
      { label: 'Show all', value: 'Show all' },
      { label: 'Hide built-in', value: 'Hide built-in' },
    ] },
    { id: 'Comfy.NodeBadge.NodeIdBadgeMode', label: 'Node ID badge', type: 'select', options: [
      { label: 'None', value: 'None' },
      { label: 'Show all', value: 'Show all' },
    ] },
    { id: 'Comfy.TextareaWidget.FontSize', label: 'Textarea font size', type: 'number', min: 8, max: 24 },
    { id: 'LiteGraph.Canvas.MaximumFps', label: 'Maximum FPS', type: 'number', min: 15, max: 144 },
  ],
  execution: [
    { id: 'Comfy.Execution.PreviewMethod', label: 'Live preview method', type: 'select', options: [
      { label: 'Auto', value: 'auto' },
      { label: 'TAESD', value: 'taesd' },
      { label: 'Latent2RGB', value: 'latent2rgb' },
      { label: 'None', value: 'none' },
    ] },
    { id: 'Comfy.PreviewFormat', label: 'Preview image format', type: 'select', options: [
      { label: 'WebP', value: 'webp' },
      { label: 'JPEG', value: 'jpeg' },
      { label: 'PNG', value: 'png' },
    ] },
    { id: 'Comfy.QueueButton.BatchCountLimit', label: 'Batch count limit', type: 'number', min: 1, max: 100 },
    { id: 'Comfy.Queue.MaxHistoryItems', label: 'Queue history size', type: 'number', min: 10, max: 10000 },
    { id: 'Comfy.NodeReplacement.Enabled', label: 'Automatic node replacement', type: 'toggle' },
    { id: 'Comfy.Validation.Workflows', label: 'Validate workflows', type: 'toggle' },
  ],
  workflow: [
    { id: 'Comfy.Workflow.AutoSave', label: 'Auto save', type: 'select', options: [
      { label: 'After delay', value: 'after delay' },
      { label: 'Off', value: 'off' },
    ] },
    { id: 'Comfy.Workflow.AutoSaveDelay', label: 'Auto save delay (ms)', type: 'number', min: 500, max: 60000, step: 500 },
    { id: 'Comfy.Workflow.Persist', label: 'Persist workflow state on reload', type: 'toggle' },
    { id: 'Comfy.Workflow.ShowMissingModelsWarning', label: 'Show missing models warning', type: 'toggle' },
    { id: 'Comfy.Workflow.ShowMissingNodesWarning', label: 'Show missing nodes warning', type: 'toggle' },
    { id: 'Comfy.Workflow.ConfirmDelete', label: 'Confirm before deleting workflows', type: 'toggle' },
    { id: 'Comfy.Workflow.SortNodeIdOnSave', label: 'Sort node IDs when saving', type: 'toggle' },
    { id: 'Comfy.PromptFilename', label: 'Prompt for filename when saving', type: 'toggle' },
  ],
  ai: [
    { id: 'ComfyNext.AI.AnthropicApiKey', label: 'Anthropic API key', type: 'text', local: true, description: 'Required for the Explain feature. Your key is sent directly to Anthropic and never stored on our servers.' },
  ],
}

// Fetch all settings from ComfyUI
async function fetchSettings() {
  loading.value = true
  try {
    const res = await fetch(`${COMFY_API}/settings`)
    settings.value = await res.json()
  } catch {
    settings.value = {}
  } finally {
    loading.value = false
  }
}

// Save a single setting
async function saveSetting(id: string, value: any) {
  settings.value[id] = value
  try {
    await fetch(`${COMFY_API}/settings/${id}`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(value),
    })
  } catch (e) {
    console.error('[Settings] Failed to save:', id, e)
  }
}

// Watch for modal open to fetch settings
watch(settingsOpen, (open) => {
  if (open) {
    activeCategory.value = 'general'
    fetchSettings()
    // Load local settings into cache
    const localDefs = Object.values(settingsByCategory).flat().filter((s) => s.local)
    for (const def of localDefs) {
      localSettingsCache.value[def.id] = getLocalSetting(def.id) ?? ''
    }
  }
})

// Local settings (stored in localStorage, not ComfyUI)
const localSettingsCache = ref<Record<string, string>>({})

function getSettingValue(id: string, fallback?: any) {
  const def = Object.values(settingsByCategory).flat().find((s) => s.id === id)
  if (def?.local) {
    return localSettingsCache.value[id] ?? getLocalSetting(id) ?? fallback ?? ''
  }
  return settings.value[id] ?? fallback
}

function saveLocalSetting(id: string, value: string) {
  localSettingsCache.value[id] = value
  setLocalSetting(id, value)
}

function handleSelectChange(setting: SettingDef, rawValue: string) {
  // Match against option values to preserve original type (number vs string)
  const match = setting.options?.find((o) => String(o.value) === rawValue)
  saveSetting(setting.id, match ? match.value : rawValue)
}
</script>

<template>
  <Transition
    enter-active-class="transition-all duration-200 ease-out"
    leave-active-class="transition-all duration-150 ease-in"
    enter-from-class="opacity-0"
    leave-to-class="opacity-0"
  >
    <div
      v-if="settingsOpen"
      class="fixed inset-0 z-[10000] flex items-center justify-center"
    >
      <!-- Backdrop -->
      <div class="absolute inset-0 bg-black/50" @click="closeSettings" />

      <!-- Modal -->
      <div class="relative w-[680px] h-[80vh] bg-[#1e1e1e] border border-[#3a3a3a] rounded-[16px] shadow-2xl flex overflow-hidden">
        <!-- Left sidebar -->
        <div class="w-[180px] bg-[#171717] border-r border-[#2a2a2a] py-4 flex flex-col shrink-0">
          <div class="flex items-center justify-between px-4 mb-4">
            <h2 class="text-sm font-semibold text-white">Settings</h2>
          </div>
          <nav class="flex flex-col gap-0.5 px-2">
            <button
              v-for="cat in categories"
              :key="cat.id"
              class="flex items-center gap-2.5 px-3 py-2 rounded-lg text-xs font-medium transition-colors cursor-pointer"
              :class="activeCategory === cat.id
                ? 'bg-white/10 text-white'
                : 'text-white/50 hover:text-white/70 hover:bg-white/5'"
              @click="activeCategory = cat.id"
            >
              <component :is="cat.icon" class="size-4" />
              {{ cat.label }}
            </button>
          </nav>
        </div>

        <!-- Right content -->
        <div class="flex-1 flex flex-col min-w-0">
          <!-- Header -->
          <div class="flex items-center justify-between px-5 py-4 border-b border-[#2a2a2a]">
            <h3 class="text-sm font-medium text-white">
              {{ categories.find((c) => c.id === activeCategory)?.label }}
            </h3>
            <button class="text-white/40 hover:text-white transition-colors cursor-pointer" @click="closeSettings">
              <X class="size-4" />
            </button>
          </div>

          <!-- Settings list -->
          <div class="flex-1 overflow-y-auto px-5 py-4">
            <div v-if="loading" class="flex items-center justify-center py-12">
              <span class="text-sm text-white/40">Loading settings...</span>
            </div>

            <div v-else class="flex flex-col gap-1">
              <div
                v-for="setting in settingsByCategory[activeCategory]"
                :key="setting.id"
                class="flex items-center justify-between py-3 border-b border-[#2a2a2a] last:border-0"
              >
                <!-- Label + description -->
                <div class="flex-1 min-w-0 pr-4">
                  <div class="text-[13px] text-white/80">{{ setting.label }}</div>
                  <div v-if="setting.description" class="text-[11px] text-white/35 mt-0.5">{{ setting.description }}</div>
                </div>

                <!-- Toggle -->
                <button
                  v-if="setting.type === 'toggle'"
                  class="relative w-9 h-5 rounded-full transition-colors cursor-pointer shrink-0"
                  :class="getSettingValue(setting.id, false) ? 'bg-blue-500' : 'bg-[#3a3a3a]'"
                  @click="saveSetting(setting.id, !getSettingValue(setting.id, false))"
                >
                  <div
                    class="absolute top-0.5 size-4 rounded-full bg-white shadow transition-transform"
                    :class="getSettingValue(setting.id, false) ? 'translate-x-[18px]' : 'translate-x-0.5'"
                  />
                </button>

                <!-- Select -->
                <div v-else-if="setting.type === 'select'" class="relative shrink-0">
                  <select
                    class="appearance-none bg-[#2a2a2a] border border-[#3a3a3a] rounded-lg px-3 py-1.5 pr-7 text-xs text-white/80 cursor-pointer focus:outline-none focus:border-white/30 min-w-[120px]"
                    :value="getSettingValue(setting.id, setting.options?.[0]?.value)"
                    @change="handleSelectChange(setting, ($event.target as HTMLSelectElement).value)"
                  >
                    <option
                      v-for="opt in setting.options"
                      :key="String(opt.value)"
                      :value="opt.value"
                      class="bg-[#2a2a2a]"
                    >
                      {{ opt.label }}
                    </option>
                  </select>
                  <ChevronDown class="absolute right-2 top-1/2 -translate-y-1/2 size-3 text-white/40 pointer-events-none" />
                </div>

                <!-- Number -->
                <div v-else-if="setting.type === 'number'" class="shrink-0">
                  <input
                    type="number"
                    class="w-20 bg-[#2a2a2a] border border-[#3a3a3a] rounded-lg px-3 py-1.5 text-xs text-white/80 text-center focus:outline-none focus:border-white/30 [&::-webkit-inner-spin-button]:appearance-none"
                    :value="getSettingValue(setting.id, setting.min ?? 0)"
                    :min="setting.min"
                    :max="setting.max"
                    :step="setting.step ?? 1"
                    @change="saveSetting(setting.id, Number(($event.target as HTMLInputElement).value))"
                  />
                </div>

                <!-- Slider -->
                <div v-else-if="setting.type === 'slider'" class="flex items-center gap-2 shrink-0">
                  <input
                    type="range"
                    class="w-24 h-1 accent-blue-500 cursor-pointer"
                    :value="getSettingValue(setting.id, setting.min ?? 0)"
                    :min="setting.min"
                    :max="setting.max"
                    :step="setting.step ?? 0.1"
                    @input="saveSetting(setting.id, Number(($event.target as HTMLInputElement).value))"
                  />
                  <span class="text-[11px] text-white/50 w-8 text-right tabular-nums">
                    {{ Number(getSettingValue(setting.id, setting.min ?? 0)).toFixed(1) }}
                  </span>
                </div>

                <!-- Text -->
                <div v-else-if="setting.type === 'text'" class="shrink-0">
                  <input
                    type="password"
                    class="w-52 bg-[#2a2a2a] border border-[#3a3a3a] rounded-lg px-3 py-1.5 text-xs text-white/80 focus:outline-none focus:border-white/30 font-mono"
                    :value="getSettingValue(setting.id, '')"
                    placeholder="sk-ant-..."
                    @change="saveLocalSetting(setting.id, ($event.target as HTMLInputElement).value)"
                  />
                </div>
              </div>
            </div>
          </div>
        </div>
      </div>
    </div>
  </Transition>
</template>
