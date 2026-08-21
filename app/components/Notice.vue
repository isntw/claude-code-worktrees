<script setup lang="ts">
import { computed } from 'vue'
import { tone } from './variation'
import type { Variation } from './variation'

const { variation = 'neutral', hint } = defineProps<{
  variation?: Variation
  hint?: string
}>()

const said = computed(() =>
  (hint ?? '').split(/`([^`]+)`/).map((piece, at) => ({ text: piece, code: at % 2 === 1 })),
)
</script>

<template>
  <div
    class="border border-[var(--tone-line)] px-3 py-2 text-[var(--tone)]"
    :class="tone(variation)"
  >
    <p class="max-w-prose font-sans text-[0.6875rem]"><slot /></p>
    <p v-if="hint || $slots.hint" class="mt-1 max-w-prose font-sans text-[0.6875rem] text-faint">
      <slot name="hint"
        ><template v-for="(piece, at) in said" :key="at"
          ><code v-if="piece.code" class="font-mono whitespace-nowrap">{{ piece.text }}</code
          ><template v-else>{{ piece.text }}</template></template
        ></slot
      >
    </p>
  </div>
</template>
