<script setup lang="ts">
import { tone } from './variation'
import type { Variation } from './variation'

const { variation = 'neutral', hint } = defineProps<{
  variation?: Variation
  hint?: string
}>()
</script>

<template>
  <div
    class="border border-[var(--tone-line)] px-3 py-2 text-[var(--tone)]"
    :class="tone(variation)"
  >
    <p class="max-w-prose font-sans text-[0.6875rem]"><slot /></p>
    <p v-if="hint || $slots.hint" class="mt-1 max-w-prose font-sans text-[0.6875rem] text-faint">
      <slot name="hint">{{ hint }}</slot>
    </p>
  </div>
</template>
