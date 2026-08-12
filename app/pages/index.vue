<script setup lang="ts">
import { computed, onMounted, ref } from 'vue'
import type { Project } from '#shared/types'
import type { Tile } from '../components/TileGrid.vue'
import { NAV } from '../nav'

const api = useApi()
const router = useRouter()

const page = NAV.find((item) => item.name === 'index')!

const projects = ref<Project[]>([])
const loading = ref(false)
const error = ref<string | null>(null)

const adding = ref(false)
const rootPath = ref('')
const addBusy = ref(false)
const addError = ref<string | null>(null)

const load = async () => {
  loading.value = true
  error.value = null
  try {
    projects.value = await api.listProjects()
  } catch (cause) {
    error.value = (cause as Error).message
  } finally {
    loading.value = false
  }
}

const add = async () => {
  addBusy.value = true
  addError.value = null
  try {
    await api.addProject(rootPath.value.trim())
    adding.value = false
    rootPath.value = ''
    await load()
  } catch (cause) {
    addError.value = (cause as Error).message
  } finally {
    addBusy.value = false
  }
}

const tiles = computed<Tile[]>(() =>
  projects.value.map((project) => ({
    key: project.id,
    label: project.name,
    total: 0,
    errors: project.issues.filter((issue) => issue.severity === 'error').length,
    note: project.packageManager ?? 'package manager not detected',
    go: () => router.push(`/project/${project.id}`),
  })),
)

onMounted(load)

const FIELD =
  'h-7 w-full border border-line bg-canvas px-2 font-mono text-xs text-ink placeholder:text-faint focus:border-line-strong focus:outline-none'
</script>

<template>
  <ConsoleHeader :title="page.title" :blurb="page.blurb" :loading="loading">
    <p class="hidden font-mono text-[0.6875rem] text-faint lg:block">
      <span class="tabular-nums text-dim">{{ projects.length }}</span> projects
    </p>
    <Button :disabled="loading" @click="load">{{ loading ? 'reading…' : 'refresh' }}</Button>
    <Button variation="success" :outline="false" @click="adding = true">register project</Button>
  </ConsoleHeader>

  <p
    v-if="error"
    class="shrink-0 border-b border-alarm bg-surface px-4 py-2 font-sans text-xs text-alarm"
  >
    {{ error }}
  </p>

  <main class="min-h-0 flex-1 overflow-y-auto p-4">
    <TileGrid v-if="tiles.length" :tiles="tiles" />

    <div v-else class="border border-line bg-surface px-4 py-6">
      <p class="t-eyebrow">No projects yet</p>
      <p class="mt-2 max-w-prose font-sans text-xs text-dim">
        Register a repository root and ccwt learns its package manager and dev script, then every
        worktree you make from it gets its files, its dependencies, its own port and its own dev
        server.
      </p>
      <p class="mt-3 max-w-prose font-sans text-[0.6875rem] text-faint">
        Registration is Milestone 1. The shell, the API surface and the WebSocket are wired; the
        modules under <code class="font-mono">server/lib/</code> that run git and spawn processes are
        still stubs.
      </p>
    </div>
  </main>

  <ModalPanel v-if="adding" title="Register a project" @close="adding = false">
    <form class="flex flex-col gap-4" @submit.prevent="add">
      <label class="flex flex-col gap-1.5">
        <span class="t-eyebrow">Repository root</span>
        <input
          v-model="rootPath"
          :class="FIELD"
          placeholder="/Users/you/workspace/projects/your-repo"
          autofocus
        />
      </label>
      <p v-if="addError" class="font-sans text-[0.6875rem] text-alarm">{{ addError }}</p>
    </form>

    <template #footer>
      <Button size="sm" @click="adding = false">cancel</Button>
      <Button
        size="sm"
        variation="success"
        :outline="false"
        :disabled="!rootPath.trim() || addBusy"
        @click="add"
        >{{ addBusy ? 'reading…' : 'register' }}</Button
      >
    </template>
  </ModalPanel>
</template>
