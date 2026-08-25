<script setup lang="ts">
import type { OverviewIssue, Severity } from '#shared/types'
import type { Variation } from './variation'

defineProps<{ issues: OverviewIssue[] }>()

const SEVERITY: Record<Severity, { variation: Variation; text: string }> = {
  info: { variation: 'info', text: 'text-dim' },
  warning: { variation: 'warning', text: 'text-caution' },
  error: { variation: 'error', text: 'text-alarm' },
}
</script>

<template>
  <ul class="flex flex-col">
    <li
      v-for="(issue, index) in issues"
      :key="`${issue.code}:${issue.worktree ?? ''}:${index}`"
      class="flex flex-col gap-1 border-b border-line px-3 py-2 last:border-b-0"
    >
      <span class="flex items-center gap-2">
        <StateDot :variation="SEVERITY[issue.severity].variation" />
        <span v-if="issue.worktree" class="truncate font-mono text-[0.625rem] text-faint">{{
          issue.worktree
        }}</span>
        <code class="ml-auto shrink-0 font-mono text-[0.625rem] text-faint">{{ issue.code }}</code>
      </span>
      <p class="font-sans text-[0.6875rem]" :class="SEVERITY[issue.severity].text">
        {{ issue.message }}
        <span v-if="issue.hint" class="text-faint"> — {{ issue.hint }}</span>
      </p>
    </li>
  </ul>
</template>
