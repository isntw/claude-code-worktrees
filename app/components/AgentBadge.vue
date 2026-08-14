<script setup lang="ts">
import { computed } from 'vue'
import type { AgentStatus } from '#shared/types'
import type { Variation } from './variation'

const props = defineProps<{ status: AgentStatus }>()

const FACE: Record<
  AgentStatus['state'],
  { label: string; variation: Variation; beating: boolean; hint: string }
> = {
  idle: {
    label: 'no agent',
    variation: 'neutral',
    beating: false,
    hint: 'No Claude Code session is open in this worktree',
  },
  running: {
    label: 'working',
    variation: 'live',
    beating: true,
    hint: 'A Claude Code agent is working here right now',
  },
  waiting: {
    label: 'waiting for you',
    variation: 'warning',
    beating: false,
    hint: 'The agent stopped and is waiting on your answer',
  },
  done: {
    label: 'done',
    variation: 'success',
    beating: false,
    hint: 'The agent finished its turn — nothing is running',
  },
}

const face = computed(() => FACE[props.status.state])
</script>

<template>
  <span class="inline-flex items-center gap-1.5" :title="face.hint">
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
