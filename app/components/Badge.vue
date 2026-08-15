<script setup lang="ts">
import type { Variation } from './variation'

type BadgeVariation = Variation | 'selected'

export type BadgeSize = 'sm' | 'md' | 'lg'

const VARIATIONS: Record<BadgeVariation, string> = {
  neutral: 'text-faint',
  info: 'text-dim',
  success: 'text-ink',
  live: 'text-live',
  warning: 'text-caution',
  error: 'text-alarm',
  selected: 'border-ink! bg-ink text-canvas',
}

const SIZE: Record<BadgeSize, string> = {
  sm: 'px-1 text-[0.5625rem]',
  md: 'px-[0.3125rem] py-[0.0625rem] text-[0.625rem]',
  lg: 'px-[0.4375rem] py-[0.125rem] text-[0.6875rem]',
}

withDefaults(
  defineProps<{
    variation?: BadgeVariation
    size?: BadgeSize
    mono?: boolean
  }>(),
  { variation: 'neutral', size: 'md', mono: false },
)
</script>

<template>
  <span class="t-badge" :class="[VARIATIONS[variation], SIZE[size], mono ? 'font-mono' : '']">
    <slot />
  </span>
</template>
