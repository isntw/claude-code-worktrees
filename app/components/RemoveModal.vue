<script setup lang="ts">
import { computed, onMounted, ref } from 'vue'
import type { GitStatus, Occupancy, Occupant, Worktree } from '#shared/types'

const props = withDefaults(
  defineProps<{ projectId: string; worktree: Worktree; git?: GitStatus | null }>(),
  { git: null },
)

const emit = defineEmits<{ close: []; removed: [notice: string | null] }>()

const api = useApi()

const branch = ref(false)
const busy = ref(false)
const error = ref<string | null>(null)

const owned = computed(() => props.worktree.origin !== 'manual')

const uncommitted = computed(() => {
  const git = props.git
  if (!git) return 0
  return git.staged + git.unstaged + git.conflicted
})

const held = computed(() => props.worktree.lockState === 'live')

const occupancy = ref<Occupancy | null>(null)

const standing = computed(() => (occupancy.value?.occupants ?? []).filter((one) => !one.ours))
const sessions = computed(() => standing.value.filter((one) => /(^|\/)claude\b/i.test(one.command)))

const said = (one: Occupant) => {
  const parts = one.command.split(' ')
  const head = parts[0]
  if (!head) return one.name
  return [head.split('/').pop(), ...parts.slice(1)].join(' ')
}

onMounted(async () => {
  if (props.worktree.prunable) return
  occupancy.value = await api.occupants(props.projectId, props.worktree.id).catch(() => null)
})

const confirm = async () => {
  busy.value = true
  error.value = null
  try {
    const outcome = await api.removeWorktree(props.projectId, props.worktree.id, branch.value)

    const notes: string[] = []
    if (outcome.branchIssue) {
      notes.push(`The branch ${outcome.branch} was kept — ${outcome.branchIssue}`)
    }
    if (outcome.stopped.length) {
      notes.push(`Stopped ${outcome.stopped.join(' and ')}`)
    }

    emit('removed', notes.length ? `The worktree is gone. ${notes.join('. ')}.` : null)
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
    <p v-else-if="owned" class="font-sans text-xs text-dim">
      This deletes <code class="font-mono text-ink">{{ worktree.path }}</code> from disk, including
      untracked files ccwt put there — <code class="font-mono">node_modules</code>, copied
      <code class="font-mono">.env</code> files, and anything else not committed.
    </p>
    <p v-else class="font-sans text-xs text-dim">
      ccwt did not create <code class="font-mono text-ink">{{ worktree.path }}</code
      >, so it removes the directory only if nothing would be lost — no uncommitted changes, and no
      files git ignores. If anything is there, the removal is refused and names it.
    </p>

    <Notice v-if="uncommitted && !worktree.prunable" variation="error" class="mt-3">
      <span class="font-mono tabular-nums">{{ uncommitted }}</span>
      {{ uncommitted === 1 ? 'file has' : 'files have' }} changes that are not committed anywhere.
      <template #hint
        >Deleting the directory deletes them, and keeping the branch does not bring them
        back.</template
      >
    </Notice>

    <Notice
      v-if="standing.length"
      :variation="sessions.length ? 'agent' : 'warning'"
      class="mt-3"
    >
      {{ standing.length === 1 ? 'A program is' : `${standing.length} programs are` }} working inside
      this directory. Deleting it takes the ground out from under
      {{ standing.length === 1 ? 'it' : 'them' }}.
      <template #hint>
        <span class="flex flex-col gap-0.5">
          <span v-for="one in standing" :key="one.pid" class="font-mono text-[0.6875rem]">
            <span class="tabular-nums text-ink">pid {{ one.pid }}</span>
            <span class="ml-2">{{ said(one) }}</span>
          </span>
          <span v-if="sessions.length" class="mt-1 font-sans">
            Get that session out first — ask it to leave the worktree, or close it. ccwt cannot move
            it for you.
          </span>
        </span>
      </template>
    </Notice>

    <p v-if="worktree.locked" class="mt-3 font-sans text-xs text-caution">
      <template v-if="held">An agent is working here.</template>
      <template v-else>Locked. Removing releases the lock first.</template>
      <code v-if="worktree.lockReason" class="ml-1 font-mono text-[0.6875rem]">{{
        worktree.lockReason
      }}</code>
    </p>

    <p v-if="held && !worktree.prunable" class="mt-3 font-sans text-xs text-caution">
      Ask the agent to exit the worktree first — the session itself keeps running.
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
