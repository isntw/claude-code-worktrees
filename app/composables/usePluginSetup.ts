import { computed, onMounted, ref } from 'vue'
import type { PluginReport, PluginState } from '#shared/types'
import type { Variation } from '../components/variation'

const LOOK: Record<PluginState, Variation> = {
  unavailable: 'neutral',
  absent: 'neutral',
  installed: 'success',
  disabled: 'warning',
  outdated: 'warning',
}

const SAYS: Record<PluginState, string> = {
  unavailable: 'claude code not found',
  absent: 'not installed',
  installed: 'installed',
  disabled: 'switched off',
  outdated: 'update available',
}

export function usePluginSetup() {
  const api = useApi()

  const report = ref<PluginReport | null>(null)
  const busy = ref(false)
  const error = ref<string | null>(null)

  const state = computed<PluginState | null>(() => report.value?.state ?? null)
  const installed = computed(() => state.value === 'installed' || state.value === 'outdated')
  const look = computed<Variation>(() => (state.value ? LOOK[state.value] : 'neutral'))
  const says = computed(() => (state.value ? SAYS[state.value] : ''))

  const events = computed(() =>
    (report.value?.parts.hooks ?? [])
      .map((hook) => `${hook.event}${hook.matcher ? `:${hook.matcher}` : ''}`)
      .join(' · '),
  )

  const load = async () => {
    report.value = await api.getPlugin().catch(() => null)
  }

  const act = async (run: () => Promise<PluginReport>) => {
    busy.value = true
    error.value = null
    try {
      report.value = await run()
      return true
    } catch (cause) {
      error.value = (cause as Error).message
      return false
    } finally {
      busy.value = false
    }
  }

  onMounted(load)

  return {
    report,
    busy,
    error,
    state,
    installed,
    look,
    says,
    events,
    load,
    act,
    install: () => act(api.installPlugin),
    enable: () => act(api.enablePlugin),
    remove: () => act(api.removePlugin),
  }
}
