import { computed, onBeforeUnmount, onMounted, ref } from 'vue'
import type { DeviceCode, ForgeSession } from '#shared/types'

export function useForgeAuth() {
  const api = useApi()

  const session = ref<ForgeSession | null>(null)
  const device = ref<DeviceCode | null>(null)
  const busy = ref(false)
  const error = ref<string | null>(null)

  let timer: ReturnType<typeof setTimeout> | null = null

  const signedIn = computed(() => Boolean(session.value?.login))
  const configured = computed(() => session.value?.configured !== false)

  const load = async () => {
    session.value = await api.getForgeSession().catch(() => null)
  }

  const stop = () => {
    if (timer) clearTimeout(timer)
    timer = null
  }

  const poll = (handle: string, seconds: number) => {
    timer = setTimeout(async () => {
      const outcome = await api.pollForgeLogin(handle).catch((cause: Error) => ({
        state: 'failed' as const,
        message: cause.message,
      }))

      if (outcome.state === 'pending') {
        poll(handle, outcome.interval)
        return
      }

      device.value = null

      if (outcome.state === 'failed') {
        error.value = outcome.message
        return
      }

      session.value = outcome.session
    }, seconds * 1000)
  }

  const start = async () => {
    busy.value = true
    error.value = null
    try {
      const started = await api.startForgeLogin()
      device.value = started
      poll(started.handle, started.interval)
    } catch (cause) {
      error.value = (cause as Error).message
    } finally {
      busy.value = false
    }
  }

  const cancel = () => {
    stop()
    device.value = null
  }

  const signOut = async () => {
    busy.value = true
    try {
      session.value = await api.signOutForge()
    } catch (cause) {
      error.value = (cause as Error).message
    } finally {
      busy.value = false
    }
  }

  onMounted(load)
  onBeforeUnmount(stop)

  return { session, device, busy, error, signedIn, configured, load, start, cancel, signOut }
}
