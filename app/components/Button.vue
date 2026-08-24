<script setup lang="ts">
import { ref } from 'vue'
import { tone } from './variation'
import { useTooltip } from '../composables/useTooltip'
import type { Placement } from '../composables/useTooltip'
import type { Variation } from './variation'

const props = withDefaults(
  defineProps<{
    variation?: Variation
    outline?: boolean
    size?: 'sm' | 'md'
    icon?: boolean
    disabled?: boolean
    type?: 'button' | 'submit'
    tooltip?: string
    placement?: Placement
  }>(),
  {
    variation: 'neutral',
    outline: true,
    size: 'md',
    icon: false,
    disabled: false,
    type: 'button',
    tooltip: undefined,
    placement: 'top',
  },
)

const root = ref<HTMLElement | null>(null)

const { id } = useTooltip(root, () => props.tooltip, { placement: () => props.placement })

const NEUTRAL = {
  outline: 'border-line text-dim hover:border-line-strong hover:text-ink',
  filled: 'border-line-strong bg-line-strong text-ink hover:border-dim hover:bg-dim hover:text-canvas',
}

const TONED = {
  outline:
    'border-[var(--tone-line)] text-[var(--tone)] hover:bg-[var(--tone)] hover:text-canvas',
  filled:
    'border-[var(--tone-line)] bg-[var(--tone)] text-canvas hover:border-[var(--tone-strong)] hover:bg-[var(--tone-strong)]',
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
    ref="root"
    :type="type"
    :disabled="disabled"
    :aria-describedby="tooltip ? id : undefined"
    class="shrink-0 border font-mono transition-colors duration-100 ease-linear disabled:pointer-events-none disabled:opacity-40"
    :class="[
      SIZE[size].box,
      tone(variation),
      (variation === 'neutral' ? NEUTRAL : TONED)[outline ? 'outline' : 'filled'],
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
