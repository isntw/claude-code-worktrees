<script setup lang="ts">
import { computed, onBeforeUnmount, onMounted, ref } from 'vue'
import { ArrowLeft } from 'lucide-vue-next'
import type {
  Diagnostic,
  ForgeSession,
  ForgeStatus,
  GitReport,
  LogLine,
  MergeMethod,
  Mergeability,
  Project,
  PullRequest,
  Severity,
  Worktree,
} from '#shared/types'
import type { StackPart } from '../../../compose'
import { composeFileOf, containerFor, serviceNames } from '../../../compose'
import { DETAIL_PAGES } from '../../../nav'

const page = DETAIL_PAGES['project-id']!

const api = useApi()
const route = useRoute()
const router = useRouter()
const projectId = computed(() => String(route.params.id))

const project = ref<Project | null>(null)

const parts = computed(() => {
  const found: Record<string, StackPart[]> = {}
  const config = project.value?.config
  if (!config) return found

  for (const service of config.services) {
    const file = composeFileOf(service.command)
    const text = config.provision.write.find((entry) => entry.path === file)?.content
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
const lines = ref<LogLine[]>([])
const selected = ref<string | null>(null)

const pullFor = (worktree: Worktree) =>
  worktree.branch ? (forge.value?.pulls[worktree.branch] ?? null) : null

const NOTICE: Record<Severity, string> = {
  error: 'border-alarm text-alarm',
  warning: 'border-caution text-caution',
  info: 'border-line text-faint',
}

const notices = computed<Diagnostic[]>(() => [
  ...(project.value?.issues ?? []),
  ...(forge.value?.issues ?? []),
])

const loading = ref(false)
const error = ref<string | null>(null)
const creating = ref(false)
const createBusy = ref(false)
const createError = ref<string | null>(null)
const doomed = ref<Worktree | null>(null)
const removeBusy = ref(false)
const removeBranch = ref(false)

const merging = ref<{ worktree: Worktree; pull: PullRequest } | null>(null)
const mergeState = ref<Mergeability | null>(null)
const mergeMethod = ref<MergeMethod>('merge')
const mergeBusy = ref(false)
const mergeError = ref<string | null>(null)
const forgeSession = ref<ForgeSession | null>(null)

const METHODS: { value: MergeMethod; label: string }[] = [
  { value: 'merge', label: 'merge' },
  { value: 'squash', label: 'squash' },
  { value: 'rebase', label: 'rebase' },
]

const blocked = computed(() => {
  const state = mergeState.value?.state
  return state === 'dirty' || state === 'blocked' || state === 'draft' || state === 'behind'
})

const filter = ref<'all' | 'running'>('all')

const isRunning = (worktree: Worktree) =>
  worktree.services.some((service) => service.state === 'running' || service.state === 'starting')

const running = computed(() => worktrees.value.filter(isRunning))

const visible = computed(() => (filter.value === 'running' ? running.value : worktrees.value))

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

const loadPulls = async () => {
  forge.value = await api.getPulls(projectId.value).catch(() => null)
}

const show = async (worktreeId: string) => {
  selected.value = worktreeId
  router.replace({ query: { ...route.query, worktree: worktreeId } })
  lines.value = await api.logs(projectId.value, worktreeId).catch(() => [])
}

const hide = () => {
  selected.value = null
  lines.value = []
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

const clear = async () => {
  const target = selected.value
  if (!target) return
  await api.clearLogs(projectId.value, target).catch(() => undefined)
  lines.value = []
}

const watching = async (worktree: Worktree, run: () => Promise<unknown>) => {
  if (selected.value !== worktree.id) await show(worktree.id)
  await act(run)
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

const confirmRemove = async () => {
  const target = doomed.value
  if (!target) return

  removeBusy.value = true
  try {
    const outcome = await api.removeWorktree(projectId.value, target.id, removeBranch.value)
    if (selected.value === target.id) hide()
    doomed.value = null
    error.value = outcome.branchIssue
      ? `The worktree is gone, but ${outcome.branch} was kept — ${outcome.branchIssue}`
      : null
  } catch (cause) {
    error.value = (cause as Error).message
    doomed.value = null
  } finally {
    removeBusy.value = false
    removeBranch.value = false
    await load()
  }
}

const openMerge = async (worktree: Worktree) => {
  const pull = pullFor(worktree)
  if (!pull) return

  merging.value = { worktree, pull }
  mergeState.value = null
  mergeError.value = null

  forgeSession.value = await api.getForgeSession().catch(() => null)
  mergeState.value = await api
    .getMergeability(projectId.value, pull.number)
    .catch((cause: Error) => {
      mergeError.value = cause.message
      return null
    })
}

const confirmMerge = async () => {
  const target = merging.value
  if (!target) return

  mergeBusy.value = true
  mergeError.value = null
  try {
    await api.mergePull(
      projectId.value,
      target.pull.number,
      mergeMethod.value,
      mergeState.value?.headSha || target.pull.headSha,
    )
    merging.value = null
    await Promise.all([load(), loadPulls()])
  } catch (cause) {
    mergeError.value = (cause as Error).message
  } finally {
    mergeBusy.value = false
  }
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
        lines.value = [...lines.value.slice(-999), message.line]
      }
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
    <Button :disabled="loading" @click="load">{{ loading ? 'reading…' : 'refresh' }}</Button>
    <Button
      variation="success"
      :outline="false"
      :disabled="!project?.config?.services.length"
      :title="
        project?.config?.services.length ? undefined : 'No dev script detected for this project'
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

      <NuxtLink :to="`/project/${projectId}/config`" class="ml-auto">
        <Button size="sm">recipe</Button>
      </NuxtLink>
      <Button size="sm" @click="forget">forget project</Button>
    </div>

    <SetupPanel v-if="project" :setup="project.setup" class="mb-3" />

    <p
      v-for="issue in notices"
      :key="issue.code"
      class="mb-2 border px-3 py-2 font-sans text-[0.6875rem]"
      :class="NOTICE[issue.severity]"
    >
      {{ issue.message }}
      <span v-if="issue.hint" class="text-faint"> — {{ issue.hint }}</span>
    </p>

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
        @lock="act(() => api.lockWorktree(projectId, worktree.id))"
        @unlock="act(() => api.unlockWorktree(projectId, worktree.id))"
        @remove="doomed = worktree"
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

    <LogViewer class="mt-4" :lines="lines" @clear="clear" />
  </main>

  <CreateWorktreeModal
    v-if="creating"
    :busy="createBusy"
    :error="createError"
    @close="creating = false"
    @create="create"
  />

  <ModalPanel
    v-if="merging"
    :title="`Merge #${merging.pull.number} into ${merging.pull.baseRef}`"
    @close="merging = null"
  >
    <p class="font-sans text-xs text-dim">
      <span class="font-mono text-ink">{{ merging.pull.title }}</span>
    </p>

    <p class="mt-3 font-sans text-xs text-dim">
      This merges on GitHub, as
      <span class="font-mono text-ink">{{ forgeSession?.login ?? 'the signed-in account' }}</span
      >. It changes the remote, not this worktree — nothing here is stopped or deleted.
    </p>

    <p v-if="!mergeState && !mergeError" class="mt-3 font-sans text-xs text-faint">
      Asking GitHub whether it can be merged…
    </p>

    <p
      v-else-if="mergeState"
      class="mt-3 font-sans text-xs"
      :class="blocked ? 'text-caution' : 'text-dim'"
    >
      {{ mergeState.reason }}
    </p>

    <div class="mt-3 flex items-center gap-2">
      <span class="t-eyebrow">Method</span>
      <Tabs v-model="mergeMethod" :options="METHODS" label="Merge method" />
    </div>

    <p class="mt-3 font-sans text-[0.6875rem] text-faint">
      ccwt merges the commit this card was drawn from
      <code class="font-mono">{{ (mergeState?.headSha || merging.pull.headSha).slice(0, 8) }}</code
      >. If the branch moved since, GitHub refuses and nothing is merged.
    </p>

    <p v-if="mergeError" class="mt-3 font-sans text-xs text-alarm">{{ mergeError }}</p>

    <template #footer>
      <Button size="sm" @click="merging = null">cancel</Button>
      <Button
        size="sm"
        :outline="false"
        :disabled="mergeBusy || blocked || !mergeState"
        @click="confirmMerge"
        >{{ mergeBusy ? 'merging…' : `${mergeMethod} and close` }}</Button
      >
    </template>
  </ModalPanel>

  <ModalPanel
    v-if="doomed"
    :title="doomed.prunable ? 'Drop stale entry' : 'Remove worktree'"
    @close="doomed = null"
  >
    <p v-if="doomed.prunable" class="font-sans text-xs text-dim">
      <code class="font-mono text-ink">{{ doomed.path }}</code> is already gone from disk. This drops
      the entry git still keeps for it. Nothing on disk changes.
    </p>
    <p v-else class="font-sans text-xs text-dim">
      This deletes <code class="font-mono text-ink">{{ doomed.path }}</code> from disk, including
      untracked files ccwt put there — <code class="font-mono">node_modules</code>, copied
      <code class="font-mono">.env</code> files, and anything else not committed.
    </p>
    <p v-if="!doomed.branch" class="mt-3 font-sans text-xs text-dim">
      This worktree is detached, so there is no branch to keep or delete.
    </p>
    <p v-else-if="!removeBranch" class="mt-3 font-sans text-xs text-dim">
      The branch <code class="font-mono text-ink">{{ doomed.branch }}</code> is kept. Committed work
      is safe.
    </p>
    <p v-else class="mt-3 font-sans text-xs text-caution">
      The branch <code class="font-mono">{{ doomed.branch }}</code> goes too, here — the one on the
      forge is untouched. It is kept anyway if it holds commits that are not merged.
    </p>

    <Checkbox v-if="doomed.branch" v-model="removeBranch" class="mt-3">
      <span class="font-sans text-xs text-dim"
        >Also delete <code class="font-mono text-ink">{{ doomed.branch }}</code></span
      >
    </Checkbox>

    <template #footer>
      <Button size="sm" @click="doomed = null">cancel</Button>
      <Button
        size="sm"
        variation="error"
        :outline="false"
        :disabled="removeBusy"
        @click="confirmRemove"
        >{{
          removeBusy ? 'working…' : doomed.prunable ? 'drop entry' : 'remove'
        }}</Button
      >
    </template>
  </ModalPanel>
</template>
