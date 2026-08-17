<script setup lang="ts">
import type { Variation } from './variation'

withDefaults(
  defineProps<{
    variation?: Variation
    outline?: boolean
    size?: 'sm' | 'md'
    icon?: boolean
    disabled?: boolean
    type?: 'button' | 'submit'
  }>(),
  { variation: 'neutral', outline: true, size: 'md', icon: false, disabled: false, type: 'button' },
)

const OUTLINE: Record<Variation, string> = {
  neutral: 'border-line text-dim hover:border-line-strong hover:text-ink',
  info: 'border-info text-info hover:bg-info hover:text-canvas',
  success: 'border-ink text-ink hover:bg-ink hover:text-canvas',
  live: 'border-live text-live hover:bg-live hover:text-canvas',
  agent: 'border-agent text-agent hover:bg-agent hover:text-canvas',
  warning: 'border-caution text-caution hover:bg-caution hover:text-canvas',
  error: 'border-alarm text-alarm hover:bg-alarm hover:text-canvas',
}

const FILLED: Record<Variation, string> = {
  neutral:
    'border-line-strong bg-line-strong text-ink hover:border-dim hover:bg-dim hover:text-canvas',
  info: 'border-info bg-info text-canvas hover:border-ink hover:bg-ink',
  success: 'border-ink bg-ink text-canvas hover:border-dim hover:bg-dim',
  live: 'border-live bg-live text-canvas hover:border-ink hover:bg-ink',
  agent: 'border-agent bg-agent text-canvas hover:border-ink hover:bg-ink',
  warning:
    'border-caution bg-caution text-canvas hover:border-caution-strong hover:bg-caution-strong',
  error: 'border-alarm bg-alarm text-canvas hover:border-alarm-strong hover:bg-alarm-strong',
}

const SIZE = {
  sm: {
    box: 'h-6 text-[0.6875rem]',
    pad: 'px-2',
    icon: 'inline-flex items-center justify-center w-6',
  },
  md: { box: 'h-7 text-xs', pad: 'px-2.5', icon: 'inline-flex items-center justify-center w-7' },
}
</script>

<template>
  <button
    :type="type"
    :disabled="disabled"
    class="shrink-0 border font-mono transition-colors duration-100 ease-linear disabled:pointer-events-none disabled:opacity-40"
    :class="[
      SIZE[size].box,
      outline ? OUTLINE[variation] : FILLED[variation],
      icon ? SIZE[size].icon : `t-button ${SIZE[size].pad}`,
    ]"
  >
    <span v-if="icon" class="contents"><slot /></span>
    <template v-else>
      <span v-if="$slots.lead" class="contents"><slot name="lead" /></span>
      <span class="t-button-label"><slot /></span>
    </template>
  </button>
</template>
