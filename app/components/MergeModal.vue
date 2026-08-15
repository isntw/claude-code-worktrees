<script setup lang="ts">
import { computed, onMounted, ref } from 'vue'
import type { ForgeSession, MergeMethod, Mergeability, PullRequest } from '#shared/types'

const props = defineProps<{ projectId: string; pull: PullRequest }>()

const emit = defineEmits<{ close: []; merged: [] }>()

const api = useApi()

const state = ref<Mergeability | null>(null)
const session = ref<ForgeSession | null>(null)
const method = ref<MergeMethod>('merge')
const busy = ref(false)
const error = ref<string | null>(null)

const METHODS: { value: MergeMethod; label: string }[] = [
  { value: 'merge', label: 'merge' },
  { value: 'squash', label: 'squash' },
  { value: 'rebase', label: 'rebase' },
]

const blocked = computed(() => {
  const found = state.value?.state
  return found === 'dirty' || found === 'blocked' || found === 'draft' || found === 'behind'
})

const sha = computed(() => state.value?.headSha || props.pull.headSha)

onMounted(async () => {
  session.value = await api.getForgeSession().catch(() => null)
  state.value = await api
    .getMergeability(props.projectId, props.pull.number)
    .catch((cause: Error) => {
      error.value = cause.message
      return null
    })
})

const confirm = async () => {
  busy.value = true
  error.value = null
  try {
    await api.mergePull(props.projectId, props.pull.number, method.value, sha.value)
    emit('merged')
  } catch (cause) {
    error.value = (cause as Error).message
  } finally {
    busy.value = false
  }
}
</script>

<template>
  <ModalPanel
    :title="`Merge #${pull.number} into ${pull.baseRef}`"
    @close="emit('close')"
  >
    <p class="font-sans text-xs text-dim">
      <span class="font-mono text-ink">{{ pull.title }}</span>
    </p>

    <p class="mt-3 font-sans text-xs text-dim">
      This merges on GitHub, as
      <span class="font-mono text-ink">{{ session?.login ?? 'the signed-in account' }}</span
      >. It changes the remote, not this worktree — nothing here is stopped or deleted.
    </p>

    <p v-if="!state && !error" class="mt-3 font-sans text-xs text-faint">
      Asking GitHub whether it can be merged…
    </p>

    <p v-else-if="state" class="mt-3 font-sans text-xs" :class="blocked ? 'text-caution' : 'text-dim'">
      {{ state.reason }}
    </p>

    <div class="mt-3 flex items-center gap-2">
      <span class="t-eyebrow">Method</span>
      <Tabs v-model="method" :options="METHODS" label="Merge method" />
    </div>

    <p class="mt-3 font-sans text-[0.6875rem] text-faint">
      ccwt merges the commit this row was drawn from
      <code class="font-mono">{{ sha.slice(0, 8) }}</code
      >. If the branch moved since, GitHub refuses and nothing is merged.
    </p>

    <p v-if="error" class="mt-3 font-sans text-xs text-alarm">{{ error }}</p>

    <template #footer>
      <Button size="sm" @click="emit('close')">cancel</Button>
      <Button size="sm" :outline="false" :disabled="busy || blocked || !state" @click="confirm">{{
        busy ? 'merging…' : `${method} and close`
      }}</Button>
    </template>
  </ModalPanel>
</template>
