<script setup lang="ts">
import { computed, onBeforeUnmount, onMounted, ref } from 'vue'
import { ArrowLeft } from 'lucide-vue-next'
import type {
  Diagnostic,
  ForgeStatus,
  GitReport,
  LogLine,
  Project,
  PullRequest,
  ServiceStatus,
  Worktree,
} from '#shared/types'
import { REPAIR_HINT } from '../../../components/repair'
import type { StackPart } from '#shared/compose'
import { composeFileOf, containerFor, serviceNames } from '#shared/compose'
import { DETAIL_PAGES } from '../../../nav'

const page = DETAIL_PAGES['project-id']!

const api = useApi()
const route = useRoute()
const router = useRouter()
const { asksHandoff } = useConfirm()
const projectId = computed(() => String(route.params.id))

const project = ref<Project | null>(null)

const parts = computed(() => {
  const found: Record<string, StackPart[]> = {}
  const recipe = project.value?.recipe
  if (!recipe) return found

  for (const service of recipe.services) {
    const file = composeFileOf(service.command)
    const text = recipe.provision.write.find((entry) => entry.path === file)?.content
    if (!text) continue

    const primary =
      Object.entries(service.env ?? {}).find(([, value]) => value === '{{port}}')?.[0] ?? null

    const declared = Object.keys(service.ports ?? {})
    if (primary) declared.push(primary)

    const owner = new Map<string, string>()
    for (const candidate of declared) {
      const found = containerFor(text, candidate)
      if (found) owner.set(found, candidate)
    }

    const rows = serviceNames(text).map((name) => {
      const variable = owner.get(name) ?? null
      return { name, variable, primary: variable !== null && variable === primary }
    })

    if (rows.length) found[service.name] = rows
  }

  return found
})
const worktrees = ref<Worktree[]>([])
const git = ref<GitReport>({})
const forge = ref<ForgeStatus | null>(null)
const streams = ref<Record<string, LogLine[]>>({})
const selected = ref<string | null>(null)

const KEPT = 1000

const bucket = (rows: LogLine[]): Record<string, LogLine[]> => {
  const held: Record<string, LogLine[]> = {}
  for (const row of rows) (held[row.service] ??= []).push(row)

  return held
}

const pullFor = (worktree: Worktree) =>
  worktree.branch ? (forge.value?.pulls[worktree.branch] ?? null) : null

const notices = computed<Diagnostic[]>(() => {
  const found = [...(project.value?.issues ?? []), ...(forge.value?.issues ?? [])]
  const behind = unprovisioned.value.length

  if (behind)
    found.push({
      code: 'project.worktrees-unprovisioned',
      severity: 'warning',
      message: `${behind} ${behind === 1 ? 'worktree does' : 'worktrees do'} not match what the recipe declares`,
      hint: REPAIR_HINT,
    })

  return found
})

const loading = ref(false)
const error = ref<string | null>(null)
const creating = ref(false)
const createBusy = ref(false)
const createError = ref<string | null>(null)
const doomed = ref<Worktree | null>(null)

const merging = ref<PullRequest | null>(null)
const taking = ref<{ worktree: Worktree; service: ServiceStatus } | null>(null)

const filter = ref<'all' | 'running'>('all')

const isRunning = (worktree: Worktree) =>
  worktree.services.some((service) => service.state === 'running' || service.state === 'starting')

const running = computed(() => worktrees.value.filter(isRunning))

const visible = computed(() => (filter.value === 'running' ? running.value : worktrees.value))

const unprovisioned = computed(() =>
  worktrees.value.filter((worktree) => !worktree.root && !worktree.provisioned),
)

const tabs = computed(() => [
  { value: 'all' as const, label: 'all', count: worktrees.value.length },
  { value: 'running' as const, label: 'running', count: running.value.length },
])

const load = async () => {
  loading.value = true
  try {
    const [next, list, status] = await Promise.all([
      api.getProject(projectId.value),
      api.listWorktrees(projectId.value),
      api.getGit(projectId.value).catch(() => ({}) as GitReport),
    ])
    project.value = next
    worktrees.value = list
    git.value = status
    error.value = null
  } catch (cause) {
    error.value = (cause as Error).message
  } finally {
    loading.value = false
  }
}

const loadPulls = async (force = false) => {
  forge.value = await api.getPulls(projectId.value, force).catch(() => null)
}

const reload = async () => {
  await Promise.all([load(), loadPulls(true)])
}

const show = async (worktreeId: string) => {
  selected.value = worktreeId
  router.replace({ query: { ...route.query, worktree: worktreeId } })
  streams.value = bucket(await api.logs(projectId.value, worktreeId).catch(() => []))
}

const hide = () => {
  selected.value = null
  streams.value = {}
  const { worktree: _dropped, ...rest } = route.query
  router.replace({ query: rest })
}

const select = async (worktree: Worktree) => {
  if (selected.value === worktree.id) {
    hide()
    return
  }
  await show(worktree.id)
}

const clear = async (service: string) => {
  const target = selected.value
  if (!target) return

  await api.clearLogs(projectId.value, target, service || undefined).catch(() => undefined)

  if (service) delete streams.value[service]
  else streams.value = {}
}

const watching = async (worktree: Worktree, run: () => Promise<unknown>) => {
  if (selected.value !== worktree.id) await show(worktree.id)
  await act(run)
}

const repairing = ref<string | null>(null)
const repairingAll = ref(false)

const settle = (next: Worktree) => {
  const at = worktrees.value.findIndex((worktree) => worktree.id === next.id)
  if (at >= 0) worktrees.value[at] = next
}

const repair = async (worktree: Worktree) => {
  repairing.value = worktree.id
  error.value = null
  if (selected.value !== worktree.id) await show(worktree.id)

  try {
    settle(await api.provision(projectId.value, worktree.id, true))
  } catch (cause) {
    error.value = (cause as Error).message
  } finally {
    repairing.value = null
  }
}

const repairEvery = async () => {
  repairingAll.value = true
  error.value = null

  try {
    for (const next of await api.provisionAll(projectId.value, true)) settle(next)
  } catch (cause) {
    error.value = (cause as Error).message
  } finally {
    repairingAll.value = false
  }
}

const act = async (run: () => Promise<unknown>) => {
  error.value = null
  try {
    await run()
  } catch (cause) {
    error.value = (cause as Error).message
  }
  await load()
}

const create = async (input: { name: string; branch: string; start: boolean }) => {
  createBusy.value = true
  createError.value = null
  try {
    const made = await api.createWorktree(projectId.value, input)
    creating.value = false
    await load()
    await select(made)
  } catch (cause) {
    createError.value = (cause as Error).message
  } finally {
    createBusy.value = false
  }
}

const removed = async (kept: string | null) => {
  const target = doomed.value
  if (target && selected.value === target.id) hide()
  doomed.value = null
  error.value = kept ? `The worktree is gone, but the branch was kept — ${kept}` : null
  await load()
}

const take = async (worktree: Worktree, name: string) => {
  const service = worktree.services.find((candidate) => candidate.name === name)
  if (!service || service.port === null) return

  const held = service.heldBy
  if (held && !asksHandoff(projectId.value)) {
    await watching(worktree, async () => {
      const outcome = await api.freePort(service.port!, {
        pids: [],
        services: [{ worktreeId: held.worktreeId, service: held.service }],
      })
      if (!outcome.freed) throw new Error(outcome.why ?? `Port ${service.port} is still held.`)
      await api.startService(projectId.value, worktree.id, name)
    })
    return
  }

  taking.value = { worktree, service }
}

const took = async () => {
  const target = taking.value
  taking.value = null
  if (target && selected.value !== target.worktree.id) await show(target.worktree.id)
  await load()
}

const openMerge = (worktree: Worktree) => {
  merging.value = pullFor(worktree)
}

const merged = async () => {
  merging.value = null
  await Promise.all([load(), loadPulls()])
}

const forget = async () => {
  await api.forgetProject(projectId.value).catch(() => undefined)
  router.push('/')
}

let disconnect: (() => void) | null = null
let polling: ReturnType<typeof setInterval> | null = null

onMounted(async () => {
  disconnect = api.connect((message) => {
    if (message.type === 'log') {
      if (message.line.worktreeId === selected.value) {
        const held = (streams.value[message.line.service] ??= [])
        held.push(message.line)
        if (held.length > KEPT) held.splice(0, held.length - KEPT)
      }
      return
    }
    if (message.type === 'pulls') {
      if (message.projectId === projectId.value) forge.value = message.status
      return
    }
    load()
  })

  await load()

  loadPulls()
  polling = setInterval(loadPulls, 15_000)

  const remembered = route.query.worktree
  if (typeof remembered === 'string' && worktrees.value.some((w) => w.id === remembered)) {
    await show(remembered)
  }
})

onBeforeUnmount(() => {
  disconnect?.()
  if (polling) clearInterval(polling)
})
</script>

<template>
  <ConsoleHeader
    :title="project?.name ?? page.title"
    :blurb="page.blurb"
    :loading="loading"
  >
    <Tabs v-model="filter" :options="tabs" label="Filter worktrees" />
    <Button :disabled="loading" @click="reload">{{ loading ? 'reading…' : 'refresh' }}</Button>
    <Button
      v-if="unprovisioned.length"
      variation="warning"
      :disabled="loading || repairingAll || !project?.recipe"
      :title="REPAIR_HINT"
      @click="repairEvery"
      >{{ repairingAll ? 'repair all…' : 'repair all' }}</Button
    >
    <Button
      variation="primary"
      :outline="false"
      :disabled="!project?.recipe?.services.length"
      :title="
        project?.recipe?.services.length ? undefined : 'No dev script detected for this project'
      "
      @click="creating = true"
      >new worktree</Button
    >
  </ConsoleHeader>

  <p
    v-if="error"
    class="shrink-0 border-b border-alarm bg-surface px-4 py-2 font-sans text-xs text-alarm"
  >
    {{ error }}
  </p>

  <main class="min-h-0 flex-1 overflow-y-auto p-4">
    <div class="mb-3 flex items-center gap-3">
      <NuxtLink
        to="/"
        class="inline-flex items-center gap-1.5 font-mono text-[0.6875rem] text-faint transition-colors hover:text-ink"
      >
        <ArrowLeft :size="12" aria-hidden="true" />
        projects
      </NuxtLink>

      <code v-if="project" class="truncate font-mono text-[0.625rem] text-faint">{{
        project.rootPath
      }}</code>

      <NuxtLink :to="`/project/${projectId}/recipe`" class="ml-auto">
        <Button size="sm">recipe</Button>
      </NuxtLink>
      <Button size="sm" @click="forget">forget project</Button>
    </div>

    <SetupPanel v-if="project" :setup="project.setup" class="mb-3" />

    <Notice
      v-for="issue in notices"
      :key="issue.code"
      :variation="issue.severity"
      :hint="issue.hint"
      class="mb-2"
      >{{ issue.message }}</Notice
    >

    <div v-if="visible.length" class="grid gap-2 lg:grid-cols-2 2xl:grid-cols-3">
      <WorktreeCard
        v-for="worktree in visible"
        :key="worktree.id"
        :worktree="worktree"
        :parts="parts"
        :git="git[worktree.id] ?? null"
        :pull="pullFor(worktree)"
        :since="forge?.at ?? null"
        :selected="selected === worktree.id"
        @select="select(worktree)"
        @start-all="watching(worktree, () => api.startAll(projectId, worktree.id))"
        @stop-all="act(() => api.stopAll(projectId, worktree.id))"
        @start="
          (service) => watching(worktree, () => api.startService(projectId, worktree.id, service))
        "
        @stop="(service) => act(() => api.stopService(projectId, worktree.id, service))"
        @take="(service) => take(worktree, service)"
        @lock="act(() => api.lockWorktree(projectId, worktree.id))"
        @unlock="act(() => api.unlockWorktree(projectId, worktree.id))"
        @remove="doomed = worktree"
        :repairing="repairing === worktree.id"
        @repair="repair(worktree)"
        @merge="openMerge(worktree)"
      />
    </div>

    <div v-else class="border border-line bg-surface px-4 py-6">
      <p class="t-eyebrow">No worktrees</p>
      <p class="mt-2 max-w-prose font-sans text-xs text-dim">
        Every worktree of this repository shows up here, whoever made it — yours, ccwt's, and the
        ones Claude Code created under <code class="font-mono">.claude/worktrees/</code>.
      </p>
    </div>

    <LogViewer class="mt-4" :streams="streams" @clear="clear" />
  </main>

  <CreateWorktreeModal
    v-if="creating"
    :busy="createBusy"
    :error="createError"
    @close="creating = false"
    @create="create"
  />

  <MergeModal
    v-if="merging"
    :project-id="projectId"
    :pull="merging"
    @close="merging = null"
    @merged="merged"
  />

  <PortModal
    v-if="taking"
    :project-id="projectId"
    :worktree="taking.worktree"
    :service="taking.service"
    @close="taking = null"
    @done="took"
  />

  <RemoveModal
    v-if="doomed"
    :project-id="projectId"
    :worktree="doomed"
    :git="git[doomed.id] ?? null"
    @close="doomed = null"
    @removed="removed"
  />
</template>
