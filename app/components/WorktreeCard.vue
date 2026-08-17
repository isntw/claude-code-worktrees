<script setup lang="ts">
import { computed } from 'vue'
import { Lock, LockOpen, Trash2 } from 'lucide-vue-next'
import type { GitStatus, PullRequest, ServiceStatus, Worktree, WorktreeOrigin } from '#shared/types'
import type { StackPart } from '../compose'
import type { Variation } from './variation'

const props = withDefaults(
  defineProps<{
    worktree: Worktree
    selected?: boolean
    parts?: Record<string, StackPart[]>
    git?: GitStatus | null
    pull?: PullRequest | null
    since?: string | null
  }>(),
  { parts: () => ({}), git: null, pull: null, since: null },
)

const portOf = (service: ServiceStatus, part: StackPart): number | null => {
  if (part.primary) return service.port
  return part.variable ? (service.extra?.[part.variable] ?? null) : null
}

const contested = (service: ServiceStatus): boolean =>
  Boolean(service.taken && service.port && !service.movable)

const emit = defineEmits<{
  select: []
  startAll: []
  stopAll: []
  start: [service: string]
  stop: [service: string]
  take: [service: string]
  lock: []
  unlock: []
  remove: []
  merge: []
}>()

const SERVICE: Record<ServiceStatus['state'], { variation: Variation; label: string }> = {
  stopped: { variation: 'neutral', label: 'stopped' },
  starting: { variation: 'info', label: 'starting' },
  running: { variation: 'success', label: 'running' },
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
  if (held.value) return `Release this lock — ${lock.value}. It deletes nothing.`
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

const finished = computed(() => !props.worktree.root && props.pull?.state === 'merged')

const finishedHint = computed(() =>
  live.value
    ? 'Its pull request is merged, and its services are still running'
    : 'Its pull request is merged',
)

const working = computed(() => held.value && !props.worktree.root)

const workingHint = computed(() => {
  const said = props.worktree.lockReason ? `\n${props.worktree.lockReason}` : ''
  return `An agent is working here.${said}\n\nThe lock only stops this being pruned by accident. Removing it here still works; releasing the lock is refused while that process is alive.`
})

const holding = computed(() => {
  if (!props.worktree.locked || props.worktree.root || held.value) return ''

  const said = props.worktree.lockReason ? ` — ${props.worktree.lockReason}` : ''

  return `Locked${said}. Nothing prunes it while that stands.`
})

const mergeable = computed(
  () => props.pull?.state === 'open' || props.pull?.state === 'draft',
)
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
            class="shrink-0 text-faint"
            :aria-label="lock"
            :title="lock"
          />
          <span
            v-if="working"
            class="shrink-0 font-sans text-[0.625rem] text-dim"
            :title="workingHint"
          >
            <StateDot variation="agent" beating class="mr-1 align-middle" />agent
          </span>
        </span>
        <span class="mt-1 flex items-center gap-1.5">
          <span class="truncate font-mono text-[0.625rem] text-faint">{{
            worktree.branch ?? worktree.head?.slice(0, 8) ?? 'detached'
          }}</span>
        </span>
      </button>

      <span class="flex shrink-0 items-center gap-1.5 self-center">
        <Badge v-if="finished" variation="merged" :title="finishedHint">finished</Badge>
        <Badge v-if="live" variation="success" title="A service here is up and answering on its port"
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
        <Badge
          v-if="worktree.root"
          variation="info"
          title="The repository root — not a worktree ccwt can lock or remove"
          >root</Badge
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

    <div v-if="git" class="flex min-h-7 items-center gap-2 border-b border-line px-3 py-1.5">
      <GitRow class="min-w-0 flex-1" :status="git" :pull="pull" :since="since" />
      <Button
        v-if="mergeable"
        size="sm"
        :disabled="pull?.state === 'draft'"
        :title="
          pull?.state === 'draft'
            ? 'Mark it ready for review on GitHub first'
            : `Merge #${pull?.number} into ${pull?.baseRef}`
        "
        @click="emit('merge')"
        >merge</Button
      >
    </div>

    <div v-if="holding" class="flex min-h-9 items-center border-b border-line px-3 py-2">
      <span class="min-w-0 flex-1 font-sans text-[0.6875rem] text-dim">{{ holding }}</span>
    </div>


    <div
      v-if="worktree.services.length > 1"
      class="flex items-center gap-2 border-b border-line px-3 py-1.5"
    >
      <span class="t-eyebrow">Services</span>
      <Button v-if="!allRunning" size="sm" class="ml-auto" @click="emit('startAll')"
        >start all</Button
      >
      <Button v-else size="sm" class="ml-auto" @click="emit('stopAll')">stop all</Button>
    </div>

    <ul v-if="worktree.services.length" class="flex flex-col">
      <li
        v-for="service in worktree.services"
        :key="service.name"
        class="border-b border-line last:border-b-0"
      >
        <div class="flex items-center gap-2 px-3 py-2">
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
          v-else-if="service.taken && service.port && service.movable"
          class="truncate font-sans text-[0.6875rem] text-dim"
          :title="`Something is answering on ${service.port}, so starting this service takes the next free port in its range and remembers it.`"
          >{{ service.port }} taken · moves on start</span
        >
        <span
          v-else-if="service.taken && service.port && service.heldBy"
          class="truncate font-sans text-[0.6875rem] text-dim"
          :title="`${service.heldBy.service} is running on ${service.port} in ${service.heldBy.same ? service.heldBy.worktree : 'another project'}, and this service is pinned to that port. Only one can hold it at a time.`"
          >{{ service.port }} held by
          <span class="font-mono">{{
            service.heldBy.same ? service.heldBy.worktree : 'another project'
          }}</span></span
        >
        <button
          v-else-if="service.taken && service.port"
          type="button"
          class="cursor-pointer truncate font-sans text-[0.6875rem] text-caution underline decoration-dotted underline-offset-[3px] transition-colors hover:text-ink"
          :title="`Port ${service.port} is answering and this service is pinned to it, so it cannot move. See what is holding it.`"
          @click="emit('take', service.name)"
          >port {{ service.port }} taken</button
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
            v-else-if="contested(service)"
            size="sm"
            :variation="service.heldBy ? 'info' : 'neutral'"
            :title="
              service.heldBy
                ? `Stop ${service.heldBy.service} where it is running and start ${service.name} here on ${service.port}`
                : `Port ${service.port} is taken and this service is pinned to it — see what is holding it`
            "
            @click="emit('take', service.name)"
            >{{ service.heldBy ? 'run here' : 'start' }}</Button
          >
          <Button
            v-else
            size="sm"
            :variation="service.state === 'crashed' ? 'error' : 'neutral'"
            @click="emit('start', service.name)"
            >start</Button
          >
        </span>
        </div>

        <ul v-if="parts[service.name]?.length" class="flex flex-col pb-1.5">
          <li
            v-for="part in parts[service.name]"
            :key="part.name"
            class="flex items-center gap-2 pr-3 pl-6 leading-5"
          >
            <StateDot outline :variation="SERVICE[service.state].variation" />
            <span class="w-16 shrink-0 truncate font-mono text-[0.625rem] text-faint">{{
              part.name
            }}</span>
            <a
              v-if="portOf(service, part)"
              :href="`http://localhost:${portOf(service, part)}`"
              target="_blank"
              rel="noreferrer"
              class="truncate font-mono text-[0.625rem] text-dim underline decoration-line-strong underline-offset-2 hover:text-ink hover:decoration-ink"
              >localhost:{{ portOf(service, part) }}</a
            >
            <span v-else class="truncate font-sans text-[0.625rem] text-faint"
              >no published port</span
            >
            <span
              v-if="part.variable"
              class="truncate font-mono text-[0.625rem] text-faint"
              :title="`ccwt exports ${part.variable} for this worktree`"
              >{{ part.variable }}</span
            >
          </li>
        </ul>
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
        :disabled="worktree.root"
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
        :disabled="worktree.root"
        :title="
          worktree.root
            ? 'The repository root is not removable'
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
