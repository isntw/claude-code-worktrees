<script setup lang="ts">
import type { Variation } from './variation'

type BadgeVariation = Variation | 'selected'

const VARIATIONS: Record<BadgeVariation, string> = {
  neutral: 'text-faint',
  info: 'text-dim',
  success: 'text-ink',
  live: 'text-live',
  warning: 'text-caution',
  error: 'text-alarm',
  selected: 'border-ink! bg-ink text-canvas',
}

withDefaults(
  defineProps<{
    variation?: BadgeVariation
    mono?: boolean
  }>(),
  { variation: 'neutral', mono: false },
)
</script>

<template>
  <span class="t-badge" :class="[VARIATIONS[variation], mono ? 'font-mono' : '']">
    <slot />
  </span>
</template>
