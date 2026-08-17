<script setup lang="ts">
import { computed } from 'vue'
import type { Variation } from './variation'

const props = withDefaults(
  defineProps<{
    variation?: Variation
    beating?: boolean
    outline?: boolean
  }>(),
  { variation: 'neutral', beating: false, outline: false },
)

const FILL: Record<Variation, string> = {
  neutral: 'bg-faint',
  info: 'bg-info',
  success: 'bg-ink',
  live: 'bg-live',
  agent: 'bg-agent',
  warning: 'bg-caution',
  error: 'bg-alarm',
}

const EDGE: Record<Variation, string> = {
  neutral: 'border-faint',
  info: 'border-info',
  success: 'border-ink',
  live: 'border-live',
  agent: 'border-agent',
  warning: 'border-caution',
  error: 'border-alarm',
}

const look = computed(() =>
  props.outline ? `border ${EDGE[props.variation]}` : FILL[props.variation],
)
</script>

<template>
  <span
    class="inline-block size-1.5 shrink-0"
    :class="[look, beating ? 'pulse' : '']"
    aria-hidden="true"
  />
</template>
