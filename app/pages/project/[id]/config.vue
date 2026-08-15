<script setup lang="ts">
import { computed, onMounted, ref, watch } from 'vue'
import { ArrowLeft, Plus } from 'lucide-vue-next'
import type { CcwtConfig, ConfigView, ServiceConfig, WriteEntry } from '#shared/types'
import { changed, collapse, diffLines } from '../../../diff'
import { composeFileOf, isStack, teardownCommand } from '../../../compose'

const api = useApi()
const route = useRoute()
const projectId = computed(() => String(route.params.id))

const view = ref<ConfigView | null>(null)
const draft = ref<CcwtConfig | null>(null)
const raw = ref('')
const mode = ref<'form' | 'json'>('form')

const loading = ref(false)
const saving = ref(false)
const ignoring = ref(false)
const error = ref<string | null>(null)
const parseError = ref<string | null>(null)
const confirming = ref(false)

const serialise = (config: CcwtConfig) => `${JSON.stringify(config, null, 2)}\n`

const payload = computed(() => (mode.value === 'json' ? raw.value : draft.value ? serialise(draft.value) : ''))

const diff = computed(() => diffLines(view.value?.text ?? '', payload.value))
const dirty = computed(() => Boolean(view.value) && changed(diff.value))
const stored = computed(() => view.value?.source === 'ccwt')
const preview = computed(() => collapse(diff.value))

const load = async () => {
  loading.value = true
  error.value = null
  try {
    const next = await api.getConfig(projectId.value)
    view.value = next
    draft.value = structuredClone(next.config)
    raw.value = next.text
  } catch (cause) {
    error.value = (cause as Error).message
  } finally {
    loading.value = false
  }
}

watch(mode, (next, previous) => {
  parseError.value = null

  if (next === 'json' && previous === 'form' && draft.value) {
    raw.value = serialise(draft.value)
    return
  }

  if (next === 'form' && previous === 'json') {
    try {
      draft.value = JSON.parse(raw.value) as CcwtConfig
    } catch (cause) {
      parseError.value = (cause as Error).message
      mode.value = 'json'
    }
  }
})

const ignore = async () => {
  ignoring.value = true
  error.value = null
  try {
    view.value = await api.ignoreWorktrees(projectId.value)
  } catch (cause) {
    error.value = (cause as Error).message
  } finally {
    ignoring.value = false
  }
}

const reset = async () => {
  error.value = null
  try {
    const next = await api.resetConfig(projectId.value)
    view.value = next
    draft.value = structuredClone(next.config)
    raw.value = next.text
  } catch (cause) {
    error.value = (cause as Error).message
  }
}

const detect = async () => {
  error.value = null
  try {
    const suggested = await api.suggestConfig(projectId.value)
    draft.value = suggested.config
    raw.value = suggested.text
  } catch (cause) {
    error.value = (cause as Error).message
  }
}

const save = async () => {
  saving.value = true
  error.value = null
  try {
    const next = await api.saveConfig(projectId.value, payload.value)
    view.value = next
    draft.value = structuredClone(next.config)
    raw.value = next.text
    confirming.value = false
  } catch (cause) {
    error.value = (cause as Error).message
    confirming.value = false
  } finally {
    saving.value = false
  }
}

const updateService = (index: number, service: ServiceConfig) => {
  if (!draft.value) return
  const services = [...draft.value.services]
  services[index] = service
  draft.value = { ...draft.value, services }
}

const removeService = (index: number) => {
  if (!draft.value) return
  draft.value = {
    ...draft.value,
    services: draft.value.services.filter((_, at) => at !== index),
  }
}

const addService = () => {
  if (!draft.value) return
  draft.value = {
    ...draft.value,
    services: [
      ...draft.value.services,
      { name: 'service', cwd: '.', command: 'npm run dev -- --port {{port}}', portRange: [5200, 5299] },
    ],
  }
}

const setProvision = (key: 'copy' | 'link' | 'postCreate' | 'postRemove', value: string[]) => {
  if (!draft.value) return
  draft.value = { ...draft.value, provision: { ...draft.value.provision, [key]: value } }
}

const setWrite = (rows: WriteEntry[]) => {
  if (!draft.value) return
  draft.value = { ...draft.value, provision: { ...draft.value.provision, write: rows } }
}

onMounted(load)

const stacks = computed(() =>
  (draft.value?.services ?? [])
    .map((service, index) => ({ service, index }))
    .filter(({ service }) => isStack(service.kind, service.command)),
)

const setTeardown = (index: number, on: boolean) => {
  const service = draft.value?.services[index]
  if (!service) return
  updateService(index, {
    ...service,
    removeCommand: on ? teardownCommand(composeFileOf(service.command)) : undefined,
  })
}

const upsertWrite = (path: string, content: string) => {
  if (!draft.value || !path) return
  const rows = [...draft.value.provision.write]
  const at = rows.findIndex((entry) => entry.path === path)
  if (at === -1) rows.push({ path, content })
  else rows[at] = { path, content }
  setWrite(rows)
}

const removeWrite = (path: string) => {
  if (!draft.value) return
  setWrite(draft.value.provision.write.filter((entry) => entry.path !== path))
}


const TONE = { same: 'text-faint', add: 'text-live', remove: 'text-alarm' } as const
</script>

<template>
  <ConsoleHeader
    title="Recipe"
    blurb="How a worktree of this project gets built and run."
    :loading="loading"
  >
    <Tabs
      v-model="mode"
      :options="[
        { value: 'form', label: 'form' },
        { value: 'json', label: 'json' },
      ]"
      label="Editing mode"
    />
    <Button :disabled="loading" @click="detect">detect</Button>
    <Button
      variation="success"
      :outline="false"
      :disabled="!dirty || saving"
      @click="confirming = true"
      >{{ saving ? 'saving…' : 'save' }}</Button
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
        :to="`/project/${projectId}`"
        class="inline-flex items-center gap-1.5 font-mono text-[0.6875rem] text-faint transition-colors hover:text-ink"
      >
        <ArrowLeft :size="12" aria-hidden="true" />
        worktrees
      </NuxtLink>
      <Badge v-if="view?.source === 'detected'" variation="info">detected</Badge>
      <Badge v-else-if="view?.source === 'project'" variation="info">from the project</Badge>
      <Badge v-else-if="stored" variation="neutral">saved in ccwt</Badge>
      <code v-if="view?.path" class="truncate font-mono text-[0.625rem] text-faint">{{
        view.path
      }}</code>
      <Badge v-if="dirty" variation="warning">unsaved</Badge>
      <Button v-if="stored" size="sm" class="ml-auto" @click="reset">forget customisations</Button>
    </div>

    <div
      v-if="view?.issues.length"
      class="mb-3 border border-alarm bg-surface px-3 py-2"
    >
      <p class="t-eyebrow mb-1">The file on disk does not parse</p>
      <p v-for="issue in view.issues" :key="issue.path" class="font-sans text-[0.6875rem] text-alarm">
        {{ issue.path }} — {{ issue.message }}
      </p>
    </div>

    <div v-if="mode === 'json'" class="flex flex-col gap-2">
      <Textarea v-model="raw" :rows="26" label="Recipe JSON" />
      <p v-if="parseError" class="font-sans text-[0.6875rem] text-alarm">{{ parseError }}</p>
    </div>

    <div v-else-if="draft" class="flex flex-col gap-3">
      <Panel title="Files in each worktree" aside="before anything runs">
        <div class="grid gap-4 px-3 py-3 lg:grid-cols-2">
          <div class="flex flex-col gap-1.5">
            <span class="t-eyebrow">Copied from the root checkout</span>
            <p class="font-sans text-[0.625rem] text-faint">
              Independent copies. Right for <code class="font-mono">.env</code> files you might edit
              per worktree.
            </p>
            <ListEditor
              :model-value="draft.provision.copy"
              placeholder=".env.local"
              empty="Nothing copied."
              add-label="file"
              @update:model-value="(value) => setProvision('copy', value)"
            />
          </div>

          <div class="flex flex-col gap-1.5">
            <span class="t-eyebrow">Hardlinked from the root checkout</span>
            <p class="font-sans text-[0.625rem] text-caution">
              The same file, not a copy — editing a linked file in a worktree edits the root
              checkout too. Right for dependencies and big fixtures, wrong for anything you hand-edit.
            </p>
            <ListEditor
              :model-value="draft.provision.link"
              placeholder="vendor"
              empty="Nothing linked. node_modules is handled by the dependency strategy."
              add-label="path"
              @update:model-value="(value) => setProvision('link', value)"
            />
          </div>
        </div>
      </Panel>

      <Panel
       
        title="Run after creating"
        aside="once, before any service starts"
      >
        <div class="px-3 py-3">
          <p class="mb-1.5 font-sans text-[0.625rem] text-faint">
            Commands run once in the new worktree, after files are in place and dependencies are
            installed — a build step, a generated key, anything a service needs before it can start.
            Nothing is running yet, so this cannot reach into a container.
          </p>
          <ListEditor
            :model-value="draft.provision.postCreate"
            placeholder="php artisan key:generate"
            empty="Nothing to run."
            add-label="command"
            @update:model-value="(value) => setProvision('postCreate', value)"
          />
        </div>
      </Panel>

      <Panel title="Services" aside="when you press start">
        <div class="flex flex-col gap-2 px-3 py-3">
          <p v-if="!draft.services.length" class="font-sans text-[0.6875rem] text-faint">
            No services. Worktrees will still be created and provisioned — there is just nothing to
            run in them.
          </p>
          <ServiceEditor
            v-for="(service, index) in draft.services"
            :key="index"
            :service="service"
            :index="index"
            :writes="draft.provision.write"
            @update="updateService"
            @remove="removeService"
            @write="upsertWrite"
            @unwrite="removeWrite"
          />
          <div>
            <Button size="sm" @click="addService">
              <template #lead><Plus :size="11" aria-hidden="true" /></template>
              service
            </Button>
          </div>
        </div>
      </Panel>

      <Panel
       
        title="Run before removing"
        aside="when you delete a worktree"
      >
        <div class="px-3 py-3">
          <p class="mb-1.5 font-sans text-[0.625rem] text-faint">
            Dropping whatever the worktree made outside itself — containers, volumes, a database.
            Services are stopped first, and a failure here never blocks the removal.
          </p>

          <div v-if="stacks.length" class="mb-3 flex flex-col gap-2 border border-line p-2">
            <div v-for="row in stacks" :key="row.index" class="flex flex-col gap-0.5">
              <Checkbox
                :model-value="Boolean(row.service.removeCommand)"
                @update:model-value="(value) => setTeardown(row.index, value)"
              >
                drop <span class="font-mono">{{ row.service.name }}</span
                >'s containers and volumes
              </Checkbox>
              <code
                v-if="row.service.removeCommand"
                class="pl-5 font-mono text-[0.625rem] text-faint"
                >{{ row.service.removeCommand }}</code
              >
              <p v-else class="pl-5 font-sans text-[0.625rem] text-caution">
                Its volumes stay on disk after the worktree is gone.
              </p>
            </div>
          </div>
          <ListEditor
            :model-value="draft.provision.postRemove"
            placeholder="docker compose down -v"
            empty="Nothing to tear down."
            add-label="command"
            @update:model-value="(value) => setProvision('postRemove', value)"
          />
        </div>
      </Panel>

      <Panel title="Where worktrees live">
        <div class="px-3 py-3">
          <Input
            :model-value="draft.worktreesDir"
            placeholder=".claude/worktrees"
            label="Worktrees directory"
            @update:model-value="(value) => draft && (draft = { ...draft, worktreesDir: value })"
          />
          <p class="mt-1 font-sans text-[0.625rem] text-faint">
            Relative to the repository root. Inside the repository, worktrees sit directly in it;
            outside, each project gets its own folder so projects cannot collide.
          </p>

          <div v-if="view?.exposed" class="mt-3 flex items-center gap-2 border-t border-line pt-3">
            <p class="font-sans text-[0.6875rem] text-caution">
              Git does not ignore <span class="t-data">{{ view.exposed }}/</span>, so every worktree
              will show as untracked in this repository.
            </p>
            <Button
              size="sm"
              variation="warning"
              class="ml-auto shrink-0"
              :disabled="ignoring"
              @click="ignore"
            >
              {{ ignoring ? 'adding…' : 'add to .gitignore' }}
            </Button>
          </div>
        </div>
      </Panel>
    </div>
  </main>

  <ModalPanel v-if="confirming" title="Save recipe" @close="confirming = false">
    <p class="mb-3 max-w-prose font-sans text-xs text-dim">
      Kept in ccwt's own storage — your repository is not touched.
    </p>

    <pre class="ccwt-log overflow-x-auto border border-line bg-canvas px-2 py-2"><span
      v-for="(line, index) in preview"
      :key="index"
      class="block"
      :class="TONE[line.kind]"
    >{{ line.kind === 'add' ? '+' : line.kind === 'remove' ? '-' : ' ' }} {{ line.text }}</span></pre>

    <template #footer>
      <Button size="sm" @click="confirming = false">cancel</Button>
      <Button size="sm" variation="success" :outline="false" :disabled="saving" @click="save">{{
        saving ? 'saving…' : 'save recipe'
      }}</Button>
    </template>
  </ModalPanel>
</template>
