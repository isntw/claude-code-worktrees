<script setup lang="ts">
import { computed } from 'vue'
import { Lock, LockOpen, SquareTerminal, Trash2 } from 'lucide-vue-next'
import type { ServiceStatus, Worktree, WorktreeOrigin } from '#shared/types'
import type { Variation } from './variation'

const props = defineProps<{ worktree: Worktree; selected?: boolean }>()

const emit = defineEmits<{
  select: []
  startAll: []
  start: [service: string]
  stop: [service: string]
  launch: []
  lock: []
  unlock: []
  remove: []
}>()

const SERVICE: Record<ServiceStatus['state'], { variation: Variation; label: string }> = {
  stopped: { variation: 'neutral', label: 'stopped' },
  starting: { variation: 'info', label: 'starting' },
  running: { variation: 'live', label: 'running' },
  crashed: { variation: 'error', label: 'crashed' },
}

const ORIGIN: Record<WorktreeOrigin, string> = {
  ccwt: 'ccwt made this one, in the project’s worktrees directory',
  manual: 'Made outside ccwt, with git worktree add',
  claude: 'Claude Code made this one, under .claude/worktrees/',
}

const problems = computed(() => props.worktree.issues.filter((i) => i.severity === 'error'))

const held = computed(() => props.worktree.lockState === 'live')

const lock = computed(() => {
  const reason = props.worktree.lockReason
  const said = reason ? ` — ${reason}` : ''

  if (props.worktree.lockState === 'live') return `An agent is working here${said}`
  if (props.worktree.lockState === 'gone') {
    return `Stale lock — whatever held this worktree is gone${said}`
  }
  return `Locked${said}`
})

const lockAction = computed(() => {
  if (props.worktree.root) return 'The repository root cannot be locked'
  if (!props.worktree.locked) return 'Lock this worktree so nothing removes or prunes it'
  if (held.value) return lock.value
  if (props.worktree.prunable) {
    return 'Release this lock — the directory is already gone, so git drops the entry and this card disappears. The branch is kept.'
  }
  return 'Release this lock'
})

const allRunning = computed(() =>
  props.worktree.services.every(
    (service) => service.state === 'running' || service.state === 'starting',
  ),
)

const live = computed(() => props.worktree.services.some((service) => service.state === 'running'))
</script>

<template>
  <article
    class="flex flex-col border transition-colors"
    :class="
      selected
        ? 'border-line-strong bg-raised'
        : 'border-line bg-surface hover:border-line-strong hover:bg-raised'
    "
  >
    <header class="flex items-start gap-2 border-b border-line px-3 py-2.5">
      <button
        type="button"
        class="min-w-0 flex-1 cursor-pointer text-left"
        :title="selected ? 'Hide these logs' : 'Show this worktree in the log pane'"
        @click="emit('select')"
      >
        <span class="flex items-center gap-1.5">
          <span class="truncate font-mono text-xs font-semibold text-ink">{{ worktree.name }}</span>
          <Lock
            v-if="worktree.locked"
            :size="11"
            class="shrink-0"
            :class="held ? 'text-caution' : 'text-faint'"
            :aria-label="lock"
            :title="lock"
          />
        </span>
        <span class="mt-1 flex items-center gap-1.5">
          <span class="truncate font-mono text-[0.625rem] text-faint">{{
            worktree.branch ?? worktree.head?.slice(0, 8) ?? 'detached'
          }}</span>
        </span>
      </button>

      <span class="flex shrink-0 items-center gap-1.5 self-center">
        <Badge v-if="live" variation="live" title="A service here is up and answering on its port"
          >running</Badge
        >
        <Badge
          v-if="worktree.prunable"
          variation="warning"
          title="The directory is gone from disk — only the lock is keeping git's entry alive. Releasing the lock drops it; the branch is kept."
          >directory missing</Badge
        >
        <Badge
          v-if="!worktree.provisioned"
          variation="warning"
          title="Dependencies are not in place yet — starting a service will put them there"
          >unprovisioned</Badge
        >
        <Badge :title="ORIGIN[worktree.origin]">{{ worktree.origin }}</Badge>
        <span
          v-if="problems.length"
          class="flex items-center gap-1"
          :title="problems.map((problem) => problem.message).join('\n')"
        >
          <StateDot variation="error" />
          <span class="font-mono text-[0.625rem] tabular-nums text-alarm">{{
            problems.length
          }}</span>
        </span>
      </span>
    </header>

    <div class="flex items-center gap-2 border-b border-line px-3 py-2">
      <AgentBadge :status="worktree.agent" />
      <Button
        size="sm"
        icon
        class="ml-auto"
        title="Launch a Claude Code session here"
        @click="emit('launch')"
      >
        <SquareTerminal :size="12" aria-hidden="true" />
      </Button>
    </div>

    <div
      v-if="worktree.services.length > 1"
      class="flex items-center gap-2 border-b border-line px-3 py-1.5"
    >
      <span class="t-eyebrow">Services</span>
      <Button size="sm" class="ml-auto" :disabled="allRunning" @click="emit('startAll')"
        >start all</Button
      >
    </div>

    <ul v-if="worktree.services.length" class="flex flex-col">
      <li
        v-for="service in worktree.services"
        :key="service.name"
        class="flex items-center gap-2 border-b border-line px-3 py-2 last:border-b-0"
      >
        <StateDot
          :variation="SERVICE[service.state].variation"
          :beating="service.state === 'starting'"
        />
        <span class="w-14 shrink-0 truncate font-mono text-[0.6875rem] text-dim">{{
          service.name
        }}</span>

        <a
          v-if="service.url"
          :href="service.url"
          target="_blank"
          rel="noreferrer"
          class="truncate font-mono text-[0.6875rem] text-ink underline decoration-line-strong underline-offset-2 hover:decoration-ink"
          >{{ service.url.replace(/^https?:\/\//, '') }}</a
        >
        <span
          v-else-if="service.reachable === false"
          class="truncate font-sans text-[0.6875rem] text-caution"
          :title="`ccwt assigned port ${service.port}, but nothing is listening there. The command probably does not take that port.`"
          >not on port {{ service.port }}</span
        >
        <span
          v-else-if="service.taken && service.port"
          class="truncate font-sans text-[0.6875rem] text-caution"
          :title="`Something ccwt did not start is already listening on port ${service.port}. Starting this service will collide with it — stop whatever holds the port first, or give the service a wider range.`"
          >port {{ service.port }} taken</span
        >
        <span v-else class="truncate font-mono text-[0.6875rem] text-faint">{{
          service.state === 'starting' && service.port
            ? `waiting on ${service.port}…`
            : service.port
              ? `port ${service.port}`
              : SERVICE[service.state].label
        }}</span>

        <span class="ml-auto flex shrink-0 gap-1">
          <Button
            v-if="service.state === 'running' || service.state === 'starting'"
            size="sm"
            @click="emit('stop', service.name)"
            >stop</Button
          >
          <Button
            v-else
            size="sm"
            :variation="service.state === 'crashed' ? 'error' : 'neutral'"
            @click="emit('start', service.name)"
            >start</Button
          >
        </span>
      </li>
    </ul>

    <p v-else class="border-b border-line px-3 py-2 font-sans text-[0.6875rem] text-faint">
      No service configured for this project.
    </p>

    <footer class="flex items-center gap-2 px-3 py-2">
      <code class="truncate font-mono text-[0.625rem] text-faint" :title="worktree.path">{{
        worktree.path
      }}</code>
      <Button
        size="sm"
        icon
        class="ml-auto"
        :disabled="worktree.root || held"
        :title="lockAction"
        @click="worktree.locked ? emit('unlock') : emit('lock')"
      >
        <LockOpen v-if="worktree.locked" :size="12" aria-hidden="true" />
        <Lock v-else :size="12" aria-hidden="true" />
      </Button>
      <Button
        size="sm"
        icon
        variation="error"
        :disabled="worktree.locked || worktree.root"
        :title="
          worktree.root
            ? 'The repository root is not removable'
            : worktree.locked
              ? lock
              : worktree.prunable
                ? 'Drop the entry git still keeps — the directory is already gone'
                : 'Remove this worktree'
        "
        @click="emit('remove')"
      >
        <Trash2 :size="12" aria-hidden="true" />
      </Button>
    </footer>
  </article>
</template>
