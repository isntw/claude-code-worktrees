<script setup lang="ts">
import { ref } from 'vue'
import type { Worktree } from '#shared/types'

const props = defineProps<{ projectId: string; worktree: Worktree }>()

const emit = defineEmits<{ close: []; removed: [kept: string | null] }>()

const api = useApi()

const branch = ref(false)
const busy = ref(false)
const error = ref<string | null>(null)

const confirm = async () => {
  busy.value = true
  error.value = null
  try {
    const outcome = await api.removeWorktree(props.projectId, props.worktree.id, branch.value)
    emit('removed', outcome.branchIssue ? `${outcome.branch} — ${outcome.branchIssue}` : null)
  } catch (cause) {
    error.value = (cause as Error).message
    busy.value = false
  }
}
</script>

<template>
  <ModalPanel
    :title="worktree.prunable ? 'Drop stale entry' : 'Remove worktree'"
    @close="emit('close')"
  >
    <p v-if="worktree.prunable" class="font-sans text-xs text-dim">
      <code class="font-mono text-ink">{{ worktree.path }}</code> is already gone from disk. This
      drops the entry git still keeps for it. Nothing on disk changes.
    </p>
    <p v-else class="font-sans text-xs text-dim">
      This deletes <code class="font-mono text-ink">{{ worktree.path }}</code> from disk, including
      untracked files ccwt put there — <code class="font-mono">node_modules</code>, copied
      <code class="font-mono">.env</code> files, and anything else not committed.
    </p>

    <p v-if="!worktree.branch" class="mt-3 font-sans text-xs text-dim">
      This worktree is detached, so there is no branch to keep or delete.
    </p>
    <p v-else-if="!branch" class="mt-3 font-sans text-xs text-dim">
      The branch <code class="font-mono text-ink">{{ worktree.branch }}</code> is kept. Committed
      work is safe.
    </p>
    <p v-else class="mt-3 font-sans text-xs text-caution">
      The branch <code class="font-mono">{{ worktree.branch }}</code> is deleted from this computer.
      Nothing on GitHub changes. If it still holds commits that are not merged anywhere, it is kept.
    </p>

    <Checkbox v-if="worktree.branch" v-model="branch" class="mt-3">
      <span class="font-sans text-xs text-dim"
        >Also delete <code class="font-mono text-ink">{{ worktree.branch }}</code></span
      >
    </Checkbox>

    <p v-if="error" class="mt-3 font-sans text-xs text-alarm">{{ error }}</p>

    <template #footer>
      <Button size="sm" @click="emit('close')">cancel</Button>
      <Button size="sm" variation="error" :outline="false" :disabled="busy" @click="confirm">{{
        busy ? 'working…' : worktree.prunable ? 'drop entry' : 'remove'
      }}</Button>
    </template>
  </ModalPanel>
</template>
