<script setup lang="ts">
import {
  LogOut, CreditCard, Settings, ExternalLink,
} from 'lucide-vue-next'

const props = defineProps<{
  open: boolean
  user: { email?: string | null, displayName?: string | null, photoURL?: string | null, uid?: string | null, providerId?: string | null } | null
  credits: number | null
}>()

const emit = defineEmits<{
  close: []
  signOut: []
  openSettings: []
  openBilling: []
  openAddCredits: []
}>()

const initials = computed(() => {
  if (props.user?.displayName) {
    return props.user.displayName
      .split(' ')
      .map((w: string) => w[0])
      .slice(0, 2)
      .join('')
      .toUpperCase()
  }
  if (props.user?.email) {
    return props.user.email[0].toUpperCase()
  }
  return '?'
})

const displayName = computed(() => props.user?.displayName || props.user?.email?.split('@')[0] || 'User')

// Google/Firebase profile images sometimes 403 on mobile (referrer policy /
// hot-link protection). Fall back to initials when the image fails to load.
const avatarFailed = ref(false)
watch(() => props.user?.photoURL, () => { avatarFailed.value = false })
const providerLabel = computed(() => {
  switch (props.user?.providerId) {
    case 'google.com': return 'Google'
    case 'github.com': return 'GitHub'
    default: return 'Email'
  }
})
</script>

<template>
  <Transition
    enter-active-class="transition-all duration-150 ease-out"
    leave-active-class="transition-all duration-100 ease-in"
    enter-from-class="opacity-0 translate-y-2 scale-95"
    leave-to-class="opacity-0 translate-y-2 scale-95"
  >
    <div v-if="open" class="fixed inset-0 z-[10000]" @click.self="emit('close')">
      <!-- Popup positioned above the avatar (bottom-left) -->
      <div class="absolute left-[78px] bottom-[16px] w-[280px] bg-[#1e1e1e] border border-[#3a3a3a] rounded-[12px] shadow-2xl overflow-hidden">
        <!-- User info header -->
        <div class="p-4 border-b border-[#2a2a2a]">
          <div class="flex items-center gap-3">
            <!-- Avatar -->
            <div class="shrink-0">
              <img
                v-if="user?.photoURL && !avatarFailed"
                :src="user.photoURL"
                :alt="displayName"
                referrerpolicy="no-referrer"
                class="size-10 rounded-full object-cover"
                @error="avatarFailed = true"
              />
              <div
                v-else
                class="size-10 rounded-full bg-[#2a2a2a] flex items-center justify-center text-sm font-medium text-white/70"
              >
                {{ initials }}
              </div>
            </div>
            <!-- Name + email -->
            <div class="min-w-0 flex-1">
              <div class="text-sm font-medium text-white truncate">{{ displayName }}</div>
              <div v-if="user?.email" class="text-xs text-white/40 truncate">{{ user.email }}</div>
            </div>
          </div>
        </div>

        <!-- Credits section -->
        <div class="px-4 py-3 border-b border-[#2a2a2a]">
          <div class="flex items-center justify-between">
            <div>
              <div class="text-[11px] text-white/40 uppercase tracking-wider mb-0.5">Credits</div>
              <div class="text-sm font-medium text-white">
                {{ credits !== null ? `${credits.toLocaleString()}` : '—' }}
              </div>
            </div>
            <button
              class="text-xs text-white/70 hover:text-white transition-colors cursor-pointer"
              @click="emit('openAddCredits'); emit('close')"
            >
              Add credits
            </button>
          </div>
        </div>

        <!-- Menu items -->
        <div class="py-1.5">
          <button
            class="flex items-center gap-2.5 w-full px-4 py-2 text-xs text-white/70 hover:bg-white/5 transition-colors cursor-pointer"
            @click="emit('openSettings'); emit('close')"
          >
            <Settings class="size-4 text-white/40" />
            Settings
          </button>
          <button
            class="flex items-center gap-2.5 w-full px-4 py-2 text-xs text-white/70 hover:bg-white/5 transition-colors cursor-pointer"
            @click="emit('openBilling')"
          >
            <CreditCard class="size-4 text-white/40" />
            Billing
            <ExternalLink class="size-3 text-white/25 ml-auto" />
          </button>
          <div class="my-1 border-t border-[#2a2a2a]" />
          <button
            class="flex items-center gap-2.5 w-full px-4 py-2 text-xs text-red-400/80 hover:bg-white/5 transition-colors cursor-pointer"
            @click="emit('signOut')"
          >
            <LogOut class="size-4" />
            Sign out
          </button>
        </div>

        <!-- Provider badge -->
        <div class="px-4 py-2 border-t border-[#2a2a2a] bg-[#171717]">
          <span class="text-[10px] text-white/25">Signed in via {{ providerLabel }}</span>
        </div>
      </div>
    </div>
  </Transition>
</template>
