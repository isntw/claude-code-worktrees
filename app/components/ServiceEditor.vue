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

const takesPort = computed(() => props.service.command.includes('{{port}}'))

const PORT_TOKEN = '{{' + 'port' + '}}'
const CMD_HINT = `npm run dev -- --port ${PORT_TOKEN}`
const ENV_HINT = 'mysql://…' + '{{' + 'port.db' + '}}' + '/app'

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
        <span v-if="!takesPort" class="font-sans text-[0.625rem] text-caution">
          No <code class="font-mono">{{ PORT_TOKEN }}</code> in this command — ccwt cannot tell it
          which port to use, so worktrees will collide.
        </span>
      </label>

      <label :class="FIELD">
        <span class="t-eyebrow">Port range from</span>
        <Input :model-value="port(0)" placeholder="5200" @update:model-value="(v) => setPort(0, v)" />
      </label>

      <label :class="FIELD">
        <span class="t-eyebrow">to</span>
        <Input :model-value="port(1)" placeholder="5299" @update:model-value="(v) => setPort(1, v)" />
      </label>

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
