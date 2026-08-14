<script setup lang="ts">
import { computed } from 'vue'
import { Plus, Trash2, X } from 'lucide-vue-next'
import type { ServiceConfig } from '#shared/types'

const props = defineProps<{ service: ServiceConfig; index: number }>()

const emit = defineEmits<{
  update: [index: number, service: ServiceConfig]
  remove: [index: number]
}>()

const patch = (change: Partial<ServiceConfig>) => {
  emit('update', props.index, { ...props.service, ...change })
}

const envRows = computed(() => Object.entries(props.service.env ?? {}))

const setEnv = (rows: [string, string][]) => {
  const env: Record<string, string> = {}
  for (const [key, value] of rows) if (key.trim()) env[key.trim()] = value
  patch({ env: Object.keys(env).length ? env : undefined })
}

const updateEnv = (at: number, key: string, value: string) => {
  const rows = envRows.value.map(([k, v], index) =>
    index === at ? ([key, value] as [string, string]) : ([k, v] as [string, string]),
  )
  setEnv(rows)
}

const port = (at: 0 | 1) => String(props.service.portRange[at] ?? '')

const setPort = (at: 0 | 1, raw: string) => {
  const value = Number.parseInt(raw, 10)
  const range: [number, number] = [...props.service.portRange]
  range[at] = Number.isFinite(value) ? value : 0
  patch({ portRange: range })
}

const portRows = computed(() => Object.entries(props.service.ports ?? {}))

const setPorts = (rows: [string, [number, number]][]) => {
  const ports: Record<string, [number, number]> = {}
  for (const [key, range] of rows) if (key.trim()) ports[key.trim()] = range
  patch({ ports: Object.keys(ports).length ? ports : undefined })
}

const updatePort = (at: number, key: string, range: [number, number]) => {
  setPorts(
    portRows.value.map(([k, r], index) =>
      index === at ? ([key, range] as [string, [number, number]]) : ([k, r] as [string, [number, number]]),
    ),
  )
}

const whole = (raw: string) => {
  const value = Number.parseInt(raw, 10)
  return Number.isFinite(value) ? value : 0
}

const takesPort = computed(() => props.service.command.includes('{{port}}'))

const pinned = computed(() => props.service.portRange[0] === props.service.portRange[1])

const setPinned = (value: boolean) => {
  const low = props.service.portRange[0]
  patch({ portRange: value ? [low, low] : [low, low + 99] })
}

const setPinnedPort = (raw: string) => {
  const value = Number.parseInt(raw, 10)
  const port = Number.isFinite(value) ? value : 0
  patch({ portRange: [port, port] })
}

const PORT_TOKEN = '{{' + 'port' + '}}'
const CMD_HINT = `npm run dev -- --port ${PORT_TOKEN}`
const EXEC_EXAMPLE = 'npm run db:migrate'
const ENV_HINT = 'mysql://…' + '{{' + 'port.db' + '}}' + '/app'
const VAR_HINT = '$' + '{DB_PORT}'

const FIELD = 'flex flex-col gap-1'
</script>

<template>
  <article class="border border-line bg-surface">
    <header class="flex items-center gap-2 border-b border-line px-3 py-2">
      <span class="t-eyebrow">Service</span>
      <span class="flex-1 truncate font-mono text-[0.6875rem] text-ink">{{
        service.name || 'unnamed'
      }}</span>
      <Button size="sm" icon variation="error" title="Remove service" @click="emit('remove', index)">
        <Trash2 :size="12" aria-hidden="true" />
      </Button>
    </header>

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
          For a service that holds more than one port — a container stack publishing a database
          beside its web server, or a separate debugger or HMR port. ccwt allocates one per worktree
          and puts it in the environment under the name you give it, so a file that reads
          <code class="font-mono">{{ VAR_HINT }}</code> gets a different value in every worktree.
        </p>
        <div v-for="([key, range], at) in portRows" :key="at" class="flex items-center gap-1.5">
          <Input
            :model-value="key"
            placeholder="DB_PORT"
            label="Variable name"
            @update:model-value="(next) => updatePort(at, next, range)"
          />
          <Input
            :model-value="String(range[0])"
            placeholder="33060"
            label="Range from"
            @update:model-value="(next) => updatePort(at, key, [whole(next), range[1]])"
          />
          <Input
            :model-value="String(range[1])"
            placeholder="33159"
            label="to"
            @update:model-value="(next) => updatePort(at, key, [range[0], whole(next)])"
          />
          <Button
            icon
            title="Remove port"
            @click="setPorts(portRows.filter((_, index) => index !== at))"
          >
            <X :size="12" aria-hidden="true" />
          </Button>
        </div>
        <div>
          <Button size="sm" @click="setPorts([...portRows, ['', [0, 0]]])">
            <template #lead><Plus :size="11" aria-hidden="true" /></template>
            port
          </Button>
        </div>
      </div>

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
          request. Each command runs in the worktree with the same environment the service was
          started with. A command that fails is retried for two minutes, because a port answering
          does not always mean everything behind it is ready. If it never succeeds it is reported
          with its exit code and the commands after it are skipped; the service keeps running either
          way.
        </p>
        <ListEditor
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
    </div>
  </article>
</template>
