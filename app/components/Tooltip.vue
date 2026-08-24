<script setup lang="ts">
import { ref } from 'vue'
import { useTooltip } from '../composables/useTooltip'
import type { Placement } from '../composables/useTooltip'

defineOptions({ inheritAttrs: false })

const props = withDefaults(
  defineProps<{
    text: string
    placement?: Placement
    duration?: number
  }>(),
  { placement: 'top', duration: 650 },
)

const trigger = ref<HTMLElement | null>(null)

const { id } = useTooltip(
  trigger,
  () => props.text,
  {
    placement: () => props.placement,
    duration: () => props.duration,
  },
)
</script>

<template>
  <span ref="trigger" class="inline-flex" v-bind="$attrs" :aria-describedby="id"><slot /></span>
</template>
