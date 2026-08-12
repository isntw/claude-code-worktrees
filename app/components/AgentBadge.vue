<script setup lang="ts">
import { computed } from 'vue'
import type { AgentStatus } from '#shared/types'
import type { Variation } from './variation'

const props = defineProps<{ status: AgentStatus }>()

const FACE: Record<AgentStatus['state'], { label: string; variation: Variation; beating: boolean }> =
  {
    idle: { label: 'no agent', variation: 'neutral', beating: false },
    running: { label: 'working', variation: 'live', beating: true },
    waiting: { label: 'waiting for you', variation: 'warning', beating: false },
    done: { label: 'done', variation: 'success', beating: false },
  }

const face = computed(() => FACE[props.status.state])
</script>

<template>
  <span class="inline-flex items-center gap-1.5">
    <StateDot :variation="face.variation" :beating="face.beating" />
    <Badge :variation="face.variation">{{ face.label }}</Badge>
    <span
      v-if="status.subagents > 0"
      class="font-mono text-[0.625rem] tabular-nums text-faint"
      :title="`${status.subagents} subagent${status.subagents === 1 ? '' : 's'}`"
      >+{{ status.subagents }}</span
    >
  </span>
</template>
