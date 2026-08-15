<script setup lang="ts">
import { computed } from 'vue'
import type { BadgeVariation } from './variation'

export type BadgeSize = 'sm' | 'md' | 'lg'

const OUTLINE: Record<BadgeVariation, string> = {
  neutral: 'text-faint',
  info: 'text-dim',
  success: 'text-ink',
  live: 'text-live',
  merged: 'text-merged',
  warning: 'text-caution',
  error: 'text-alarm',
  selected: 'border-ink! bg-ink text-canvas',
}

const FILLED: Record<BadgeVariation, string> = {
  neutral: 'border-line-strong! bg-line-strong text-ink',
  info: 'border-dim! bg-dim text-canvas',
  success: 'border-ink! bg-ink text-canvas',
  live: 'border-live! bg-live text-canvas',
  merged: 'border-merged! bg-merged text-canvas',
  warning: 'border-caution! bg-caution text-canvas',
  error: 'border-alarm! bg-alarm text-canvas',
  selected: 'border-ink! bg-ink text-canvas',
}

const SIZE: Record<BadgeSize, string> = {
  sm: 'px-1 py-[0.0625rem] text-[0.5625rem]',
  md: 'px-[0.3125rem] py-[0.125rem] text-[0.625rem]',
  lg: 'px-[0.4375rem] py-[0.1875rem] text-[0.6875rem]',
}

const props = withDefaults(
  defineProps<{
    variation?: BadgeVariation
    size?: BadgeSize
    mono?: boolean
    outline?: boolean
  }>(),
  { variation: 'neutral', size: 'md', mono: false, outline: true },
)

const face = computed(() =>
  props.outline ? OUTLINE[props.variation] : FILLED[props.variation],
)
</script>

<template>
  <span class="t-badge" :class="[face, SIZE[size], mono ? 'font-mono' : '']">
    <span class="t-badge-label"><slot /></span>
  </span>
</template>
