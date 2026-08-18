<script setup lang="ts">
import { computed, onMounted, ref } from 'vue'
import type { ForeignHolder, PortHolders, ServiceStatus, Worktree } from '#shared/types'

const props = defineProps<{
  projectId: string
  worktree: Worktree
  service: ServiceStatus
}>()

const emit = defineEmits<{ close: []; done: [] }>()

const api = useApi()
const { setAsksHandoff } = useConfirm()

const holders = ref<PortHolders | null>(null)
const reading = ref(true)
const busy = ref(false)
const error = ref<string | null>(null)
const quiet = ref(false)

const port = computed(() => props.service.port ?? 0)

const ours = computed(() => holders.value?.ours ?? [])
const foreign = computed(() => holders.value?.foreign ?? [])
const free = computed(() => holders.value?.free === true)
const unknown = computed(
  () => holders.value !== null && !free.value && !ours.value.length && !foreign.value.length,
)

const title = computed(() => {
  if (ours.value.length) return `Move ${props.service.name} to ${props.worktree.name}`
  if (free.value) return `Start ${props.service.name}`
  return `Take port ${port.value}`
})

const said = (holder: ForeignHolder) => {
  const parts = holder.command.split(' ')
  const head = parts[0]
  if (!head) return holder.name
  return [head.split('/').pop(), ...parts.slice(1)].join(' ')
}

const read = async () => {
  reading.value = true
  error.value = null
  try {
    holders.value = await api.portHolders(port.value)
  } catch (cause) {
    error.value = (cause as Error).message
  } finally {
    reading.value = false
  }
}

const confirm = async () => {
  busy.value = true
  error.value = null

  try {
    if (!free.value) {
      const outcome = await api.freePort(port.value, {
        pids: foreign.value.map((holder) => holder.pid),
        services: ours.value.map((holder) => ({
          worktreeId: holder.worktreeId,
          service: holder.service,
        })),
      })

      if (!outcome.freed) {
        error.value = outcome.refused[0]?.why ?? outcome.why ?? `Port ${port.value} is still held.`
        busy.value = false
        await read()
        return
      }
    }

    if (quiet.value) setAsksHandoff(props.projectId, false)

    await api.startService(props.projectId, props.worktree.id, props.service.name)
    emit('done')
  } catch (cause) {
    error.value = (cause as Error).message
    busy.value = false
  }
}

onMounted(read)
</script>

<template>
  <ModalPanel :title="title" @close="emit('close')">
    <p v-if="reading" class="font-sans text-xs text-faint">
      reading what is on <span class="font-mono">{{ port }}</span
      >…
    </p>

    <template v-else-if="free">
      <p class="font-sans text-xs text-dim">
        Port <code class="font-mono text-ink">{{ port }}</code> is free now — whatever was on it let
        go while this was open.
      </p>
    </template>

    <template v-else-if="ours.length">
      <p class="font-sans text-xs text-dim">
        <code class="font-mono text-ink">{{ service.name }}</code> is pinned to
        <code class="font-mono text-ink">{{ port }}</code
        >, and
        <code class="font-mono text-ink">{{ ours[0]!.worktree }}</code> is running it.
      </p>

      <div class="mt-3 border border-line bg-canvas px-3 py-2.5">
        <div
          v-for="holder in ours"
          :key="holder.worktreeId + holder.service"
          class="flex items-baseline gap-3 font-mono text-[0.6875rem] text-dim"
        >
          <span class="t-eyebrow w-10 shrink-0">stop</span>
          <span class="min-w-0 truncate text-ink"
            >{{ holder.service }} · {{ holder.project }} ({{ holder.worktree }})</span
          >
          <span class="ml-auto shrink-0 tabular-nums text-ink">:{{ port }}</span>
        </div>

        <div class="flex items-baseline gap-3 font-mono text-[0.6875rem] text-dim">
          <span class="t-eyebrow w-10 shrink-0">start</span>
          <span class="min-w-0 truncate text-ink"
            >{{ service.name }} · {{ worktree.name }}</span
          >
          <span class="ml-auto shrink-0 tabular-nums text-ink">:{{ port }}</span>
        </div>
      </div>

      <p class="mt-3 font-sans text-[0.6875rem] text-dim">
        If it fails to come up here,
        <code class="font-mono">{{ ours[0]!.worktree }}</code> is not restarted.
      </p>

      <Checkbox v-model="quiet" class="mt-3">
        <span class="font-sans text-xs text-dim">Don't ask again for this project</span>
      </Checkbox>
    </template>

    <template v-else-if="foreign.length">
      <p class="font-sans text-xs text-dim">
        <code class="font-mono text-ink">{{ service.name }}</code> is pinned to
        <code class="font-mono text-ink">{{ port }}</code
        >, and something ccwt did not start is on it.
      </p>

      <div
        v-for="holder in foreign"
        :key="holder.pid"
        class="mt-3 flex flex-col gap-1 border border-line bg-canvas px-3 py-2.5 font-mono text-[0.6875rem] leading-relaxed text-dim [overflow-wrap:anywhere]"
      >
        <span>
          <span class="tabular-nums text-ink">pid {{ holder.pid }}</span>
          <span class="ml-3">{{ said(holder) }}</span>
        </span>
        <span v-if="holder.cwd" class="text-faint">{{ holder.cwd }}</span>
        <span v-if="holder.user" class="text-faint">{{ holder.user }}</span>
      </div>

      <p class="mt-3 font-sans text-xs text-caution">
        Stopping it ends whatever it was serving. ccwt cannot bring it back.
      </p>
    </template>

    <template v-else-if="unknown">
      <p class="font-sans text-xs text-caution">
        {{ holders?.why }}
      </p>
      <p class="mt-3 font-sans text-[0.6875rem] text-dim">
        ccwt will not signal a process it cannot show you. Stop it where you started it, then start
        <code class="font-mono">{{ service.name }}</code> again.
      </p>
    </template>

    <p v-if="error" class="mt-3 font-sans text-xs text-alarm">{{ error }}</p>

    <template #footer>
      <Button size="sm" @click="emit('close')">{{ unknown ? 'close' : 'cancel' }}</Button>
      <Button
        v-if="!reading && !unknown"
        size="sm"
        :variation="foreign.length ? 'error' : 'success'"
        :outline="false"
        :disabled="busy"
        @click="confirm"
        >{{
          busy
            ? 'working…'
            : free
              ? `start ${service.name}`
              : ours.length
                ? `move ${service.name} here`
                : `stop it and start ${service.name}`
        }}</Button
      >
    </template>
  </ModalPanel>
</template>
