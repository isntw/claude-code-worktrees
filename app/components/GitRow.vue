<script setup lang="ts">
import { computed } from 'vue'
import type { GitStatus, PullRequest, PullState } from '#shared/types'
import type { Variation } from './variation'

const props = withDefaults(
  defineProps<{
    status: GitStatus
    pull?: PullRequest | null
    since?: string | null
  }>(),
  { pull: null, since: null },
)

const PULL: Record<PullState, { label: string; variation: Variation; hint: string }> = {
  open: { label: 'open', variation: 'live', hint: 'Its pull request is open' },
  draft: { label: 'draft', variation: 'warning', hint: 'Its pull request is still a draft' },
  merged: { label: 'merged', variation: 'success', hint: 'Its pull request was merged' },
  closed: {
    label: 'closed',
    variation: 'neutral',
    hint: 'Its pull request was closed without merging',
  },
}

const dirty = computed(
  () => props.status.staged + props.status.unstaged + props.status.untracked,
)

const face = computed(() => (props.pull ? PULL[props.pull.state] : null))

const tracking = computed(
  () =>
    `${props.status.ahead} ahead of and ${props.status.behind} behind ${props.status.upstream}, as of your last fetch — ccwt does not fetch`,
)

const changes = computed(() =>
  [
    `${props.status.staged} staged`,
    `${props.status.unstaged} unstaged`,
    `${props.status.untracked} untracked`,
  ].join(', '),
)

const stale = computed(() => {
  if (!props.since) return false
  return Date.now() - new Date(props.since).getTime() > 300_000
})

const asOf = computed(() =>
  props.since ? `Read from GitHub at ${new Date(props.since).toLocaleTimeString()}` : '',
)
</script>

<template>
  <div class="flex items-center gap-2">
    <span
      v-if="!status.upstream"
      class="shrink-0 font-sans text-[0.6875rem] text-caution"
      :title="`No upstream is set and there is no origin/${status.branch} here, so this work has not been pushed under this name. ccwt does not fetch, so a branch pushed from elsewhere shows this until you fetch.`"
      >not pushed</span
    >
    <span
      v-else-if="status.ahead || status.behind"
      class="shrink-0 font-mono text-[0.6875rem] tabular-nums"
      :class="status.behind ? 'text-caution' : 'text-dim'"
      :title="tracking"
      >+{{ status.ahead }} −{{ status.behind }}</span
    >
    <span
      v-else
      class="shrink-0 font-sans text-[0.6875rem] text-faint"
      :title="`Level with ${status.upstream}, as of your last fetch`"
      >in sync</span
    >

    <span
      v-if="status.conflicted"
      class="truncate font-sans text-[0.6875rem] text-alarm"
      :title="`${status.conflicted} path${status.conflicted === 1 ? '' : 's'} in conflict`"
      >{{ status.conflicted }} conflicted</span
    >
    <span
      v-else-if="dirty"
      class="truncate font-sans text-[0.6875rem] text-caution"
      :title="changes"
      >{{ dirty }} uncommitted</span
    >
    <span v-else class="truncate font-sans text-[0.6875rem] text-faint" title="Nothing to commit"
      >clean</span
    >

    <span class="ml-auto flex shrink-0 items-center gap-1.5">
      <a
        v-if="pull && face"
        :href="pull.url"
        target="_blank"
        rel="noreferrer"
        class="flex items-center gap-1"
        :class="stale ? 'opacity-60' : ''"
        :title="`${pull.title} — ${face.hint}${asOf ? `. ${asOf}` : ''}`"
      >
        <span class="font-mono text-[0.625rem] tabular-nums text-faint">#{{ pull.number }}</span>
        <Badge :variation="face.variation" size="lg">{{ face.label }}</Badge>
      </a>
    </span>
  </div>
</template>
