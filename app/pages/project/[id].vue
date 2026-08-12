<script setup lang="ts">
import { computed, onBeforeUnmount, onMounted, ref } from 'vue'
import { ArrowLeft } from 'lucide-vue-next'
import type { LogLine, Project, Worktree } from '#shared/types'

const api = useApi()
const route = useRoute()
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

const filter = ref<'all' | 'running' | 'agent'>('all')

const visible = computed(() => {
  if (filter.value === 'running')
    return worktrees.value.filter((w) => w.services.some((s) => s.state === 'running'))
  if (filter.value === 'agent')
    return worktrees.value.filter((w) => w.agent.state !== 'idle')
  return worktrees.value
})

const tabs = computed(() => [
  { value: 'all' as const, label: 'all', count: worktrees.value.length },
  {
    value: 'running' as const,
    label: 'running',
    count: worktrees.value.filter((w) => w.services.some((s) => s.state === 'running')).length,
  },
  {
    value: 'agent' as const,
    label: 'agent',
    count: worktrees.value.filter((w) => w.agent.state !== 'idle').length,
  },
])

const load = async () => {
  loading.value = true
  error.value = null
  try {
    const [next, list] = await Promise.all([
      api.getProject(projectId.value),
      api.listWorktrees(projectId.value),
    ])
    project.value = next
    worktrees.value = list
  } catch (cause) {
    error.value = (cause as Error).message
  } finally {
    loading.value = false
  }
}

const create = async (input: { name: string; branch: string; start: boolean }) => {
  createBusy.value = true
  createError.value = null
  try {
    await api.createWorktree(projectId.value, input)
    creating.value = false
    await load()
  } catch (cause) {
    createError.value = (cause as Error).message
  } finally {
    createBusy.value = false
  }
}

const act = async (run: () => Promise<unknown>) => {
  error.value = null
  try {
    await run()
    await load()
  } catch (cause) {
    error.value = (cause as Error).message
  }
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
    <Button variation="success" :outline="false" @click="creating = true">new worktree</Button>
  </ConsoleHeader>

  <p
    v-if="error"
    class="shrink-0 border-b border-alarm bg-surface px-4 py-2 font-sans text-xs text-alarm"
  >
    {{ error }}
  </p>

  <main class="min-h-0 flex-1 overflow-y-auto p-4">
    <NuxtLink
      to="/"
      class="mb-3 inline-flex items-center gap-1.5 font-mono text-[0.6875rem] text-faint transition-colors hover:text-ink"
    >
      <ArrowLeft :size="12" aria-hidden="true" />
      projects
    </NuxtLink>

    <div v-if="visible.length" class="grid gap-2 lg:grid-cols-2 2xl:grid-cols-3">
      <WorktreeCard
        v-for="worktree in visible"
        :key="worktree.id"
        :worktree="worktree"
        :selected="selected === worktree.id"
        @select="selected = selected === worktree.id ? null : worktree.id"
        @start="(service) => act(() => api.startService(worktree.id, service))"
        @stop="(service) => act(() => api.stopService(worktree.id, service))"
        @launch="act(() => api.launchAgent(worktree.id))"
        @remove="act(() => api.removeWorktree(projectId, worktree.id))"
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
</template>
