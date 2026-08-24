<script setup lang="ts">
import { computed, ref } from 'vue'
import { tone } from './variation'
import { useTooltip } from '../composables/useTooltip'
import type { Placement } from '../composables/useTooltip'
import type { Variation } from './variation'

export type BadgeSize = 'sm' | 'md' | 'lg'

const SIZE: Record<BadgeSize, string> = {
  sm: 'px-1 py-[0.0625rem] text-[0.5625rem]',
  md: 'px-[0.3125rem] py-[0.125rem] text-[0.625rem]',
  lg: 'px-[0.4375rem] py-[0.1875rem] text-[0.6875rem]',
}

const props = withDefaults(
  defineProps<{
    variation?: Variation
    size?: BadgeSize
    mono?: boolean
    outline?: boolean
    selected?: boolean
    tooltip?: string
    placement?: Placement
  }>(),
  {
    variation: 'neutral',
    size: 'md',
    mono: false,
    outline: true,
    selected: false,
    tooltip: undefined,
    placement: 'top',
  },
)

const root = ref<HTMLElement | null>(null)

const { id } = useTooltip(root, () => props.tooltip, { placement: () => props.placement })

const face = computed(() =>
  props.selected
    ? 'border-ink! bg-ink text-canvas'
    : props.outline
      ? 'text-[var(--tone-quiet)]'
      : 'border-[var(--tone-line)]! bg-[var(--tone)] text-canvas',
)
</script>

<template>
  <span
    ref="root"
    class="t-badge"
    :class="[tone(variation), face, SIZE[size], mono ? 'font-mono' : '']"
    :aria-describedby="tooltip ? id : undefined"
  >
    <span class="t-badge-label"><slot /></span>
  </span>
</template>
