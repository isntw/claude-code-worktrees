<script setup lang="ts">
import { computed, onBeforeUnmount, onMounted, ref } from 'vue'
import type {
  Overview,
  OverviewIssue,
  OverviewProject,
  OverviewRow,
  PullRequest,
  ServiceStatus,
  Worktree,
} from '#shared/types'
import { routeKeys } from '#shared/route-keys'
import type { Stat } from '../components/StatBar.vue'
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

const projectKeys = computed(() => routeKeys(data.value?.projects ?? []))

const worktreeKeys = computed(() => {
  const grouped = new Map<string, Worktree[]>()
  for (const row of data.value?.rows ?? []) {
    const held = grouped.get(row.projectId) ?? []
    held.push(row.worktree)
    grouped.set(row.projectId, held)
  }

  const keys = new Map<string, string>()
  for (const held of grouped.values()) {
    for (const [id, key] of routeKeys(held)) keys.set(id, key)
  }

  return keys
})

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

interface Group {
  project: OverviewProject
  rows: OverviewRow[]
  issues: OverviewIssue[]
}

const groups = computed<Group[]>(() =>
  (data.value?.projects ?? [])
    .map((project) => ({
      project,
      rows: visible.value.filter((row) => row.projectId === project.id),
      issues: issues.value.filter((issue) => issue.projectId === project.id),
    }))
    .filter(
      (group) =>
        group.rows.length > 0 ||
        filter.value === 'all' ||
        (filter.value === 'attention' && group.project.errors > 0),
    ),
)

const nothing = (group: Group) => {
  if (filter.value === 'running') return 'Nothing here is running.'
  if (filter.value === 'attention') return 'Nothing here needs attention.'
  if (!group.project.readable) return 'Its worktrees could not be read.'
  return 'No worktrees yet.'
}

const COLLAPSED = 'ccwt.overview.collapsed'

const collapsed = ref<string[]>([])

const shows = (id: string) => !collapsed.value.includes(id)

const reveal = (id: string, open: boolean) => {
  collapsed.value = open ? collapsed.value.filter((held) => held !== id) : [...collapsed.value, id]
  localStorage.setItem(COLLAPSED, JSON.stringify(collapsed.value))
}

const enter = (project: OverviewProject) =>
  router.push(`/project/${projectKeys.value.get(project.id) ?? project.id}`)

const stamp = computed(() => {
  const at = data.value?.at
  return at ? new Date(at).toLocaleTimeString([], { hour12: false }) : null
})

const drill = (projectId: string, worktreeId: string) =>
  router.push({
    path: `/project/${projectKeys.value.get(projectId) ?? projectId}`,
    query: { worktree: worktreeKeys.value.get(worktreeId) ?? worktreeId },
  })

const open = (row: OverviewRow) => drill(row.projectId, row.worktree.id)

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

const removed = async (notice: string | null) => {
  doomed.value = null
  error.value = notice
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
  try {
    const stored: unknown = JSON.parse(localStorage.getItem(COLLAPSED) ?? '[]')
    if (Array.isArray(stored))
      collapsed.value = stored.filter((id): id is string => typeof id === 'string')
  } catch {
    collapsed.value = []
  }

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

const PANEL = 'border border-line bg-surface'
const SECTION = 'flex h-8 items-center gap-2 border-b border-line px-3'
const COUNT = 'ml-auto font-mono text-[0.625rem] tabular-nums text-faint'
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
      <div class="flex h-6 shrink-0 items-center gap-3">
        <p class="t-eyebrow">Projects</p>
        <span class="font-mono text-[0.625rem] tabular-nums text-faint"
          >{{ groups.length }} of {{ data?.totals.projects ?? 0 }}</span
        >
        <Tabs v-model="filter" :options="tabs" label="Filter worktrees" class="ml-auto" />
      </div>

      <ProjectPanel
        v-for="group in groups"
        :key="group.project.id"
        :project="group.project"
        :open="shows(group.project.id)"
        @update:open="reveal(group.project.id, $event)"
        @go="enter(group.project)"
      >
        <WorktreeTable
          v-if="group.rows.length"
          :rows="group.rows"
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
        <p v-else class="px-3 py-3 font-sans text-[0.6875rem] text-faint">{{ nothing(group) }}</p>

        <div v-if="group.issues.length" class="border-t border-line">
          <header :class="SECTION">
            <p class="t-eyebrow">Problems</p>
            <span :class="COUNT">{{ group.issues.length }}</span>
          </header>
          <IssueList :issues="group.issues" />
        </div>
      </ProjectPanel>

      <p
        v-if="!groups.length"
        :class="PANEL"
        class="px-3 py-4 font-sans text-[0.6875rem] text-faint"
      >
        Nothing matches this filter.
      </p>
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
