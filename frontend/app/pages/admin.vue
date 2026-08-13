<!-- frontend/app/pages/admin.vue -->
<script setup lang="ts">
// Operator console: links + IDs for every vendor account Sailor runs on.
// Content comes from /api/admin/console, which 404s in hosted mode — this
// page is for the operator's own machine, not for hosted users.
import { ArrowLeft, ExternalLink } from 'lucide-vue-next'
import type { ConsoleSection, ConsoleCard } from '~~/server/api/admin/console.get'

const { data, error } = await useFetch<{ sections: ConsoleSection[] }>('/api/admin/console')

function chip(status: ConsoleCard['status']): { text: string; cls: string } {
  if (status === 'live') return { text: 'live', cls: 'border-emerald-400/40 text-emerald-300/90' }
  if (status === 'deciding') return { text: 'deciding', cls: 'border-amber-400/40 text-amber-300/90' }
  return { text: `stage ${status.stage}`, cls: 'border-white/15 text-white/40' }
}
</script>

<template>
  <div class="min-h-screen bg-background text-white">
    <div class="mx-auto max-w-3xl px-6 py-10">
      <NuxtLink to="/" class="mb-8 inline-flex items-center gap-1.5 text-[12px] text-white/40 transition hover:text-white/80">
        <ArrowLeft class="size-3.5" />
        Back to Sailor
      </NuxtLink>

      <h1 class="text-[20px] font-semibold tracking-tight">Operator console</h1>
      <p class="mt-1 max-w-[62ch] text-[13px] leading-relaxed text-white/55">
        Every account and surface Sailor is operated from. Green chips are live;
        stage chips are signups the roadmap will ask for later. IDs on each card
        are the ones CLIs and support forms ask for. No secrets live on this page —
        keys stay in <code class="text-white/70">.env.hosted</code> and vendor dashboards.
      </p>

      <p v-if="error" class="mt-10 text-[13px] text-white/55">
        The operator console is not available on this deployment.
      </p>

      <template v-else-if="data">
        <section v-for="section in data.sections" :key="section.title" class="mt-9">
          <h2 class="text-[11px] font-medium uppercase tracking-wide text-white/50">{{ section.title }}</h2>
          <div class="mt-3 grid grid-cols-1 gap-2.5 sm:grid-cols-2">
            <div
              v-for="card in section.cards" :key="card.name"
              class="flex flex-col gap-2 rounded-[8px] border border-white/10 bg-white/[0.04] p-4"
            >
              <div class="flex items-center gap-2">
                <span class="text-[14px] font-semibold">{{ card.name }}</span>
                <span
                  class="ml-auto rounded-full border px-2 py-px font-mono text-[9px] uppercase tracking-wider"
                  :class="chip(card.status).cls"
                >{{ chip(card.status).text }}</span>
              </div>
              <p class="text-[12.5px] leading-relaxed text-white/60">{{ card.blurb }}</p>
              <a
                v-if="card.primary" :href="card.primary.href" target="_blank" rel="noopener"
                class="inline-flex items-center gap-1.5 text-[13px] font-medium text-action transition hover:text-action/80"
              >
                {{ card.primary.label }}
                <ExternalLink class="size-3.5" />
              </a>
              <div v-if="card.links?.length" class="flex flex-wrap gap-x-4 gap-y-1">
                <a
                  v-for="link in card.links" :key="link.href" :href="link.href" target="_blank" rel="noopener"
                  class="text-[12px] text-white/45 underline decoration-dotted decoration-white/25 underline-offset-2 transition hover:text-white/80"
                >{{ link.label }}</a>
              </div>
              <div v-if="card.meta?.length" class="mt-auto border-t border-dashed border-white/10 pt-2">
                <p v-for="m in card.meta" :key="m" class="break-all font-mono text-[10.5px] leading-relaxed text-white/35">{{ m }}</p>
              </div>
            </div>
          </div>
        </section>
      </template>
    </div>
  </div>
</template>
