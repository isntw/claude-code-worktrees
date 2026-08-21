<script setup lang="ts">
import { computed, onBeforeUnmount, onMounted, ref } from 'vue'
import type {
  Overview,
  OverviewRow,
  PortClaim,
  PullRequest,
  ServiceStatus,
  Severity,
  Worktree,
} from '#shared/types'
import type { Stat } from '../components/StatBar.vue'
import type { Tile } from '../components/TileGrid.vue'
import type { Variation } from '../components/variation'
import { NAV } from '../nav'

const api = useApi()
const router = useRouter()
const { asksHandoff } = useConfirm()

const page = NAV.find((item) => item.name === 'overview')!

const data = ref<Overview | null>(null)
const loading = ref(false)
const error = ref<string | null>(null)

const filter = ref<'all' | 'running' | 'attention'>('all')

const load = async () => {
  loading.value = true
  try {
    data.value = await api.getOverview()
    error.value = null
  } catch (cause) {
    error.value = (cause as Error).message
  } finally {
    loading.value = false
  }
}

const rows = computed(() => data.value?.rows ?? [])
const ports = computed(() => data.value?.ports ?? [])
const issues = computed(() => data.value?.issues ?? [])

const isRunning = (row: OverviewRow) =>
  row.worktree.services.some(
    (service) => service.state === 'running' || service.state === 'starting',
  )

const wantsAttention = (row: OverviewRow) =>
  row.worktree.prunable ||
  !row.worktree.provisioned ||
  row.worktree.services.some((service) => service.state === 'crashed') ||
  row.worktree.issues.some((issue) => issue.severity === 'error')

const running = computed(() => rows.value.filter(isRunning))
const attention = computed(() => rows.value.filter(wantsAttention))

const visible = computed(() => {
  if (filter.value === 'running') return running.value
  if (filter.value === 'attention') return attention.value
  return rows.value
})

const tabs = computed(() => [
  { value: 'all' as const, label: 'all', count: rows.value.length },
  { value: 'running' as const, label: 'running', count: running.value.length },
  { value: 'attention' as const, label: 'attention', count: attention.value.length },
])

const tone = (value: number, hot: Variation): Variation => (value > 0 ? hot : 'neutral')

const stats = computed<Stat[]>(() => {
  const totals = data.value?.totals
  if (!totals) return []

  return [
    {
      key: 'projects',
      label: 'Projects',
      value: totals.projects,
      variation: tone(totals.projects, 'primary'),
      hint: 'Repositories ccwt knows how to build a worktree for',
    },
    {
      key: 'worktrees',
      label: 'Worktrees',
      value: totals.worktrees,
      variation: tone(totals.worktrees, 'primary'),
      note: `${running.value.length} with something up`,
      hint: 'Every worktree of every registered repository, whoever made it',
    },
    {
      key: 'running',
      label: 'Services up',
      value: totals.running,
      variation: tone(totals.running, 'success'),
      note: totals.starting
        ? `${totals.starting} still starting · of ${totals.services}`
        : `of ${totals.services} configured`,
      hint: 'Services answering on their port right now',
    },
    {
      key: 'crashed',
      label: 'Crashed',
      value: totals.crashed,
      variation: tone(totals.crashed, 'error'),
      hint: 'Services that exited on their own after starting',
    },
    {
      key: 'ports',
      label: 'Ports allocated',
      value: totals.ports,
      variation: tone(totals.ports, 'primary'),
      hint: 'Distinct ports held across every worktree',
    },
    {
      key: 'problems',
      label: 'Problems',
      value: totals.errors,
      variation: tone(totals.errors, 'error'),
      hint: 'Errors reported by discovery, across every project',
    },
  ]
})

const tiles = computed<Tile[]>(() =>
  (data.value?.projects ?? []).map((project) => ({
    key: project.id,
    label: project.name,
    total: project.worktrees,
    errors: project.errors,
    note:
      [project.live ? `${project.live} up` : null, project.defaultBranch]
        .filter(Boolean)
        .join(' · ') || undefined,
    inert: !project.readable,
    go: () => router.push(`/project/${project.id}`),
  })),
)

const SEVERITY: Record<Severity, { variation: Variation; text: string }> = {
  info: { variation: 'info', text: 'text-dim' },
  warning: { variation: 'warning', text: 'text-caution' },
  error: { variation: 'error', text: 'text-alarm' },
}

const stamp = computed(() => {
  const at = data.value?.at
  return at ? new Date(at).toLocaleTimeString([], { hour12: false }) : null
})

const drill = (projectId: string, worktreeId: string) =>
  router.push(`/project/${projectId}?worktree=${worktreeId}`)

const open = (row: OverviewRow) => drill(row.projectId, row.worktree.id)
const pick = (claim: PortClaim) => drill(claim.projectId, claim.worktreeId)

const merging = ref<{ projectId: string; pull: PullRequest } | null>(null)

const act = async (run: () => Promise<unknown>) => {
  try {
    await run()
  } catch (cause) {
    error.value = (cause as Error).message
  }
  await load()
}

const start = (row: OverviewRow) => act(() => api.startAll(row.projectId, row.worktree.id))
const stop = (row: OverviewRow) => act(() => api.stopAll(row.projectId, row.worktree.id))

const taking = ref<{ projectId: string; worktree: Worktree; service: ServiceStatus } | null>(null)

const take = async (row: OverviewRow, name: string) => {
  const service = row.worktree.services.find((candidate) => candidate.name === name)
  if (!service || service.port === null) return

  const held = service.heldBy
  if (held && !asksHandoff(row.projectId)) {
    await act(async () => {
      const outcome = await api.freePort(service.port!, {
        pids: [],
        services: [{ worktreeId: held.worktreeId, service: held.service }],
      })
      if (!outcome.freed) throw new Error(outcome.why ?? `Port ${service.port} is still held.`)
      await api.startService(row.projectId, row.worktree.id, name)
    })
    return
  }

  taking.value = { projectId: row.projectId, worktree: row.worktree, service }
}

const took = async () => {
  taking.value = null
  await load()
}

const repairing = ref<string | null>(null)

const repair = async (row: OverviewRow) => {
  repairing.value = row.worktree.id
  error.value = null

  try {
    const next = await api.provision(row.projectId, row.worktree.id, true)
    const held = data.value?.rows
    const at = held?.findIndex((candidate) => candidate.worktree.id === next.id) ?? -1
    if (held && at >= 0) held[at] = { ...held[at]!, worktree: next }
  } catch (cause) {
    error.value = (cause as Error).message
  } finally {
    repairing.value = null
  }
}

const merge = (row: OverviewRow) => {
  if (!row.pull) return
  merging.value = { projectId: row.projectId, pull: row.pull }
}

const merged = async () => {
  merging.value = null
  await load()
}

const lock = (row: OverviewRow) => act(() => api.lockWorktree(row.projectId, row.worktree.id))
const unlock = (row: OverviewRow) => act(() => api.unlockWorktree(row.projectId, row.worktree.id))

const doomed = ref<{ projectId: string; worktree: Worktree } | null>(null)

const remove = (row: OverviewRow) => {
  doomed.value = { projectId: row.projectId, worktree: row.worktree }
}

const removed = async (kept: string | null) => {
  doomed.value = null
  error.value = kept ? `The worktree is gone, but the branch was kept — ${kept}` : null
  await load()
}

let disconnect: (() => void) | null = null
let pending: ReturnType<typeof setTimeout> | null = null

const nudge = () => {
  if (pending) return
  pending = setTimeout(() => {
    pending = null
    load()
  }, 400)
}

onMounted(async () => {
  disconnect = api.connect((message) => {
    if (message.type === 'log') return
    nudge()
  })

  await load()
})

onBeforeUnmount(() => {
  if (pending) clearTimeout(pending)
  disconnect?.()
})

const HEAD = 'flex h-10 shrink-0 items-center gap-3 border-b border-line px-3'
const PANEL = 'border border-line bg-surface'
</script>

<template>
  <ConsoleHeader :title="page.title" :blurb="page.blurb" :loading="loading">
    <p v-if="stamp" class="hidden font-mono text-[0.6875rem] text-faint lg:block">
      read at <span class="tabular-nums text-dim">{{ stamp }}</span>
    </p>
    <Button :disabled="loading" @click="load">{{ loading ? 'reading…' : 'refresh' }}</Button>
  </ConsoleHeader>

  <p
    v-if="error"
    class="shrink-0 border-b border-alarm bg-surface px-4 py-2 font-sans text-xs text-alarm"
  >
    {{ error }}
  </p>

  <main class="flex min-h-0 flex-1 flex-col gap-3 overflow-y-auto p-4">
    <StatBar :stats="stats" />

    <div v-if="data && !data.totals.projects" :class="PANEL" class="px-4 py-6">
      <p class="t-eyebrow">Nothing registered</p>
      <p class="mt-2 max-w-prose font-sans text-xs text-dim">
        This page reads across every repository ccwt knows about. Register one and its worktrees,
        their ports and their services all show up here.
      </p>
      <NuxtLink to="/" class="mt-4 inline-block">
        <Button variation="primary" :outline="false">go to projects</Button>
      </NuxtLink>
    </div>

    <template v-else>
      <section :class="PANEL" class="min-w-0">
        <header :class="HEAD">
          <p class="t-eyebrow">Worktrees</p>
          <Tabs v-model="filter" :options="tabs" label="Filter worktrees" class="ml-auto" />
        </header>

        <WorktreeTable
          v-if="visible.length"
          :rows="visible"
          @open="open"
          @start="start"
          @stop="stop"
          @take="take"
          @merge="merge"
          @lock="lock"
          @unlock="unlock"
          @remove="remove"
          :repairing="repairing"
          @repair="repair"
        />
        <p v-else class="px-3 py-4 font-sans text-[0.6875rem] text-faint">
          Nothing matches this filter.
        </p>
      </section>

      <div class="grid gap-3 xl:grid-cols-3">
        <section :class="PANEL" class="min-w-0 xl:col-span-2">
          <header :class="HEAD"><p class="t-eyebrow">Projects</p></header>
          <div class="p-3"><TileGrid dense :tiles="tiles" /></div>
        </section>

        <section :class="PANEL" class="min-w-0">
          <header :class="HEAD">
            <p class="t-eyebrow">Ports</p>
            <span class="ml-auto font-mono text-[0.625rem] tabular-nums text-faint">{{
              ports.length
            }}</span>
          </header>

          <PortList :rows="ports" @pick="pick" />
        </section>
      </div>

      <section v-if="issues.length" :class="PANEL">
        <header :class="HEAD">
          <p class="t-eyebrow">Problems</p>
          <span class="ml-auto font-mono text-[0.625rem] tabular-nums text-faint">{{
            issues.length
          }}</span>
        </header>

        <ul class="flex flex-col">
          <li
            v-for="(issue, index) in issues"
            :key="`${issue.projectId}:${issue.code}:${index}`"
            class="flex flex-col gap-1 border-b border-line px-3 py-2 last:border-b-0"
          >
            <span class="flex items-center gap-2">
              <StateDot :variation="SEVERITY[issue.severity].variation" />
              <span class="truncate font-mono text-[0.625rem] text-faint"
                >{{ issue.projectName
                }}<template v-if="issue.worktree">/{{ issue.worktree }}</template></span
              >
              <code class="ml-auto shrink-0 font-mono text-[0.625rem] text-faint">{{
                issue.code
              }}</code>
            </span>
            <p class="font-sans text-[0.6875rem]" :class="SEVERITY[issue.severity].text">
              {{ issue.message }}
              <span v-if="issue.hint" class="text-faint"> — {{ issue.hint }}</span>
            </p>
          </li>
        </ul>
      </section>
    </template>
  </main>

  <MergeModal
    v-if="merging"
    :project-id="merging.projectId"
    :pull="merging.pull"
    @close="merging = null"
    @merged="merged"
  />

  <PortModal
    v-if="taking"
    :project-id="taking.projectId"
    :worktree="taking.worktree"
    :service="taking.service"
    @close="taking = null"
    @done="took"
  />

  <RemoveModal
    v-if="doomed"
    :project-id="doomed.projectId"
    :worktree="doomed.worktree"
    @close="doomed = null"
    @removed="removed"
  />
</template>
