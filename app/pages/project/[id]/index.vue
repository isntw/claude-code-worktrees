<script setup lang="ts">
import { computed, onBeforeUnmount, onMounted, ref } from 'vue'
import { ArrowLeft } from 'lucide-vue-next'
import type { LogLine, Project, Worktree } from '#shared/types'

const api = useApi()
const route = useRoute()
const router = useRouter()
const projectId = computed(() => String(route.params.id))

const project = ref<Project | null>(null)
const worktrees = ref<Worktree[]>([])
const lines = ref<LogLine[]>([])
const selected = ref<string | null>(null)

const loading = ref(false)
const error = ref<string | null>(null)
const creating = ref(false)
const createBusy = ref(false)
const createError = ref<string | null>(null)
const doomed = ref<Worktree | null>(null)
const removeBusy = ref(false)

const filter = ref<'all' | 'running' | 'agent'>('all')

const isRunning = (worktree: Worktree) =>
  worktree.services.some((service) => service.state === 'running' || service.state === 'starting')

const visible = computed(() => {
  if (filter.value === 'running') return worktrees.value.filter(isRunning)
  if (filter.value === 'agent') return worktrees.value.filter((w) => w.agent.state !== 'idle')
  return worktrees.value
})

const tabs = computed(() => [
  { value: 'all' as const, label: 'all', count: worktrees.value.length },
  { value: 'running' as const, label: 'running', count: worktrees.value.filter(isRunning).length },
  {
    value: 'agent' as const,
    label: 'agent',
    count: worktrees.value.filter((w) => w.agent.state !== 'idle').length,
  },
])

const load = async () => {
  loading.value = true
  try {
    const [next, list] = await Promise.all([
      api.getProject(projectId.value),
      api.listWorktrees(projectId.value),
    ])
    project.value = next
    worktrees.value = list
    error.value = null
  } catch (cause) {
    error.value = (cause as Error).message
  } finally {
    loading.value = false
  }
}

const select = async (worktree: Worktree) => {
  if (selected.value === worktree.id) {
    selected.value = null
    return
  }
  selected.value = worktree.id
  lines.value = await api.logs(projectId.value, worktree.id).catch(() => [])
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
    await api.removeWorktree(projectId.value, target.id)
    if (selected.value === target.id) selected.value = null
    doomed.value = null
    error.value = null
  } catch (cause) {
    error.value = (cause as Error).message
    doomed.value = null
  } finally {
    removeBusy.value = false
    await load()
  }
}

const forget = async () => {
  await api.forgetProject(projectId.value).catch(() => undefined)
  router.push('/')
}

let disconnect: (() => void) | null = null

onMounted(() => {
  load()
  disconnect = api.connect((message) => {
    if (message.type === 'log') {
      if (!selected.value || message.line.worktreeId === selected.value) {
        lines.value = [...lines.value.slice(-999), message.line]
      }
      return
    }
    load()
  })
})

onBeforeUnmount(() => disconnect?.())
</script>

<template>
  <ConsoleHeader
    :title="project?.name ?? 'Worktrees'"
    blurb="What exists, what is running, and which agent is in it."
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
      v-for="issue in project?.issues ?? []"
      :key="issue.code"
      class="mb-2 border px-3 py-2 font-sans text-[0.6875rem]"
      :class="
        issue.severity === 'error' ? 'border-alarm text-alarm' : 'border-caution text-caution'
      "
    >
      {{ issue.message }}
      <span v-if="issue.hint" class="text-faint"> — {{ issue.hint }}</span>
    </p>

    <div v-if="visible.length" class="grid gap-2 lg:grid-cols-2 2xl:grid-cols-3">
      <WorktreeCard
        v-for="worktree in visible"
        :key="worktree.id"
        :worktree="worktree"
        :selected="selected === worktree.id"
        @select="select(worktree)"
        @start-all="act(() => api.startAll(projectId, worktree.id))"
        @start="(service) => act(() => api.startService(projectId, worktree.id, service))"
        @stop="(service) => act(() => api.stopService(projectId, worktree.id, service))"
        @launch="act(() => api.launchAgent(projectId, worktree.id))"
        @remove="doomed = worktree"
      />
    </div>

    <div v-else class="border border-line bg-surface px-4 py-6">
      <p class="t-eyebrow">No worktrees</p>
      <p class="mt-2 max-w-prose font-sans text-xs text-dim">
        Every worktree of this repository shows up here, whoever made it — yours, ccwt's, and the
        ones Claude Code created under <code class="font-mono">.claude/worktrees/</code>.
      </p>
    </div>

    <LogViewer class="mt-4" :lines="lines" />
  </main>

  <CreateWorktreeModal
    v-if="creating"
    :busy="createBusy"
    :error="createError"
    @close="creating = false"
    @create="create"
  />

  <ModalPanel v-if="doomed" title="Remove worktree" @close="doomed = null">
    <p class="font-sans text-xs text-dim">
      This deletes <code class="font-mono text-ink">{{ doomed.path }}</code> from disk, including
      untracked files ccwt put there — <code class="font-mono">node_modules</code>, copied
      <code class="font-mono">.env</code> files, and anything else not committed.
    </p>
    <p class="mt-3 font-sans text-xs text-dim">
      The branch <code class="font-mono text-ink">{{ doomed.branch ?? 'detached' }}</code> is kept.
      Committed work is safe.
    </p>

    <template #footer>
      <Button size="sm" @click="doomed = null">cancel</Button>
      <Button
        size="sm"
        variation="error"
        :outline="false"
        :disabled="removeBusy"
        @click="confirmRemove"
        >{{ removeBusy ? 'removing…' : 'remove' }}</Button
      >
    </template>
  </ModalPanel>
</template>
