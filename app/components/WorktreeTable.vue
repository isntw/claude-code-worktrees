<script setup lang="ts">
import { Lock, LockOpen, Trash2 } from 'lucide-vue-next'
import type { OverviewRow, ServiceState, ServiceStatus, Worktree } from '#shared/types'
import { PULL } from './pull'
import type { Variation } from './variation'

defineProps<{ rows: OverviewRow[] }>()

const emit = defineEmits<{
  open: [row: OverviewRow]
  start: [row: OverviewRow]
  stop: [row: OverviewRow]
  merge: [row: OverviewRow]
  lock: [row: OverviewRow]
  unlock: [row: OverviewRow]
  remove: [row: OverviewRow]
}>()

const lockAction = (worktree: Worktree) => {
  if (worktree.root) return 'The repository root cannot be locked'
  if (!worktree.locked) return 'Lock this worktree so nothing removes or prunes it'
  if (worktree.lockState === 'live') return lockHint(worktree)
  return 'Release this lock'
}

const removeAction = (worktree: Worktree) => {
  if (worktree.root) return 'The repository root is not removable'
  if (worktree.locked) return lockHint(worktree)
  if (worktree.prunable) return 'Drop the entry git still keeps — the directory is already gone'
  return 'Remove this worktree'
}

const anyLive = (worktree: Worktree) =>
  worktree.services.some((service) => service.state === 'running' || service.state === 'starting')

const mergeable = (row: OverviewRow) =>
  row.pull?.state === 'open' || row.pull?.state === 'draft'

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
    <table class="min-w-[62rem]">
      <colgroup>
        <col style="width: 13%" />
        <col style="width: 17%" />
        <col style="width: 19%" />
        <col style="width: 13%" />
        <col style="width: 11%" />
        <col style="width: 13%" />
        <col style="width: 14%" />
      </colgroup>

      <thead>
        <tr>
          <th scope="col">Project</th>
          <th scope="col">Worktree</th>
          <th scope="col">Branch</th>
          <th scope="col">Pull request</th>
          <th scope="col">Services</th>
          <th scope="col">Notes</th>
          <th scope="col" class="text-right!">Actions</th>
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
            <a
              v-if="row.pull"
              :href="row.pull.url"
              target="_blank"
              rel="noreferrer"
              class="flex items-center gap-1.5"
              :title="`${row.pull.title} — ${PULL[row.pull.state].hint}`"
              @click.stop
            >
              <span class="shrink-0 font-mono text-[0.625rem] tabular-nums text-faint"
                >#{{ row.pull.number }}</span
              >
              <Badge :variation="PULL[row.pull.state].variation">{{
                PULL[row.pull.state].label
              }}</Badge>
            </a>
            <span v-else class="font-sans text-[0.625rem] text-faint">—</span>
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

          <td>
            <span class="flex items-center justify-end gap-1">
              <Button
                v-if="row.worktree.services.length && anyLive(row.worktree)"
                size="sm"
                :title="`Stop every service in ${row.worktree.name}`"
                @click.stop="emit('stop', row)"
                >stop</Button
              >
              <Button
                v-else-if="row.worktree.services.length"
                size="sm"
                :title="`Start every service in ${row.worktree.name}`"
                @click.stop="emit('start', row)"
                >start</Button
              >
              <Button
                v-if="mergeable(row)"
                size="sm"
                :disabled="row.pull?.state === 'draft'"
                :title="
                  row.pull?.state === 'draft'
                    ? 'Mark it ready for review on GitHub first'
                    : `Merge #${row.pull?.number} into ${row.pull?.baseRef}`
                "
                @click.stop="emit('merge', row)"
                >merge</Button
              >
              <Button
                size="sm"
                icon
                :disabled="row.worktree.root || row.worktree.lockState === 'live'"
                :title="lockAction(row.worktree)"
                @click.stop="row.worktree.locked ? emit('unlock', row) : emit('lock', row)"
              >
                <LockOpen v-if="row.worktree.locked" :size="11" aria-hidden="true" />
                <Lock v-else :size="11" aria-hidden="true" />
              </Button>
              <Button
                size="sm"
                icon
                variation="error"
                :disabled="row.worktree.locked || row.worktree.root"
                :title="removeAction(row.worktree)"
                @click.stop="emit('remove', row)"
              >
                <Trash2 :size="11" aria-hidden="true" />
              </Button>
            </span>
          </td>
        </tr>
      </tbody>
    </table>
  </div>
</template>
