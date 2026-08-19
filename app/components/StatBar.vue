<script setup lang="ts">
import { tone } from './variation'
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
      <dd
        class="t-numeral mt-1.5 text-[var(--tone-quiet)]"
        :class="tone(stat.variation ?? 'primary')"
      >
        {{ stat.value.toLocaleString() }}
      </dd>
      <dd v-if="stat.note" class="mt-1 truncate font-sans text-[0.625rem] text-faint">
        {{ stat.note }}
      </dd>
    </div>
  </dl>
</template>
