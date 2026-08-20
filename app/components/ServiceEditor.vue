<script setup lang="ts">
import { computed, ref } from 'vue'
import { Plus, Trash2, X } from 'lucide-vue-next'
import type { Service, ServiceKind, WriteEntry } from '#shared/types'
import {
  COMPOSE_SKELETON,
  DEFAULT_COMPOSE_FILE,
  composeCommand,
  composeExec,
  composeFileOf,
  isStack,
  readComposeExec,
  serviceNames,
  teardownCommand,
} from '#shared/compose'

const props = withDefaults(
  defineProps<{
    service: Service
    index: number
    writes?: WriteEntry[]
    startOpen?: boolean
  }>(),
  { writes: () => [], startOpen: false },
)

const open = ref(props.startOpen)

const emit = defineEmits<{
  update: [index: number, service: Service]
  remove: [index: number]
  write: [path: string, content: string]
  unwrite: [path: string]
}>()

const patch = (change: Partial<Service>) => {
  emit('update', props.index, { ...props.service, ...change })
}

const PORT_TOKEN = '{{' + 'port' + '}}'
const PROJECT_TOKEN = '{{' + 'project' + '}}'
const SLUG_TOKEN = '{{' + 'slug' + '}}'
const CMD_HINT = `npm run dev -- --port ${PORT_TOKEN}`
const EXEC_EXAMPLE = 'npm run db:migrate'
const ENV_HINT = 'mysql://…' + '{{' + 'port.db' + '}}' + '/app'
const VAR_HINT = '$' + '{DB_PORT}'
const PROJECT_NAME = `ccwt-${PROJECT_TOKEN}-${SLUG_TOKEN}`

const KINDS: { value: ServiceKind; label: string }[] = [
  { value: 'command', label: 'a command' },
  { value: 'stack', label: 'a container stack' },
]

const kind = computed<ServiceKind>(() =>
  isStack(props.service.kind, props.service.command) ? 'stack' : 'command',
)

const FIELD = 'flex flex-col gap-1'

const composeFile = computed(() => composeFileOf(props.service.command))


const entry = computed(() => props.writes.find((write) => write.path === composeFile.value))

const source = computed<'repo' | 'written'>(() => (entry.value ? 'written' : 'repo'))

const SOURCES = [
  { value: 'repo' as const, label: 'in the repository' },
  { value: 'written' as const, label: 'written by ccwt' },
]

const stashed = ref('')

interface PortRow {
  name: string
  range: [number, number]
  primary: boolean
}

const primaryVar = computed(
  () => Object.entries(props.service.env ?? {}).find(([, value]) => value === PORT_TOKEN)?.[0] ?? '',
)

const portDrafts = ref<PortRow[]>([])

const portRows = computed<PortRow[]>(() => {
  const rows: PortRow[] = [
    { name: primaryVar.value, range: props.service.portRange, primary: true },
    ...Object.entries(props.service.ports ?? {}).map(([name, range]) => ({
      name,
      range,
      primary: false,
    })),
  ]

  rows.sort((a, b) => a.range[0] - b.range[0] || a.name.localeCompare(b.name))

  return [...rows, ...portDrafts.value]
})

const writePorts = (rows: PortRow[]) => {
  const primary = rows.find((row) => row.primary) ?? rows[0]
  const extras: Record<string, [number, number]> = {}

  for (const row of rows) {
    if (row === primary || !row.name.trim()) continue
    extras[row.name.trim()] = row.range
  }

  const env: Record<string, string> = {}
  for (const [key, value] of Object.entries(props.service.env ?? {})) {
    if (value !== PORT_TOKEN) env[key] = value
  }
  if (primary?.name.trim()) env[primary.name.trim()] = PORT_TOKEN

  patch({
    portRange: primary?.range ?? props.service.portRange,
    ports: Object.keys(extras).length ? extras : undefined,
    env: Object.keys(env).length ? env : undefined,
  })
}

const applyRows = (rows: PortRow[]) => {
  portDrafts.value = rows.filter((row) => !row.primary && !row.name.trim())
  writePorts(rows)
}

const editPort = (at: number, change: Partial<PortRow>) => {
  applyRows(portRows.value.map((row, index) => (index === at ? { ...row, ...change } : row)))
}

const choosePrimary = (at: number) => {
  if (!portRows.value[at]?.name.trim()) return
  applyRows(portRows.value.map((row, index) => ({ ...row, primary: index === at })))
}

const dropPort = (at: number) => {
  const rows = portRows.value.filter((_, index) => index !== at).map((row) => ({ ...row }))
  if (!rows.some((row) => row.primary) && rows[0]) rows[0].primary = true
  applyRows(rows)
}

const addPort = () => {
  const last = portRows.value[portRows.value.length - 1]
  const from = (last?.range[1] ?? 20079) + 1
  portDrafts.value = [...portDrafts.value, { name: '', range: [from, from + 99], primary: false }]
}

interface Step {
  container: string
  command: string
}

const asCommands = (rows: Step[], file: string): string[] =>
  rows
    .filter((row) => row.command.trim())
    .map((row) =>
      row.container.trim()
        ? composeExec(file, row.container.trim(), row.command.trim())
        : row.command.trim(),
    )

const containers = computed(() => (entry.value ? serviceNames(entry.value.content) : []))

const stepDrafts = ref<Step[]>([])

const stepRows = computed<Step[]>(() => [
  ...(props.service.postStart ?? []).map(readComposeExec),
  ...stepDrafts.value,
])

const applySteps = (rows: Step[]) => {
  stepDrafts.value = rows.filter((row) => !row.command.trim())
  const commands = asCommands(rows, composeFile.value)
  patch({ postStart: commands.length ? commands : undefined })
}

const editStep = (at: number, change: Partial<Step>) => {
  applySteps(stepRows.value.map((row, index) => (index === at ? { ...row, ...change } : row)))
}

const dropStep = (at: number) => {
  applySteps(stepRows.value.filter((_, index) => index !== at))
}

const addStep = () => {
  stepDrafts.value = [...stepDrafts.value, { container: '', command: '' }]
}

const setComposeFile = (file: string) => {
  const next = file.trim()
  const previous = composeFile.value

  const steps = kind.value === 'stack' ? asCommands(stepRows.value, next) : props.service.postStart

  patch({
    command: composeCommand(next, 'up'),
    stopCommand: composeCommand(next, 'down'),
    postStart: steps?.length ? steps : undefined,
    removeCommand: props.service.removeCommand ? teardownCommand(next) : undefined,
  })

  if (source.value === 'written' && next && next !== previous) {
    const content = entry.value?.content ?? ''
    emit('unwrite', previous)
    emit('write', next, content)
  }
}

const setSource = (next: 'repo' | 'written') => {
  if (next === source.value) return

  const file = composeFile.value || DEFAULT_COMPOSE_FILE
  if (!composeFile.value) setComposeFile(file)

  if (next === 'written') {
    emit('write', file, stashed.value || COMPOSE_SKELETON)
    return
  }

  stashed.value = entry.value?.content ?? ''
  emit('unwrite', file)
}

const setContent = (content: string) => {
  if (composeFile.value) emit('write', composeFile.value, content)
}

const setKind = (next: ServiceKind) => {
  if (next === kind.value) return

  if (next === 'command') {
    patch({ kind: 'command' })
    return
  }

  const file = composeFile.value || DEFAULT_COMPOSE_FILE
  const env: Record<string, string> = { ...props.service.env }
  env.COMPOSE_PROJECT_NAME = PROJECT_NAME
  if (!primaryVar.value) env.WEB_PORT = PORT_TOKEN

  patch({
    kind: 'stack',
    command: composeCommand(file, 'up'),
    stopCommand: composeCommand(file, 'down'),
    removeCommand: props.service.removeCommand ?? teardownCommand(file),
    env,
  })
}

const envDrafts = ref<[string, string][]>([])

const envRows = computed<[string, string][]>(() => [
  ...Object.entries(props.service.env ?? {}).filter(
    ([key, value]) =>
      value !== PORT_TOKEN && !(kind.value === 'stack' && key === 'COMPOSE_PROJECT_NAME'),
  ),
  ...envDrafts.value,
])

const setEnv = (rows: [string, string][]) => {
  envDrafts.value = rows.filter(([key]) => !key.trim())

  const env: Record<string, string> = {}
  if (kind.value === 'stack') {
    env.COMPOSE_PROJECT_NAME = props.service.env?.COMPOSE_PROJECT_NAME ?? PROJECT_NAME
  }
  if (primaryVar.value) env[primaryVar.value] = PORT_TOKEN
  for (const [key, value] of rows) if (key.trim()) env[key.trim()] = value
  patch({ env: Object.keys(env).length ? env : undefined })
}

const updateEnv = (at: number, key: string, value: string) => {
  setEnv(
    envRows.value.map(([k, v], index) =>
      index === at ? ([key, value] as [string, string]) : ([k, v] as [string, string]),
    ),
  )
}

const hiddenEnv = computed(() =>
  Object.entries(props.service.env ?? {}).filter(([, value]) => value !== PORT_TOKEN),
)

const port = (at: 0 | 1) => String(props.service.portRange[at] ?? '')

const setPort = (at: 0 | 1, raw: string) => {
  const range: [number, number] = [...props.service.portRange]
  range[at] = whole(raw)
  patch({ portRange: range })
}

const whole = (raw: string) => {
  const value = Number.parseInt(raw, 10)
  return Number.isFinite(value) ? value : 0
}

const takesPort = computed(() => props.service.command.includes(PORT_TOKEN))

const pinned = computed(() => props.service.portRange[0] === props.service.portRange[1])

const setPinned = (value: boolean) => {
  const low = props.service.portRange[0]
  patch({ portRange: value ? [low, low] : [low, low + 99] })
}

const setPinnedPort = (raw: string) => {
  const chosen = whole(raw)
  patch({ portRange: [chosen, chosen] })
}
</script>

<template>
  <Panel v-model:open="open" title="Service">
    <template #label>
      <span class="truncate font-mono text-[0.6875rem] text-ink">{{
        service.name || 'unnamed'
      }}</span>
      <span class="t-eyebrow ml-auto shrink-0 text-faint">{{
        kind === 'stack' ? 'container stack' : 'command'
      }}</span>
    </template>

    <template #actions>
      <Tabs
        :model-value="kind"
        :options="KINDS"
        label="What this service is"
        @update:model-value="setKind"
      />
      <Button size="sm" icon variation="error" title="Remove service" @click="emit('remove', index)">
        <Trash2 :size="12" aria-hidden="true" />
      </Button>
    </template>

    <div class="grid gap-3 px-3 py-3 sm:grid-cols-2">
      <label :class="FIELD">
        <span class="t-eyebrow">Name</span>
        <Input
          :model-value="service.name"
          placeholder="web"
          @update:model-value="(value) => patch({ name: value })"
        />
      </label>

      <label :class="FIELD">
        <span class="t-eyebrow">Working directory</span>
        <Input
          :model-value="service.cwd"
          placeholder="."
          @update:model-value="(value) => patch({ cwd: value })"
        />
      </label>

      <template v-if="kind === 'stack'">
        <div :class="[FIELD, 'sm:col-span-2']">
          <div class="flex items-center gap-2">
            <span class="t-eyebrow">Compose file</span>
            <Tabs
              :model-value="source"
              :options="SOURCES"
              label="Where the compose file comes from"
              @update:model-value="setSource"
            />
          </div>
          <Input
            :model-value="composeFile"
            :placeholder="DEFAULT_COMPOSE_FILE"
            label="Compose file path"
            @update:model-value="setComposeFile"
          />
          <Textarea
            v-if="source === 'written'"
            :model-value="entry?.content ?? ''"
            :rows="10"
            label="Compose file contents"
            @update:model-value="setContent"
          />
          <span class="font-sans text-[0.625rem] text-faint">
            <template v-if="source === 'written'">
              ccwt puts this file into every worktree, so the repository never carries it. Read the
              ports from the environment here — <code class="font-mono">{{ VAR_HINT }}</code> — and
              declare the same names below.
            </template>
            <template v-else>
              A file the project commits. ccwt reads nothing from it; it only sets the variables you
              declare below before running compose.
            </template>
          </span>
        </div>

        <div v-if="!composeFile" class="sm:col-span-2 border border-caution px-2 py-1.5">
          <p class="font-sans text-[0.625rem] text-caution">
            This service's command was edited by hand, so the fields above no longer describe it.
            Switch to <em>a command</em> to see it as written, or edit the recipe as JSON.
          </p>
          <code class="mt-1 block font-mono text-[0.625rem] text-dim">{{ service.command }}</code>
        </div>

        <div :class="[FIELD, 'sm:col-span-2']">
          <span class="t-eyebrow">Ports it publishes</span>
          <p class="font-sans text-[0.625rem] text-faint">
            ccwt allocates one of each per worktree and exports it under this name, so a file reading
            <code class="font-mono">{{ VAR_HINT }}</code> gets a different value in every worktree.
            Mark the one you open in a browser — that is the port ccwt watches and links.
          </p>
          <div v-for="(row, at) in portRows" :key="at" class="flex items-center gap-1.5">
            <input
              type="radio"
              class="shrink-0 accent-ink disabled:opacity-30"
              :name="`watched-${index}`"
              :checked="row.primary"
              :disabled="!row.name.trim()"
              :title="row.name.trim() ? 'Open this one in a browser' : 'Name this port first'"
              :aria-label="`Open ${row.name || 'this port'} in a browser`"
              @change="choosePrimary(at)"
            />
            <Input
              :model-value="row.name"
              placeholder="WEB_PORT"
              label="Variable name"
              @update:model-value="(value) => editPort(at, { name: value })"
            />
            <Input
              :model-value="String(row.range[0])"
              placeholder="20080"
              label="Range from"
              @update:model-value="(value) => editPort(at, { range: [whole(value), row.range[1]] })"
            />
            <Input
              :model-value="String(row.range[1])"
              placeholder="20179"
              label="to"
              @update:model-value="(value) => editPort(at, { range: [row.range[0], whole(value)] })"
            />
            <Button
              icon
              :disabled="portRows.length === 1"
              title="Remove port"
              @click="dropPort(at)"
            >
              <X :size="12" aria-hidden="true" />
            </Button>
          </div>
          <p v-if="!primaryVar" class="font-sans text-[0.625rem] text-caution">
            No port is marked as the one you open in a browser, so nothing is wired to
            <code class="font-mono">{{ PORT_TOKEN }}</code> and ccwt has no port to watch. Name a
            port and select it.
          </p>
          <div>
            <Button size="sm" @click="addPort">
              <template #lead><Plus :size="11" aria-hidden="true" /></template>
              port
            </Button>
          </div>
        </div>
      </template>

      <template v-else>
        <label :class="[FIELD, 'sm:col-span-2']">
          <span class="t-eyebrow">Command</span>
          <Input
            :model-value="service.command"
            :placeholder="CMD_HINT"
            @update:model-value="(value) => patch({ command: value })"
          />
          <span v-if="!takesPort && !pinned" class="font-sans text-[0.625rem] text-caution">
            No <code class="font-mono">{{ PORT_TOKEN }}</code> in this command — ccwt cannot tell it
            which port to use, so worktrees will collide.
          </span>
          <span v-else-if="!takesPort" class="font-sans text-[0.625rem] text-faint">
            No <code class="font-mono">{{ PORT_TOKEN }}</code> to substitute, so this service has to
            listen on {{ service.portRange[0] }} of its own accord. ccwt watches that port rather than
            assigning it.
          </span>
        </label>

        <div :class="[FIELD, 'sm:col-span-2']">
          <Checkbox :model-value="pinned" @update:model-value="setPinned">one port only</Checkbox>
          <p class="font-sans text-[0.625rem] text-faint">
            Pin the service to a single port when the app cannot be told which one to use. Only one
            worktree can run it at a time, and the card says so when something already holds the port.
          </p>
        </div>

        <label v-if="pinned" :class="[FIELD, 'sm:col-span-2']">
          <span class="t-eyebrow">Port</span>
          <Input :model-value="port(0)" placeholder="3000" @update:model-value="setPinnedPort" />
        </label>

        <template v-else>
          <label :class="FIELD">
            <span class="t-eyebrow">Port range from</span>
            <Input
              :model-value="port(0)"
              placeholder="5200"
              @update:model-value="(v) => setPort(0, v)"
            />
          </label>

          <label :class="FIELD">
            <span class="t-eyebrow">to</span>
            <Input
              :model-value="port(1)"
              placeholder="5299"
              @update:model-value="(v) => setPort(1, v)"
            />
          </label>
        </template>

        <div :class="[FIELD, 'sm:col-span-2']">
          <span class="t-eyebrow">More ports</span>
          <p class="font-sans text-[0.625rem] text-faint">
            For a service that holds more than one port — a separate debugger or HMR port. Each is
            allocated per worktree and put in the environment under the name you give it.
          </p>
          <div v-for="(row, at) in portRows.slice(1)" :key="at" class="flex items-center gap-1.5">
            <Input
              :model-value="row.name"
              placeholder="HMR_PORT"
              label="Variable name"
              @update:model-value="(value) => editPort(at + 1, { name: value })"
            />
            <Input
              :model-value="String(row.range[0])"
              placeholder="24678"
              label="Range from"
              @update:model-value="(value) => editPort(at + 1, { range: [whole(value), row.range[1]] })"
            />
            <Input
              :model-value="String(row.range[1])"
              placeholder="24777"
              label="to"
              @update:model-value="(value) => editPort(at + 1, { range: [row.range[0], whole(value)] })"
            />
            <Button icon title="Remove port" @click="dropPort(at + 1)">
              <X :size="12" aria-hidden="true" />
            </Button>
          </div>
          <div>
            <Button size="sm" @click="addPort">
              <template #lead><Plus :size="11" aria-hidden="true" /></template>
              port
            </Button>
          </div>
        </div>
      </template>

      <div :class="[FIELD, 'sm:col-span-2']">
        <span class="t-eyebrow">Starts after</span>
        <p class="font-sans text-[0.625rem] text-faint">
          Other services that must be reachable first — a database before the app that queries it.
        </p>
        <ListEditor
          :model-value="service.dependsOn ?? []"
          placeholder="db"
          empty="Starts immediately."
          add-label="service"
          @update:model-value="(value) => patch({ dependsOn: value.length ? value : undefined })"
        />
      </div>

      <div :class="[FIELD, 'sm:col-span-2']">
        <span class="t-eyebrow">Run once this service answers</span>
        <p class="font-sans text-[0.625rem] text-faint">
          Runs every time this service starts, once its port responds — migrations, seeds, a warm-up
          request. A command that fails is retried for two minutes, because a port answering does not
          always mean everything behind it is ready.
        </p>

        <template v-if="kind === 'stack'">
          <p class="font-sans text-[0.625rem] text-faint">
            Name the container to run inside and ccwt writes the rest — it enters the container this
            worktree started, without a terminal. Leave the container blank to run the command on
            this machine instead.
          </p>
          <div v-for="(row, at) in stepRows" :key="at" class="flex items-center gap-1.5">
            <div class="w-32 shrink-0">
              <Suggest
                :model-value="row.container"
                :options="containers"
                placeholder="app"
                label="Container"
                @update:model-value="(value) => editStep(at, { container: value })"
              />
            </div>
            <Input
              :model-value="row.command"
              placeholder="php artisan migrate --force"
              label="Command"
              @update:model-value="(value) => editStep(at, { command: value })"
            />
            <Button icon title="Remove command" @click="dropStep(at)">
              <X :size="12" aria-hidden="true" />
            </Button>
          </div>
          <p v-if="!stepRows.length" class="font-sans text-[0.625rem] text-faint">Nothing to run.</p>
          <div>
            <Button size="sm" @click="addStep">
              <template #lead><Plus :size="11" aria-hidden="true" /></template>
              command
            </Button>
          </div>
        </template>

        <ListEditor
          v-else
          :model-value="service.postStart ?? []"
          :placeholder="EXEC_EXAMPLE"
          empty="Nothing to run."
          add-label="command"
          @update:model-value="(value) => patch({ postStart: value.length ? value : undefined })"
        />
      </div>

      <div :class="[FIELD, 'sm:col-span-2']">
        <span class="t-eyebrow">Environment</span>
        <p v-if="!envRows.length" class="font-sans text-[0.625rem] text-faint">
          Nothing extra. Every service already gets its own port, plus
          <code class="font-mono">CCWT_URL_*</code> for the others.
        </p>
        <div v-for="([key, value], at) in envRows" :key="at" class="flex items-center gap-1.5">
          <Input
            :model-value="key"
            placeholder="DATABASE_URL"
            label="Variable name"
            @update:model-value="(next) => updateEnv(at, next, value)"
          />
          <Input
            :model-value="value"
            :placeholder="ENV_HINT"
            label="Value"
            @update:model-value="(next) => updateEnv(at, key, next)"
          />
          <Button
            icon
            title="Remove variable"
            @click="setEnv(envRows.filter((_, index) => index !== at))"
          >
            <X :size="12" aria-hidden="true" />
          </Button>
        </div>
        <div>
          <Button size="sm" @click="setEnv([...envRows, ['', '']])">
            <template #lead><Plus :size="11" aria-hidden="true" /></template>
            variable
          </Button>
        </div>
      </div>

      <div class="sm:col-span-2 border border-line bg-raised px-2.5 py-2">
        <p class="t-eyebrow mb-1">ccwt will run</p>
        <code class="block font-mono text-[0.625rem] leading-relaxed text-dim">
          <span class="block text-ink">{{ service.command || '—' }}</span>
          <span
            v-for="(row, at) in portRows.filter((entry) => entry.primary || entry.name.trim())"
            :key="at"
            class="block"
          >
            {{ row.name || 'PORT' }}=&lt;{{ row.range[0] }}–{{ row.range[1] }}&gt;{{
              row.primary ? '  ← watched' : ''
            }}
          </span>
          <span v-for="([key, value], at) in hiddenEnv" :key="`e${at}`" class="block">
            {{ key }}={{ value }}
          </span>
          <span v-if="service.stopCommand" class="block">stop: {{ service.stopCommand }}</span>
          <span v-if="service.removeCommand" class="block">
            on remove: {{ service.removeCommand }}
          </span>
        </code>
      </div>
    </div>
  </Panel>
</template>
