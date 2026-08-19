<script setup lang="ts">
import { computed } from 'vue'
import { tone } from './variation'
import type { Variation } from './variation'

const props = withDefaults(
  defineProps<{
    variation?: Variation
    beating?: boolean
    outline?: boolean
  }>(),
  { variation: 'neutral', beating: false, outline: false },
)

const look = computed(() =>
  props.outline ? 'border border-[var(--tone-quiet)]' : 'bg-[var(--tone-quiet)]',
)
</script>

<template>
  <span
    class="inline-block size-1.5 shrink-0"
    :class="[tone(variation), look, beating ? 'pulse' : '']"
    aria-hidden="true"
  />
</template>
