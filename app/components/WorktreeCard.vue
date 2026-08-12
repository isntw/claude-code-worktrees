<script setup lang="ts">
import { computed } from 'vue'
import { Lock, SquareTerminal, Trash2 } from 'lucide-vue-next'
import type { ServiceStatus, Worktree } from '#shared/types'
import type { Variation } from './variation'

const props = defineProps<{ worktree: Worktree; selected?: boolean }>()

const emit = defineEmits<{
  select: []
  startAll: []
  start: [service: string]
  stop: [service: string]
  launch: []
  remove: []
}>()

const SERVICE: Record<ServiceStatus['state'], { variation: Variation; label: string }> = {
  stopped: { variation: 'neutral', label: 'stopped' },
  starting: { variation: 'info', label: 'starting' },
  running: { variation: 'live', label: 'running' },
  crashed: { variation: 'error', label: 'crashed' },
}

const errors = computed(() => props.worktree.issues.filter((i) => i.severity === 'error').length)

const extraPorts = (service: ServiceStatus) =>
  Object.entries(service.allocated ?? {})
    .filter(([, value]) => value !== service.port)
    .map(([name, value]) => `${name}=${value}`)

const allRunning = computed(() =>
  props.worktree.services.every(
    (service) => service.state === 'running' || service.state === 'starting',
  ),
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
      <button type="button" class="min-w-0 flex-1 text-left" @click="emit('select')">
        <span class="flex items-center gap-1.5">
          <span class="truncate font-mono text-xs font-semibold text-ink">{{ worktree.name }}</span>
          <Lock
            v-if="worktree.locked"
            :size="11"
            class="shrink-0 text-caution"
            :aria-label="worktree.lockReason ?? 'Locked'"
          />
        </span>
        <span class="mt-1 flex items-center gap-1.5">
          <span class="truncate font-mono text-[0.625rem] text-faint">{{
            worktree.branch ?? worktree.head?.slice(0, 8) ?? 'detached'
          }}</span>
        </span>
      </button>

      <span class="flex shrink-0 items-center gap-1.5 self-center">
        <Badge v-if="!worktree.provisioned" variation="warning" title="Dependencies are not in place yet — starting a service will put them there"
          >unprovisioned</Badge
        >
        <Badge>{{ worktree.origin }}</Badge>
        <span v-if="errors" class="flex items-center gap-1">
          <StateDot variation="error" />
          <span class="font-mono text-[0.625rem] tabular-nums text-alarm">{{ errors }}</span>
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
        <span v-else class="truncate font-mono text-[0.6875rem] text-faint">{{
          service.state === 'starting' && service.port
            ? `waiting on ${service.port}…`
            : service.port
              ? `port ${service.port}`
              : SERVICE[service.state].label
        }}</span>

        <span
          v-if="extraPorts(service).length"
          class="shrink-0 font-mono text-[0.625rem] text-faint"
          :title="extraPorts(service).join('\n')"
          >+{{ extraPorts(service).length }} port{{ extraPorts(service).length === 1 ? '' : 's' }}</span
        >

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
        variation="error"
        class="ml-auto"
        :disabled="worktree.locked || worktree.root"
        :title="
          worktree.root
            ? 'The repository root is not removable'
            : worktree.locked
              ? worktree.lockReason || 'An agent is working here'
              : 'Remove this worktree'
        "
        @click="emit('remove')"
      >
        <Trash2 :size="12" aria-hidden="true" />
      </Button>
    </footer>
  </article>
</template>
