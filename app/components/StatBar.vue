<script setup lang="ts">
import type { Variation } from './variation'

export interface Stat {
  key: string
  label: string
  value: number
  variation?: Variation
  note?: string
  hint?: string
}

defineProps<{ stats: Stat[] }>()

const TONE: Record<Variation, string> = {
  neutral: 'text-faint',
  info: 'text-dim',
  success: 'text-ink',
  live: 'text-live',
  warning: 'text-caution',
  error: 'text-alarm',
}
</script>

<template>
  <dl class="flex flex-wrap gap-px border border-line bg-line">
    <div
      v-for="stat in stats"
      :key="stat.key"
      class="min-w-0 flex-1 basis-32 bg-surface px-3 py-2.5"
      :title="stat.hint"
    >
      <dt class="t-eyebrow truncate">{{ stat.label }}</dt>
      <dd class="t-numeral mt-1.5" :class="TONE[stat.variation ?? 'success']">
        {{ stat.value.toLocaleString() }}
      </dd>
      <dd v-if="stat.note" class="mt-1 truncate font-sans text-[0.625rem] text-faint">
        {{ stat.note }}
      </dd>
    </div>
  </dl>
</template>
