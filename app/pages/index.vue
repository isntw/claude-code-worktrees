<script setup lang="ts">
import { computed, onBeforeUnmount, onMounted, ref, watch } from 'vue'
import type { ProbeResult, Project } from '#shared/types'
import type { Tile } from '../components/TileGrid.vue'
import { NAV } from '../nav'

const api = useApi()
const router = useRouter()

const page = NAV.find((item) => item.name === 'index')!

const projects = ref<Project[]>([])
const counts = ref<Record<string, number>>({})
const loading = ref(false)
const error = ref<string | null>(null)

const adding = ref(false)
const rootPath = ref('')
const addBusy = ref(false)
const addError = ref<string | null>(null)
const checking = ref<ProbeResult | null>(null)
const probing = ref(false)

let timer: ReturnType<typeof setTimeout> | null = null

watch(rootPath, (value) => {
  if (timer) clearTimeout(timer)
  checking.value = null

  if (!value.trim()) {
    probing.value = false
    return
  }

  probing.value = true
  timer = setTimeout(async () => {
    try {
      checking.value = await api.probePath(value)
    } catch {
      checking.value = null
    } finally {
      probing.value = false
    }
  }, 250)
})

const blocked = computed(() => checking.value?.problem ?? null)
const ready = computed(() => Boolean(checking.value?.path) && !blocked.value)

const pick = (path: string) => {
  rootPath.value = path
}

onBeforeUnmount(() => {
  if (timer) clearTimeout(timer)
})

const load = async () => {
  loading.value = true
  error.value = null
  try {
    projects.value = await api.listProjects()

    const pairs = await Promise.all(
      projects.value.map(async (project) => {
        const list = await api.listWorktrees(project.id).catch(() => [])
        return [project.id, list.length] as const
      }),
    )
    counts.value = Object.fromEntries(pairs)
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
    const project = await api.addProject(rootPath.value.trim())
    adding.value = false
    rootPath.value = ''
    await load()
    router.push(`/project/${project.id}`)
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
    total: counts.value[project.id] ?? 0,
    errors: project.issues.filter((issue) => issue.severity === 'error').length,
    note: [project.packageManager, project.defaultBranch].filter(Boolean).join(' · ') || undefined,
    inert: project.issues.some((issue) => issue.code === 'project.missing'),
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
    <template v-if="tiles.length">
      <p class="t-eyebrow mb-2">Worktrees per project</p>
      <TileGrid :tiles="tiles" />
    </template>

    <div v-else class="border border-line bg-surface px-4 py-6">
      <p class="t-eyebrow">No projects yet</p>
      <p class="mt-2 max-w-prose font-sans text-xs text-dim">
        Register a repository root and ccwt learns its package manager and dev script, then every
        worktree you make from it gets its files, its dependencies, its own port and its own dev
        server.
      </p>
      <Button class="mt-4" variation="success" :outline="false" @click="adding = true"
        >register project</Button
      >
    </div>
  </main>

  <ModalPanel v-if="adding" title="Register a project" @close="adding = false">
    <div class="flex flex-col gap-4">
      <div class="flex flex-col gap-1.5">
        <span class="t-eyebrow">Browse</span>
        <PathBrowser @pick="pick" />
      </div>

      <form class="flex flex-col gap-1.5" @submit.prevent="add">
        <span class="t-eyebrow">Repository root</span>
        <input
          v-model="rootPath"
          :class="FIELD"
          placeholder="~/workspace/projects/your-repo"
          spellcheck="false"
          autocapitalize="off"
          autocorrect="off"
        />

        <span v-if="blocked" class="font-sans text-[0.6875rem] text-caution">{{ blocked }}</span>
        <span v-else-if="probing" class="font-sans text-[0.6875rem] text-faint">checking…</span>
        <span v-else-if="checking?.path" class="font-mono text-[0.625rem] text-dim">
          resolves to {{ checking.path }}
          <template v-if="checking.branch"> · {{ checking.branch }}</template>
        </span>
        <span v-else class="font-sans text-[0.625rem] text-faint"
          >Any path inside the repository works — ccwt resolves it to the top level.</span
        >
      </form>

      <p v-if="addError" class="font-sans text-[0.6875rem] text-alarm">{{ addError }}</p>
    </div>

    <template #footer>
      <Button size="sm" @click="adding = false">cancel</Button>
      <Button
        size="sm"
        variation="success"
        :outline="false"
        :disabled="!ready || addBusy"
        @click="add"
        >{{ addBusy ? 'reading…' : 'register' }}</Button
      >
    </template>
  </ModalPanel>
</template>
