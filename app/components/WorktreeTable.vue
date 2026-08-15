<script setup lang="ts">
import { Lock } from 'lucide-vue-next'
import type { OverviewRow, ServiceState, ServiceStatus, Worktree } from '#shared/types'
import type { Variation } from './variation'

defineProps<{ rows: OverviewRow[] }>()

const emit = defineEmits<{ open: [row: OverviewRow] }>()

const SERVICE: Record<ServiceState, Variation> = {
  stopped: 'neutral',
  starting: 'info',
  running: 'live',
  crashed: 'error',
}

const up = (worktree: Worktree) =>
  worktree.services.filter((service) => service.state === 'running' || service.state === 'starting')
    .length

const serviceHint = (service: ServiceStatus) =>
  `${service.name} — ${service.state}${service.port ? ` on ${service.port}` : ''}`

const lockHint = (worktree: Worktree) => {
  const said = worktree.lockReason ? ` — ${worktree.lockReason}` : ''
  if (worktree.lockState === 'live') return `An agent is working here${said}`
  if (worktree.lockState === 'gone') return `Stale lock — whatever held this is gone${said}`
  return `Locked${said}`
}

const problems = (worktree: Worktree) =>
  worktree.issues.filter((issue) => issue.severity === 'error')
</script>

<template>
  <div class="ccwt-table overflow-x-auto">
    <table class="min-w-[44rem]">
      <colgroup>
        <col style="width: 20%" />
        <col style="width: 27%" />
        <col style="width: 21%" />
        <col style="width: 14%" />
        <col style="width: 18%" />
      </colgroup>

      <thead>
        <tr>
          <th scope="col">Project</th>
          <th scope="col">Worktree</th>
          <th scope="col">Branch</th>
          <th scope="col">Services</th>
          <th scope="col">Notes</th>
        </tr>
      </thead>

      <tbody>
        <tr
          v-for="row in rows"
          :key="row.worktree.id"
          tabindex="0"
          :title="row.worktree.path"
          @click="emit('open', row)"
          @keydown.enter.prevent="emit('open', row)"
          @keydown.space.prevent="emit('open', row)"
        >
          <td class="truncate whitespace-nowrap font-mono text-[0.6875rem] text-dim">
            {{ row.projectName }}
          </td>

          <td>
            <span class="flex items-center gap-1.5">
              <span class="truncate font-mono text-[0.6875rem] text-ink">{{
                row.worktree.name
              }}</span>
              <Lock
                v-if="row.worktree.locked"
                :size="10"
                class="shrink-0"
                :class="row.worktree.lockState === 'live' ? 'text-caution' : 'text-faint'"
                :aria-label="lockHint(row.worktree)"
                :title="lockHint(row.worktree)"
              />
            </span>
          </td>

          <td class="truncate whitespace-nowrap font-mono text-[0.625rem] text-faint">
            {{ row.worktree.branch ?? row.worktree.head?.slice(0, 8) ?? 'detached' }}
          </td>

          <td>
            <span
              v-if="row.worktree.services.length"
              class="flex items-center gap-1.5"
              :title="row.worktree.services.map(serviceHint).join('\n')"
            >
              <StateDot
                v-for="service in row.worktree.services"
                :key="service.name"
                :variation="SERVICE[service.state]"
                :beating="service.state === 'starting'"
              />
              <span class="ml-0.5 font-mono text-[0.625rem] tabular-nums text-faint"
                >{{ up(row.worktree) }}/{{ row.worktree.services.length }}</span
              >
            </span>
            <span v-else class="font-sans text-[0.625rem] text-faint">none</span>
          </td>

          <td>
            <span class="flex flex-wrap items-center gap-1">
              <Badge
                v-if="row.worktree.prunable"
                variation="warning"
                title="The directory is gone from disk — git still keeps the entry"
                >missing</Badge
              >
              <Badge
                v-else-if="!row.worktree.provisioned"
                variation="warning"
                title="Dependencies are not in place yet — starting a service will put them there"
                >unprovisioned</Badge
              >
              <span
                v-if="problems(row.worktree).length"
                class="flex items-center gap-1"
                :title="problems(row.worktree).map((problem) => problem.message).join('\n')"
              >
                <StateDot variation="error" />
                <span class="font-mono text-[0.625rem] tabular-nums text-alarm">{{
                  problems(row.worktree).length
                }}</span>
              </span>
            </span>
          </td>
        </tr>
      </tbody>
    </table>
  </div>
</template>
