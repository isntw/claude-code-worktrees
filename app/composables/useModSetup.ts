import { computed, onMounted, ref } from 'vue'
import type { ModReport, PluginState } from '#shared/types'
import type { Variation } from '../components/variation'

export function useModSetup() {
  const api = useApi()

  const report = ref<ModReport | null>(null)
  const busy = ref(false)
  const error = ref<string | null>(null)

  const state = computed<PluginState | null>(() => report.value?.state ?? null)
  const present = computed(() => state.value === 'installed' || state.value === 'outdated' || state.value === 'disabled')
  const look = computed<Variation>(() => (state.value ? PLUGIN_LOOK[state.value] : 'neutral'))
  const says = computed(() => (state.value ? PLUGIN_SAYS[state.value] : ''))

  const act = async (run: () => Promise<ModReport>) => {
    busy.value = true
    error.value = null
    try {
      report.value = await run()
    } catch (cause) {
      error.value = (cause as Error).message
    } finally {
      busy.value = false
    }
  }

  onMounted(async () => {
    report.value = await api.getMod().catch(() => null)
  })

  return {
    report,
    busy,
    error,
    state,
    present,
    look,
    says,
    install: () => act(api.installMod),
    enable: () => act(api.enableMod),
    disable: () => act(api.disableMod),
    update: () => act(api.updateMod),
    remove: () => act(api.removeMod),
  }
}
