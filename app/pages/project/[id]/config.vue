<script setup lang="ts">
import { computed, onMounted, ref, watch } from 'vue'
import { ArrowLeft, Plus } from 'lucide-vue-next'
import type { CcwtConfig, ConfigView, ServiceConfig } from '#shared/types'
import { changed, collapse, diffLines } from '../../../diff'

const api = useApi()
const route = useRoute()
const projectId = computed(() => String(route.params.id))

const view = ref<ConfigView | null>(null)
const draft = ref<CcwtConfig | null>(null)
const raw = ref('')
const mode = ref<'form' | 'json'>('form')

const loading = ref(false)
const saving = ref(false)
const error = ref<string | null>(null)
const parseError = ref<string | null>(null)
const confirming = ref(false)

const serialise = (config: CcwtConfig) => `${JSON.stringify(config, null, 2)}\n`

const payload = computed(() => (mode.value === 'json' ? raw.value : draft.value ? serialise(draft.value) : ''))

const diff = computed(() => diffLines(view.value?.text ?? '', payload.value))
const dirty = computed(() => Boolean(view.value) && (changed(diff.value) || !view.value!.exists))
const creating = computed(() => Boolean(view.value) && !view.value!.exists)
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
    const next = await api.saveConfig(projectId.value, payload.value, view.value?.mtimeMs ?? null)
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

const setProvision = (key: 'copy' | 'postCreate', value: string[]) => {
  if (!draft.value) return
  draft.value = { ...draft.value, provision: { ...draft.value.provision, [key]: value } }
}

onMounted(load)

const CMD_HINT = `npm run dev -- --port ${'{{' + 'port' + '}}'}`

const TONE = { same: 'text-faint', add: 'text-live', remove: 'text-alarm' } as const
const SECTION = 'border border-line bg-surface'
const HEAD = 'flex items-center gap-2 border-b border-line px-3 py-2'
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
      >{{ saving ? 'saving…' : creating ? 'create' : 'save' }}</Button
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
      <code v-if="view" class="truncate font-mono text-[0.625rem] text-faint">{{ view.path }}</code>
      <Badge v-if="view && !view.exists" variation="info">not created yet</Badge>
      <Badge v-if="dirty" variation="warning">unsaved</Badge>
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
      <textarea v-model="raw" class="t-area" rows="26" spellcheck="false" aria-label="Recipe JSON" />
      <p v-if="parseError" class="font-sans text-[0.6875rem] text-alarm">{{ parseError }}</p>
    </div>

    <div v-else-if="draft" class="flex flex-col gap-3">
      <section :class="SECTION">
        <header :class="HEAD"><p class="t-eyebrow">Services</p></header>
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
            @update="updateService"
            @remove="removeService"
          />
          <div>
            <Button size="sm" @click="addService">
              <Plus :size="11" aria-hidden="true" />
              service
            </Button>
          </div>
        </div>
      </section>

      <section :class="SECTION">
        <header :class="HEAD"><p class="t-eyebrow">Provisioning</p></header>
        <div class="grid gap-4 px-3 py-3 lg:grid-cols-2">
          <div class="flex flex-col gap-1.5">
            <span class="t-eyebrow">Copy into each worktree</span>
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
            <span class="t-eyebrow">Run after creating</span>
            <p class="font-sans text-[0.625rem] text-faint">
              Commands run once in the new worktree, after dependencies are in place.
            </p>
            <ListEditor
              :model-value="draft.provision.postCreate"
              placeholder="pnpm db:migrate"
              empty="Nothing to run."
              add-label="command"
              @update:model-value="(value) => setProvision('postCreate', value)"
            />
          </div>
        </div>
      </section>

      <section :class="SECTION">
        <header :class="HEAD"><p class="t-eyebrow">Where worktrees live</p></header>
        <div class="px-3 py-3">
          <Input
            :model-value="draft.worktreesDir"
            placeholder="../.worktrees"
            label="Worktrees directory"
            @update:model-value="(value) => draft && (draft = { ...draft, worktreesDir: value })"
          />
          <p class="mt-1 font-sans text-[0.625rem] text-faint">
            Relative to the repository root. Each project gets its own folder inside it.
          </p>
        </div>
      </section>
    </div>
  </main>

  <ModalPanel v-if="confirming" :title="creating ? 'Create recipe' : 'Save recipe'" @close="confirming = false">
    <p class="mb-3 font-sans text-xs text-dim">
      Writing <code class="font-mono text-ink">{{ view?.path }}</code
      >.
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
        saving ? 'writing…' : creating ? 'create file' : 'write file'
      }}</Button>
    </template>
  </ModalPanel>
</template>
