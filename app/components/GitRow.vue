<script setup lang="ts">
import { computed } from 'vue'
import type { GitStatus, PullRequest } from '#shared/types'
import { PULL } from './pull'

const props = withDefaults(
  defineProps<{
    status: GitStatus
    pull?: PullRequest | null
    since?: string | null
  }>(),
  { pull: null, since: null },
)

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
    <Tooltip
      v-if="!status.upstream"
      class="shrink-0 font-sans text-[0.6875rem] text-faint"
      :text="`No upstream is set and there is no origin/${status.branch} here, so this work has not been pushed under this name. ccwt does not fetch, so a branch pushed from elsewhere shows this until you fetch.`"
      >unpushed</Tooltip
    >
    <span
      v-else-if="status.ahead || status.behind"
      class="shrink-0 font-mono text-[0.6875rem] tabular-nums"
      :title="tracking"
      ><span :class="status.ahead ? 'text-dim' : 'text-faint'">↑{{ status.ahead }}</span> <span :class="status.behind ? 'text-caution' : 'text-faint'">↓{{ status.behind }}</span></span
    >
    <span
      v-else
      class="shrink-0 font-sans text-[0.6875rem] text-faint"
      :title="`Level with ${status.upstream}, as of your last fetch`"
      >in sync</span
    >

    <span
      v-if="status.conflicted"
      class="shrink-0 text-[0.6875rem] text-alarm"
      :title="`${status.conflicted} path${status.conflicted === 1 ? '' : 's'} in conflict`"
      ><span class="font-mono tabular-nums">{{ status.conflicted }}</span
      ><span class="font-sans"> conflicted</span></span
    >
    <span v-else-if="dirty" class="shrink-0 text-[0.6875rem]" :title="changes"
      ><span class="font-mono tabular-nums text-ink">{{ dirty }}</span
      ><span class="font-sans text-faint"> changed</span></span
    >
    <span v-else class="shrink-0 font-sans text-[0.6875rem] text-faint" title="Nothing to commit"
      >clean</span
    >

    <template v-if="pull && face">
      <span class="ml-auto h-3 w-px shrink-0 bg-line" aria-hidden="true" />
      <a
        :href="pull.url"
        target="_blank"
        rel="noreferrer"
        class="flex shrink-0 items-center gap-1.5"
        :class="stale ? 'opacity-60' : ''"
        :title="`${pull.title} — ${face.hint}${asOf ? `. ${asOf}` : ''}`"
      >
        <span class="font-mono text-[0.625rem] tabular-nums text-faint">#{{ pull.number }}</span>
        <Badge :variation="face.variation" :outline="false">{{ face.label }}</Badge>
      </a>
    </template>
  </div>
</template>
