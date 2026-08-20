<script setup lang="ts">
import type { AddressView, LoopbackHost } from '#shared/types'

const api = useApi()

const view = ref<AddressView | null>(null)
const host = ref<LoopbackHost>('127.0.0.1')
const port = ref('4600')
const busy = ref(false)
const error = ref('')
const saved = ref(false)

const HOSTS: { value: LoopbackHost; label: string }[] = [
  { value: '127.0.0.1', label: '127.0.0.1' },
  { value: 'localhost', label: 'localhost' },
  { value: '::1', label: '::1' },
]

const adopt = (next: AddressView) => {
  view.value = next
  host.value = next.saved.host
  port.value = String(next.saved.port)
}

const parsed = computed(() => Number.parseInt(port.value, 10))

const invalid = computed(
  () => !Number.isInteger(parsed.value) || parsed.value < 1024 || parsed.value > 65_535,
)

const changed = computed(
  () => !!view.value && (host.value !== view.value.saved.host || parsed.value !== view.value.saved.port),
)

const live = computed(() => {
  const at = view.value?.live
  if (!at) return null
  return `http://${at.host === '::1' ? '[::1]' : at.host}:${at.port}`
})

async function load() {
  try {
    adopt(await api.getAddress())
  } catch (cause) {
    error.value = (cause as Error).message
  }
}

async function save() {
  if (invalid.value) return

  busy.value = true
  error.value = ''
  saved.value = false

  try {
    adopt(await api.saveAddress({ host: host.value, port: parsed.value }))
    saved.value = true
  } catch (cause) {
    error.value = (cause as Error).message
  } finally {
    busy.value = false
  }
}

onMounted(load)
</script>

<template>
  <Panel title="Address">
    <div class="px-3 py-3">
      <p class="max-w-prose font-sans text-xs text-dim">
        Where the dashboard listens. ccwt runs git and spawns processes, so it binds loopback only —
        the choice is which loopback name, not whether to be reachable.
      </p>

      <p v-if="live" class="mt-3 flex items-center gap-2">
        <span class="t-eyebrow">now</span>
        <span class="font-mono text-xs text-ink">{{ live }}</span>
      </p>

      <div class="mt-3 flex flex-wrap items-center gap-2">
        <Tabs v-model="host" size="md" label="Host" :options="HOSTS" />
        <Input
          v-model="port"
          label="Port"
          placeholder="4600"
          class="w-24"
          :invalid="invalid"
          :disabled="busy"
        />
        <Button size="md" :disabled="busy || invalid || !changed" @click="save">save</Button>
      </div>

      <Notice v-if="invalid" variation="error" class="mt-3">
        A port must be a whole number between 1024 and 65535.
      </Notice>

      <Notice v-else-if="error" variation="error" class="mt-3">{{ error }}</Notice>

      <Notice v-else-if="view?.pending" variation="info" class="mt-3">
        Saved. ccwt is still on {{ live }} — it takes the new address the next time it starts.
        <template #hint>
          A running server cannot move without dropping the page you are reading this on.
        </template>
      </Notice>

      <Notice v-else-if="saved" variation="success" class="mt-3">
        Saved to <code class="font-mono">~/.ccwt/config.json</code>.
      </Notice>
    </div>
  </Panel>
</template>
