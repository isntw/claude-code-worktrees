import { computed, ref } from 'vue'
import type { ProvisionProgress } from '#shared/types'

export function useProvisionProgress() {
  const progress = ref<Record<string, ProvisionProgress>>({})
  const seen = ref(new Set<string>())

  const track = (worktreeId: string, value: ProvisionProgress | null) => {
    if (value) {
      progress.value[worktreeId] = value
      seen.value.add(worktreeId)
      return
    }

    delete progress.value[worktreeId]
  }

  const forget = () => {
    progress.value = {}
    seen.value = new Set()
  }

  const finished = (worktreeId: string) => seen.value.has(worktreeId) && !progress.value[worktreeId]

  const started = computed(() => seen.value.size)
  const settled = computed(() => {
    let done = 0
    for (const id of seen.value) if (!progress.value[id]) done += 1
    return done
  })

  return { progress, started, settled, finished, track, forget }
}
