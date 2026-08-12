<script setup lang="ts">
import type { Variation } from './variation'

withDefaults(
  defineProps<{
    variation?: Variation
    beating?: boolean
  }>(),
  { variation: 'neutral', beating: false },
)

const FILL: Record<Variation, string> = {
  neutral: 'bg-faint',
  info: 'bg-dim',
  success: 'bg-ink',
  live: 'bg-live',
  warning: 'bg-caution',
  error: 'bg-alarm',
}
</script>

<template>
  <span
    class="inline-block size-1.5 shrink-0"
    :class="[FILL[variation], beating ? 'pulse' : '']"
    aria-hidden="true"
  />
</template>
